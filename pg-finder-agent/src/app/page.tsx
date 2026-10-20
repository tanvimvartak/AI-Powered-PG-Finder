"use client";
/**
 * PG Finder Agent: single page with two states:
 *   1. Home: one big input (text or voice) + tap-to-try examples
 *   2. Agent: live timeline | live map, editable parameter chips, ranked cards
 */
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import ParamChips from "@/components/ParamChips";
import ResultCard from "@/components/ResultCard";
import Timeline, { type TimelineItem } from "@/components/Timeline";
import { useVoice } from "@/components/useVoice";
import type { AgentEvent, AgentRequestBody, GeoPoint, ListingHit, OsmPlace, OwnerReply, ParsedRequest, RankedListing } from "@/lib/types";

// Leaflet touches `window`, so the map is client-only.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-[1.25rem]" />,
});

const EXAMPLES = [
  "Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days",
  "Girls PG near Andheri station, walking distance, under 6k",
  "PG near Fergusson College Pune within 2 km, budget 8000",
  "Student PG near Christ University Bengaluru within 1.5 km",
  "Mithibai ke paas 5000 mein PG chahiye",
];

interface Relaxation {
  kind: "radius" | "budget";
  from: number;
  to: number;
  message: string;
}

export default function Home() {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"home" | "agent">("home");
  const [running, setRunning] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [params, setParams] = useState<ParsedRequest | null>(null);
  const [paramsKey, setParamsKey] = useState(0);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [radius, setRadius] = useState(1000);
  const [hits, setHits] = useState<ListingHit[]>([]);
  const [osm, setOsm] = useState<OsmPlace[]>([]);
  const [ranked, setRanked] = useState<RankedListing[]>([]);
  const [sourceStats, setSourceStats] = useState<{ osm: number; geoapify: number; web: number; merged: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [replies, setReplies] = useState<Record<string, OwnerReply>>({});
  const [contacting, setContacting] = useState<Set<string>>(new Set());
  const [relaxations, setRelaxations] = useState<Relaxation[]>([]);
  const [relaxDecision, setRelaxDecision] = useState<"pending" | "accepted" | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [finalText, setFinalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const lastBody = useRef<AgentRequestBody | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const voice = useVoice(useCallback((t: string) => setText(t), []));

  const rankOf = useMemo(() => Object.fromEntries(ranked.map((r) => [r.listing.id, r.rank])), [ranked]);

  /** Apply one streamed agent event to UI state. */
  const handleEvent = useCallback((e: AgentEvent) => {
    const now = Date.now();
    switch (e.type) {
      case "step":
        setTimeline((t) => {
          const i = t.findIndex((x) => x.id === e.id);
          const item: TimelineItem = { id: e.id, kind: "step", status: e.status, label: e.label, tool: e.tool, input: e.input, output: e.output, at: now };
          if (i === -1) return [...t, item];
          const copy = t.slice();
          copy[i] = item;
          return copy;
        });
        if (e.tool === "contact_owner") {
          const id = String((e.input as { listing_id?: string })?.listing_id ?? "");
          setContacting((c) => {
            const n = new Set(c);
            if (e.status === "running") n.add(id);
            else n.delete(id);
            return n;
          });
        }
        break;
      case "thought":
        setTimeline((t) => [...t, { id: `t${now}${Math.random()}`, kind: "thought", label: e.text, at: now }]);
        break;
      case "params":
        setParams(e.params);
        setParamsKey((k) => k + 1);
        setRadius(e.params.radius_m);
        break;
      case "location":
        setPoint(e.point);
        setRadius(e.radius_m);
        break;
      case "source_stats":
        setSourceStats(e.stats);
        break;
      case "listings":
        setHits(e.hits);
        setOsm(e.osm);
        setRadius(e.radius_m);
        if (e.stats) setSourceStats(e.stats);
        break;
      case "relaxation":
        setRelaxations((r) => [...r, e]);
        setRelaxDecision("pending");
        setTimeline((t) => [...t, { id: `r${now}`, kind: "relaxation", label: e.message, at: now }]);
        break;
      case "ranked":
        setRanked(e.results);
        break;
      case "enquiry_draft":
        setDrafts((d) => ({ ...d, [e.draft.listing_id]: e.draft }));
        break;
      case "owner_reply":
        setReplies((r) => ({ ...r, [e.reply.listing_id]: e.reply }));
        break;
      case "clarify":
        setClarify(e.question);
        break;
      case "final":
        setFinalText(e.text);
        break;
      case "error":
        setError(e.message);
        setTimeline((t) => [...t, { id: `e${now}`, kind: "error", label: e.message, at: now }]);
        break;
    }
  }, []);

  /** Start (or restart) the agent and consume its SSE stream. */
  const run = useCallback(
    async (body: AgentRequestBody, attempt = 0) => {
      if (!body.text.trim()) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      lastBody.current = body;
      voice.stop();
      setPhase("agent");
      setRunning(true);
      if (attempt === 0) {
        setTimeline([]);
        setHits([]);
        setOsm([]);
        setRanked([]);
        setReplies({});
        setContacting(new Set());
        setRelaxations([]);
        setRelaxDecision(null);
        setClarify(null);
        setFinalText(null);
        setError(null);
        setSelected(null);
      }
      let gotEvent = false;
      try {
        const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Server error ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            gotEvent = true;
            handleEvent(JSON.parse(line.slice(6)) as AgentEvent);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // One automatic retry for network blips before anything streamed.
        if (!gotEvent && attempt < 1) {
          setTimeline((t) => [...t, { id: `retry${Date.now()}`, kind: "thought", label: "Connection hiccup, retrying...", at: Date.now() }]);
          await new Promise((r) => setTimeout(r, 1200));
          return run(body, attempt + 1);
        }
        setError((e as Error).message || "Network error. Check your connection and try again.");
      } finally {
        if (abortRef.current === ctrl) setRunning(false);
      }
    },
    [handleEvent, voice],
  );

  const submit = () => run({ text });
  const rerun = (overrides: AgentRequestBody["overrides"]) => run({ text: lastBody.current?.text ?? text, overrides });
  const rejectRelaxation = () => run({ ...(lastBody.current ?? { text }), strict: true });

  // ───────────────────────────── HOME ─────────────────────────────
  if (phase === "home") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-3 chip text-violet-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> AI agent · free · OpenStreetMap
        </div>
        <h1 className="text-center text-4xl leading-tight font-bold tracking-tight sm:text-6xl">
          Find your <span className="gradient-text">PG</span>
          <br /> in one sentence.
        </h1>
        <p className="mt-4 max-w-xl text-center text-muted">
          Say where, how far, your budget and when. The agent searches, ranks, messages owners and books a visit. <b className="text-ink">No forms.</b>
        </p>

        <div className={`glass mt-8 w-full p-3 transition-shadow ${voice.listening ? "shadow-[0_0_60px_-10px_rgba(236,72,153,.6)]" : ""}`}>
          <textarea
            id="query-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder={voice.listening ? "Listening... speak now" : "e.g. PG near Mithibai college within 1 km, budget Rs 5,000, need it in 5 days"}
            className="w-full resize-none bg-transparent px-2 py-1 text-lg outline-none placeholder:text-muted/60"
            aria-label="Describe the PG you need"
          />
          <div className="flex items-center gap-3 px-1 pt-1">
            <button
              id="mic-btn"
              type="button"
              onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
              disabled={voice.supported === false}
              className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-2xl shadow-lg transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={voice.listening ? "Stop listening" : "Speak your request"}
              title={voice.supported === false ? "Voice not supported in this browser, please type" : "Speak (English / Hinglish)"}
            >
              {voice.listening && (
                <>
                  <span className="mic-ring" />
                  <span className="mic-ring delay" />
                </>
              )}
              <span className="relative">{voice.listening ? "■" : "🎙️"}</span>
            </button>
            <div className="flex-1 text-xs text-muted">
              {voice.listening ? (
                <span className="flex items-center gap-2 text-pink-200">
                  <span className="eq">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  Listening (en-IN)... edit the text before sending
                </span>
              ) : voice.error ? (
                <span className="text-amber-300">{voice.error}</span>
              ) : voice.supported === false ? (
                "Voice input isn't supported here. Just type."
              ) : (
                "Tap the mic to speak, or type. Enter to send."
              )}
            </div>
            <button id="send-btn" type="button" onClick={submit} disabled={!text.trim()} className="btn-primary">
              Find PGs →
            </button>
          </div>
        </div>

        <div className="mt-6 w-full">
          <p className="mb-2 text-center text-xs tracking-wider text-muted uppercase">Tap to try</p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex}
                id={`example-${i}`}
                type="button"
                onClick={() => setText(ex)}
                className={`btn-ghost text-left text-xs ${i === 0 ? "border-violet-400/40 bg-violet-500/10" : ""}`}
              >
                {ex.length > 70 ? ex.slice(0, 68) + "…" : ex}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-10 text-center text-[11px] text-muted/70">
          Listings come from live public sources. Prices and availability are unverified until you confirm with the owner.
        </p>
      </main>
    );
  }

  // ───────────────────────────── AGENT ─────────────────────────────
  const budget = params?.max_budget ?? null;
  const showEmpty = !running && !error && !clarify && finalText !== null && ranked.length === 0;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5">
      {/* top bar */}
      <header className="mb-3 flex items-center gap-3">
        <button id="home-btn" type="button" onClick={() => { abortRef.current?.abort(); setPhase("home"); }} className="text-lg font-bold whitespace-nowrap">
          <span className="gradient-text">PG Finder</span> <span className="text-xs font-normal text-muted">Agent</span>
        </button>
        <div className="glass flex flex-1 items-center gap-2 px-3 py-1.5">
          <input
            id="agent-query"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            aria-label="Your request"
          />
          <button type="button" onClick={() => (voice.listening ? voice.stop() : voice.start(""))} disabled={voice.supported === false} className="relative grid h-8 w-8 place-items-center rounded-full bg-white/5 text-sm" aria-label="Voice input" id="agent-mic">
            {voice.listening && <span className="mic-ring" />}
            <span className="relative">{voice.listening ? "■" : "🎙️"}</span>
          </button>
          <button id="agent-send" type="button" onClick={submit} disabled={running || !text.trim()} className="btn-primary px-3 py-1 text-sm">
            {running ? "…" : "Go"}
          </button>
        </div>
      </header>

      {params && (
        <div className="mb-3">
          <ParamChips key={paramsKey} params={params} disabled={running} onRerun={rerun} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* LEFT / TOP: timeline + summary */}
        <div className="order-1 space-y-4">
          <Timeline items={timeline} running={running} />

          {relaxations.length > 0 && relaxDecision === "pending" && !running && (
            <div className="glass fade-up border-amber-400/30 p-4 text-sm">
              <div className="mb-1 font-semibold text-amber-200">I relaxed your constraints</div>
              <ul className="mb-3 list-disc space-y-1 pl-5 text-amber-100/90">
                {relaxations.map((r, i) => (
                  <li key={i}>{r.message}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button id="accept-relax" type="button" className="btn-primary px-4 py-1.5 text-sm" onClick={() => setRelaxDecision("accepted")}>
                  Accept
                </button>
                <button id="reject-relax" type="button" className="btn-ghost" onClick={rejectRelaxation}>
                  Reject: keep my original limits
                </button>
              </div>
            </div>
          )}

          {clarify && !running && (
            <div className="glass fade-up p-4">
              <div className="mb-2 text-sm font-semibold">🤔 {clarify}</div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!clarifyAnswer.trim()) return;
                  const t = `${lastBody.current?.text ?? text} (near ${clarifyAnswer.trim()})`;
                  setText(t);
                  setClarifyAnswer("");
                  run({ text: t, overrides: { landmark: clarifyAnswer.trim() } });
                }}
              >
                <input id="clarify-input" value={clarifyAnswer} onChange={(e) => setClarifyAnswer(e.target.value)} className="chip flex-1 py-2 text-sm outline-none" placeholder="e.g. Mithibai College, Vile Parle" />
                <button type="submit" className="btn-primary px-4 py-1.5 text-sm">
                  Send
                </button>
              </form>
            </div>
          )}

          {finalText && !clarify && (
            <section className="glass fade-up p-4" aria-label="Agent recommendation">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">✨ Recommendation</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {finalText.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <b key={i} className="text-violet-200">
                      {part.slice(2, -2)}
                    </b>
                  ) : (
                    part
                  ),
                )}
              </p>
            </section>
          )}

          {error && (
            <div className="glass fade-up border-red-400/30 p-4 text-sm">
              <div className="mb-2 font-semibold text-red-300">Something went wrong</div>
              <p className="mb-3 text-red-200/80">{error}</p>
              <button id="retry-btn" type="button" className="btn-ghost" onClick={() => lastBody.current && run(lastBody.current)}>
                ↻ Try again
              </button>
            </div>
          )}
        </div>

        {/* RIGHT / BOTTOM: map + results */}
        <div className="order-2 space-y-4">
          <div className="glass relative h-[42vh] min-h-[280px] overflow-hidden p-0 lg:h-[460px]">
            <MapView
              center={point}
              landmark={point?.display_name ?? params?.landmark ?? null}
              radius_m={radius}
              hits={hits}
              osm={osm}
              budget={budget}
              rankOf={rankOf}
              selectedId={selected}
              onSelect={(id) => {
                setSelected(id);
                document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
            <div className="pointer-events-none absolute right-3 bottom-3 z-[500] flex flex-col gap-1 rounded-xl bg-black/60 p-2 text-[10px] backdrop-blur">
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />within budget</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />near budget</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />price unknown</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-400" />over budget</span>
            </div>
            {hits.length > 0 && (
              <div className="pointer-events-none absolute top-3 left-3 z-[500] chip bg-black/60 backdrop-blur">
                {hits.length} live places · {(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km radius
              </div>
            )}
          </div>

          {/* Data sources chip row */}
          {hits.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
              <span className="text-muted font-medium">Data sources:</span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-300">
                OSM: <b className="text-white">{sourceStats?.osm ?? hits.filter((h) => h.sources.some((s) => s.name === "OpenStreetMap")).length}</b>
              </span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-300">
                Geoapify: <b className="text-white">{sourceStats?.geoapify ?? 0}</b>
              </span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-300">
                Live Web: <b className="text-white">{sourceStats?.web ?? hits.filter((h) => h.sources.some((s) => s.name !== "OpenStreetMap" && s.name !== "Geoapify")).length}</b>
              </span>
              <span className="rounded-md bg-violet-500/20 text-violet-300 px-2 py-0.5 font-medium border border-violet-500/30">
                Merged: {sourceStats?.merged ?? hits.length}
              </span>
            </div>
          )}

          {/* Results partitioned by group */}
          {ranked.length > 0 && (
            <section aria-label="Ranked PGs" className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-white">Discovered Accommodations</h2>
                <span className="text-xs text-muted">live public sources · unverified until confirmed</span>
              </div>

              {/* Top matches with listed prices */}
              {ranked.filter((r) => r.group === "top_match").length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                    <span>✓</span> Top Matches (Listed Prices Within Budget)
                  </h3>
                  {ranked
                    .filter((r) => r.group === "top_match")
                    .map((r) => (
                      <ResultCard
                        key={r.listing.id}
                        item={r}
                        draft={drafts[r.listing.id]}
                        budget={budget}
                        deadline={params?.deadline_date ?? null}
                        selected={selected === r.listing.id}
                        onSelect={() => setSelected(r.listing.id)}
                        onDraftUpdate={(d) => setDrafts((prev) => ({ ...prev, [d.listing_id]: d }))}
                      />
                    ))}
                </div>
              )}

              {/* Worth asking about (unlisted prices) */}
              {ranked.filter((r) => r.group === "worth_asking").length > 0 && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <span>💬</span> Worth Asking About (Price Unverified — Contact Owner)
                  </h3>
                  {ranked
                    .filter((r) => r.group === "worth_asking")
                    .map((r) => (
                      <ResultCard
                        key={r.listing.id}
                        item={r}
                        draft={drafts[r.listing.id]}
                        budget={budget}
                        deadline={params?.deadline_date ?? null}
                        selected={selected === r.listing.id}
                        onSelect={() => setSelected(r.listing.id)}
                        onDraftUpdate={(d) => setDrafts((prev) => ({ ...prev, [d.listing_id]: d }))}
                      />
                    ))}
                </div>
              )}
            </section>
          )}

          {running && ranked.length === 0 && (
            <div className="space-y-3" aria-hidden>
              {[0, 1].map((i) => (
                <div key={i} className="glass skeleton h-36" />
              ))}
            </div>
          )}

          {showEmpty && (
            <div className="glass fade-up p-6 text-center space-y-3">
              <div className="text-3xl">🔍</div>
              <h2 className="text-base font-semibold text-white">No Accommodation Found Near "{params?.landmark || "Destination"}"</h2>
              <p className="mx-auto max-w-md text-xs text-muted leading-relaxed">
                We searched live across <b>OpenStreetMap Overpass</b>, <b>Geoapify Places</b>, and <b>Live Web Discovery</b>, but found 0 advertised listings within {(radius / 1000).toFixed(1)} km.
              </p>
              <div className="rounded-lg bg-black/30 border border-white/10 p-3 max-w-md mx-auto text-left text-xs space-y-1">
                <div className="font-semibold text-slate-300">Suggestions:</div>
                <div className="text-muted">• Try expanding the radius to 2 km or 5 km.</div>
                <div className="text-muted">• Try a nearby railway station or metro hub name.</div>
                <div className="text-muted">• If your budget was very strict, try removing the budget cap to view all options.</div>
              </div>
              {params && (
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <button id="empty-wider" type="button" className="btn-ghost text-xs" onClick={() => rerun({ radius_m: Math.min(params.radius_m * 2, 8000) })}>
                    Try {(Math.min(params.radius_m * 2, 8000) / 1000).toFixed(1)} km
                  </button>
                  {params.max_budget && (
                    <button id="empty-budget" type="button" className="btn-ghost text-xs" onClick={() => rerun({ max_budget: null })}>
                      View all without budget cap
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="mt-8 pb-4 text-center text-[11px] text-muted/70">
        {hits.some((h) => h.is_sample)
          ? "DEMO MODE: Sample listings active · map © OpenStreetMap contributors"
          : "Listings come from live public sources. Prices and availability are unverified until you confirm with the owner. · Map © OpenStreetMap contributors"}
      </footer>
    </main>
  );
}
