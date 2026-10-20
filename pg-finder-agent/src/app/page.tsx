"use client";
/**
 * PG Finder Agent:
 * Clean, High-Contrast Modern Calm Trustworthy Design (Deep Teal, Warm Beige, Leaf Mist, Terracotta)
 * - Single-page state machine (Home -> Agent)
 * - No unnecessary fluff / mock navbar
 * - Crisp, dark, readable text across all devices
 * - Correct map and timeline grid alignment
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
  loading: () => <div className="skeleton h-full w-full rounded-2xl" />,
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
        setSourceStats(null);
        setDrafts({});
        setReplies({});
        setRelaxations([]);
        setRelaxDecision(null);
        setClarify(null);
        setFinalText(null);
        setError(null);
        setSelected(null);
      }

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Agent request failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const chunk of lines) {
            const trimmed = chunk.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            try {
              const event: AgentEvent = JSON.parse(payload);
              handleEvent(event);
            } catch (err) {
              console.error("Malformed SSE line:", payload, err);
            }
          }
        }
      } catch (e: any) {
        if (ctrl.signal.aborted) return;
        if (attempt < 1) {
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

  const appendFilter = (filterText: string) => {
    setText((prev) => {
      const clean = prev.trim();
      return clean ? `${clean}, ${filterText}` : filterText;
    });
  };

  // ───────────────────────────── HOME STATE ─────────────────────────────
  if (phase === "home") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#E8F2EC] px-3.5 py-1 text-xs font-black text-[#1E5D4B] border-1.5 border-[#B7D5C4]">
          <span className="h-2 w-2 rounded-full bg-[#1E5D4B]" /> AI agent · free · OpenStreetMap
        </div>

        <h1 className="text-center text-4xl sm:text-6xl font-black tracking-tight text-[#1F2937] leading-[1.15]">
          Find your <span className="text-[#1E5D4B]">PG</span>
          <br /> in one sentence.
        </h1>

        <p className="mt-4 max-w-xl text-center text-sm sm:text-base font-semibold text-[#334155] leading-relaxed">
          Say where, how far, your budget and when. The agent searches, ranks, messages owners and books a visit.{" "}
          <b className="text-[#1F2937] font-black">No forms.</b>
        </p>

        {/* Focused Search Box */}
        <div className="mt-8 w-full rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 shadow-md transition-shadow">
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
            placeholder={
              voice.listening
                ? "Listening... speak your request now"
                : "e.g. PG near Mithibai college within 1 km, budget Rs 5,000, need it in 5 days"
            }
            className="w-full resize-none bg-transparent px-2 py-1 text-base sm:text-lg font-bold text-[#1F2937] outline-none placeholder:text-slate-400 placeholder:font-normal"
            aria-label="Describe the PG you need"
          />

          <div className="flex items-center gap-3 px-1 pt-2 border-t border-[#E2E8F0]">
            <button
              id="mic-btn"
              type="button"
              onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
              disabled={voice.supported === false}
              className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#E8F2EC] border-2 border-[#1E5D4B] text-xl text-[#1E5D4B] hover:bg-[#D9EBE0] shadow-sm transition disabled:opacity-40"
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

            <div className="flex-1 text-xs font-bold text-[#1F2937]">
              {voice.listening ? (
                <span className="flex items-center gap-2 text-[#1E5D4B]">
                  <span className="eq">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  Listening (en-IN)... speak now
                </span>
              ) : voice.error ? (
                <span className="text-amber-700 font-extrabold">{voice.error}</span>
              ) : voice.supported === false ? (
                <span className="text-[#334155]">Voice input isn't supported here. Just type.</span>
              ) : (
                <span className="text-[#334155]">Tap mic to speak, or type. Press Enter to send.</span>
              )}
            </div>

            <button
              id="send-btn"
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="bg-[#1E5D4B] hover:bg-[#16483A] text-white font-black rounded-full px-6 py-2.5 text-sm shadow-md transition disabled:bg-[#A3BFB7] disabled:cursor-not-allowed cursor-pointer"
            >
              Find PGs →
            </button>
          </div>

          {/* High-Contrast Quick Filters */}
          <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2E8F0]">
            <span className="text-xs font-black text-[#1F2937] mr-1">Quick Filters:</span>
            <button
              type="button"
              onClick={() => appendFilter("near college")}
              className="rounded-full bg-white hover:bg-[#E8F2EC] border-2 border-[#1E5D4B] px-3.5 py-1 text-xs font-black text-[#1F2937] shadow-xs transition cursor-pointer"
            >
              🎓 Near College
            </button>
            <button
              type="button"
              onClick={() => appendFilter("girls only")}
              className="rounded-full bg-white hover:bg-[#E8F2EC] border-2 border-[#1E5D4B] px-3.5 py-1 text-xs font-black text-[#1F2937] shadow-xs transition cursor-pointer"
            >
              👩 Girls Only
            </button>
            <button
              type="button"
              onClick={() => appendFilter("under Rs 8000")}
              className="rounded-full bg-white hover:bg-[#E8F2EC] border-2 border-[#1E5D4B] px-3.5 py-1 text-xs font-black text-[#1F2937] shadow-xs transition cursor-pointer"
            >
              💰 Under ₹8k
            </button>
            <button
              type="button"
              onClick={() => appendFilter("fully furnished")}
              className="rounded-full bg-white hover:bg-[#E8F2EC] border-2 border-[#1E5D4B] px-3.5 py-1 text-xs font-black text-[#1F2937] shadow-xs transition cursor-pointer"
            >
              🛋️ Fully Furnished
            </button>
            <button
              type="button"
              onClick={() => appendFilter("AC room")}
              className="rounded-full bg-white hover:bg-[#E8F2EC] border-2 border-[#1E5D4B] px-3.5 py-1 text-xs font-black text-[#1F2937] shadow-xs transition cursor-pointer"
            >
              ❄️ AC Rooms
            </button>
          </div>
        </div>

        {/* Tap to try prompts */}
        <div className="mt-8 w-full">
          <p className="mb-2.5 text-center text-xs font-black tracking-wider text-[#334155] uppercase">
            Tap to try example prompts:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex}
                id={`example-${i}`}
                type="button"
                onClick={() => setText(ex)}
                className={`rounded-full px-4 py-1.5 text-left text-xs font-bold transition shadow-xs cursor-pointer ${
                  i === 0
                    ? "border-2 border-[#1E5D4B] bg-[#E8F2EC] text-[#1E5D4B] font-black"
                    : "border-1.5 border-[#CBD5E1] bg-white text-[#1F2937] hover:border-[#1E5D4B] hover:bg-[#E8F2EC]"
                }`}
              >
                {ex.length > 70 ? ex.slice(0, 68) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-8 text-center text-xs font-semibold text-[#334155]">
          Listings come from live public sources. Prices and availability are unverified until you confirm with the owner.
        </p>
      </main>
    );
  }

  // ───────────────────────────── AGENT RESULTS STATE ─────────────────────────────
  const budget = params?.max_budget ?? null;
  const showEmpty = !running && !error && !clarify && finalText !== null && ranked.length === 0;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5">
      {/* Top Bar with Search & Home Button */}
      <header className="mb-3 flex items-center gap-3">
        <button
          id="home-btn"
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("home");
          }}
          className="flex items-center gap-2 text-lg font-black text-[#1E5D4B] whitespace-nowrap cursor-pointer hover:opacity-90"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1E5D4B] text-white text-sm">
            🏡
          </span>
          <span>PG Finder</span> <span className="text-xs font-bold text-[#334155]">Agent</span>
        </button>

        <div className="glass flex flex-1 items-center gap-2 px-3 py-1.5 border-2 border-[#CBD5E1] bg-white shadow-xs">
          <input
            id="agent-query"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="min-w-0 flex-1 bg-transparent text-sm text-[#1F2937] font-bold outline-none placeholder:text-slate-400"
            aria-label="Your request"
          />
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start(""))}
            disabled={voice.supported === false}
            className="relative grid h-8 w-8 place-items-center rounded-full bg-[#E8F2EC] border border-[#B7D5C4] text-[#1E5D4B] text-sm"
            aria-label="Voice input"
            id="agent-mic"
          >
            {voice.listening && <span className="mic-ring" />}
            <span className="relative">{voice.listening ? "■" : "🎙️"}</span>
          </button>
          <button
            id="agent-send"
            type="button"
            onClick={submit}
            disabled={running || !text.trim()}
            className="bg-[#1E5D4B] hover:bg-[#16483A] text-white font-black rounded-full px-4 py-1 text-sm shadow-xs transition disabled:opacity-50 cursor-pointer"
          >
            {running ? "…" : "Go"}
          </button>
        </div>
      </header>

      {/* Editable Param Chips */}
      {params && (
        <div className="mb-3">
          <ParamChips key={paramsKey} params={params} disabled={running} onRerun={rerun} />
        </div>
      )}

      {/* Main Grid: Left Column (Timeline) & Right Column (Map + Results) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* LEFT / TOP: timeline + recommendation */}
        <div className="order-1 space-y-4">
          <Timeline items={timeline} running={running} />

          {relaxations.length > 0 && relaxDecision === "pending" && !running && (
            <div className="glass fade-up border-2 border-amber-400 bg-amber-50 p-4 text-sm">
              <div className="mb-1 font-black text-amber-900">I relaxed your constraints</div>
              <ul className="mb-3 list-disc space-y-1 pl-5 font-bold text-amber-950">
                {relaxations.map((r, i) => (
                  <li key={i}>{r.message}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  id="accept-relax"
                  type="button"
                  className="btn-primary py-1.5 px-4 text-xs font-black"
                  onClick={() => setRelaxDecision("accepted")}
                >
                  Accept
                </button>
                <button
                  id="reject-relax"
                  type="button"
                  className="btn-ghost text-xs font-bold"
                  onClick={rejectRelaxation}
                >
                  Reject: keep original limits
                </button>
              </div>
            </div>
          )}

          {clarify && !running && (
            <div className="glass fade-up p-4 border-2 border-[#CBD5E1]">
              <div className="mb-2 text-sm font-black text-[#1F2937]">🤔 {clarify}</div>
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
                <input
                  id="clarify-input"
                  value={clarifyAnswer}
                  onChange={(e) => setClarifyAnswer(e.target.value)}
                  className="chip flex-1 py-2 text-sm font-bold text-[#1F2937] outline-none"
                  placeholder="e.g. Mithibai College, Vile Parle"
                />
                <button type="submit" className="btn-primary py-1.5 px-4 text-xs font-black">
                  Send
                </button>
              </form>
            </div>
          )}

          {finalText && !clarify && (
            <section className="glass fade-up p-4 border-2 border-[#B7D5C4] bg-[#E8F2EC]" aria-label="Agent recommendation">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-black tracking-wider text-[#1E5D4B] uppercase">
                ✨ Recommendation
              </h2>
              <p className="text-sm font-semibold leading-relaxed whitespace-pre-line text-[#1F2937]">
                {finalText.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <b key={i} className="text-[#1E5D4B] font-black">
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
            <div className="glass fade-up border-2 border-red-400 bg-red-50 p-4 text-sm">
              <div className="mb-1 font-black text-red-900">Something went wrong</div>
              <p className="mb-3 font-semibold text-red-800 text-xs">{error}</p>
              <button
                id="retry-btn"
                type="button"
                className="btn-ghost text-xs font-bold"
                onClick={() => lastBody.current && run(lastBody.current)}
              >
                ↻ Try again
              </button>
            </div>
          )}
        </div>

        {/* RIGHT / BOTTOM: Map + Discovered Listings */}
        <div className="order-2 space-y-4">
          <div className="glass relative h-[42vh] min-h-[280px] overflow-hidden p-0 lg:h-[460px] border-2 border-[#CBD5E1] shadow-sm">
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
            <div className="pointer-events-none absolute right-3 bottom-3 z-[500] flex flex-col gap-1 rounded-xl bg-white/95 p-2.5 text-[11px] font-bold text-[#1F2937] shadow-md border border-[#CBD5E1]">
              <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#1E5D4B]" />within budget</span>
              <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#F08A5D]" />near budget</span>
              <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#334155]" />price unlisted</span>
              <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-600" />over budget</span>
            </div>
            {hits.length > 0 && (
              <div className="pointer-events-none absolute top-3 left-3 z-[500] rounded-full bg-white/95 px-3 py-1 text-xs font-black text-[#1E5D4B] shadow-sm border border-[#CBD5E1]">
                {hits.length} live places · {(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km radius
              </div>
            )}
          </div>

          {/* Data sources chip row */}
          {hits.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 py-1 text-xs font-bold">
              <span className="text-[#1F2937] font-black">Data sources:</span>
              <span className="rounded-md bg-[#E8F2EC] border border-[#B7D5C4] px-2.5 py-0.5 text-[#1F2937]">
                OSM: <b className="text-[#1E5D4B]">{sourceStats?.osm ?? hits.filter((h) => h.sources.some((s) => s.name === "OpenStreetMap")).length}</b>
              </span>
              <span className="rounded-md bg-[#E8F2EC] border border-[#B7D5C4] px-2.5 py-0.5 text-[#1F2937]">
                Geoapify: <b className="text-[#1E5D4B]">{sourceStats?.geoapify ?? 0}</b>
              </span>
              <span className="rounded-md bg-[#E8F2EC] border border-[#B7D5C4] px-2.5 py-0.5 text-[#1F2937]">
                Live Web: <b className="text-[#1E5D4B]">{sourceStats?.web ?? hits.filter((h) => h.sources.some((s) => s.name !== "OpenStreetMap" && s.name !== "Geoapify")).length}</b>
              </span>
              <span className="rounded-md bg-[#1E5D4B] text-white px-2.5 py-0.5 font-black">
                Merged: {sourceStats?.merged ?? hits.length}
              </span>
            </div>
          )}

          {/* Results partitioned by group */}
          {ranked.length > 0 && (
            <section aria-label="Ranked PGs" className="space-y-4">
              <div className="flex items-baseline justify-between border-b border-[#CBD5E1] pb-2">
                <h2 className="text-xl font-black text-[#1F2937]">Discovered Accommodations</h2>
                <span className="text-xs font-bold text-[#334155]">Live public sources · Real verified contacts</span>
              </div>

              {/* Top matches with listed prices */}
              {ranked.filter((r) => r.group === "top_match").length > 0 && (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#1E5D4B]">
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
                  <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#334155]">
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
            <div className="glass fade-up p-8 text-center space-y-3 border-2 border-[#CBD5E1]">
              <div className="text-4xl">🔍</div>
              <h2 className="text-lg font-black text-[#1F2937]">No Accommodation Found Near "{params?.landmark || "Destination"}"</h2>
              <p className="mx-auto max-w-md text-xs font-bold text-[#334155] leading-relaxed">
                We searched live across <b>OpenStreetMap Overpass</b>, <b>Geoapify Places</b>, and <b>Live Web Discovery</b>, but found 0 advertised listings within {(radius / 1000).toFixed(1)} km.
              </p>
              <div className="rounded-xl bg-[#FFF8F2] border border-[#CBD5E1] p-3.5 max-w-md mx-auto text-left text-xs space-y-1">
                <div className="font-black text-[#1F2937]">Suggestions:</div>
                <div className="font-semibold text-[#334155]">• Try expanding the radius to 2 km or 5 km.</div>
                <div className="font-semibold text-[#334155]">• Try a nearby railway station or metro hub name.</div>
                <div className="font-semibold text-[#334155]">• If your budget was very strict, try removing the budget cap to view all options.</div>
              </div>
              {params && (
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <button
                    id="empty-wider"
                    type="button"
                    className="btn-ghost text-xs font-bold"
                    onClick={() => rerun({ radius_m: Math.min(params.radius_m * 2, 8000) })}
                  >
                    Try {(Math.min(params.radius_m * 2, 8000) / 1000).toFixed(1)} km
                  </button>
                  {params.max_budget && (
                    <button
                      id="empty-budget"
                      type="button"
                      className="btn-ghost text-xs font-bold"
                      onClick={() => rerun({ max_budget: null })}
                    >
                      View all without budget cap
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="mt-8 pb-4 text-center text-xs font-semibold text-[#334155]">
        Listings come from live public sources. Prices and availability are unverified until you confirm with the owner. · Map © OpenStreetMap contributors
      </footer>
    </main>
  );
}
