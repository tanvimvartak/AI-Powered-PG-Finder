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
import ApartmentIllustration from "@/components/ApartmentIllustration";
import ParamChips from "@/components/ParamChips";
import ResultCard from "@/components/ResultCard";
import Timeline, { type TimelineItem } from "@/components/Timeline";
import { BrokerageBar } from "@/components/BrokerageBar";
import { useVoice } from "@/components/useVoice";
import type { AgentEvent, AgentRequestBody, GeoPoint, ListingHit, OsmPlace, OwnerReply, ParsedRequest, RankedListing } from "@/lib/types";

// Leaflet touches `window`, so the map is client-only.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-2xl" />,
});

const EXAMPLES = [
  {
    display: "Please find me a PG accommodation near Mithibai college within 1 km ...",
    full: "Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days",
  },
  {
    display: "PG near Fergusson College Pune within 2 km...",
    full: "PG near Fergusson College Pune within 2 km, budget 8000",
  },
  {
    display: "Girls PG near Andheri station...",
    full: "Girls PG near Andheri station, walking distance, under 6k",
  },
];

interface Relaxation {
  kind: "radius" | "budget";
  from: number;
  to: number;
  message: string;
}

export default function Home() {
  const [text, setText] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState<number | null>(null);
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

  const voice = useVoice(
    useCallback((t: string) => {
      setText(t);
      setSelectedPrompt(null);
    }, [])
  );

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

  const DEFAULT_QUERY = "Girls PG near Andheri station, walking distance, under 6k";
  const submit = () => {
    const queryText = text.trim() || DEFAULT_QUERY;
    run({ text: queryText });
  };
  const rerun = (overrides: AgentRequestBody["overrides"]) => run({ text: lastBody.current?.text ?? text, overrides });
  const rejectRelaxation = () => run({ ...(lastBody.current ?? { text }), strict: true });

  const appendFilter = (filterText: string) => {
    setSelectedPrompt(null);
    setText((prev) => {
      const clean = prev.trim();
      return clean ? `${clean}, ${filterText}` : filterText;
    });
  };

  // ───────────────────────────── HOME STATE ─────────────────────────────
  if (phase === "home") {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
        {/* Top Header Section: Title on Left, Illustration on Right */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 sm:gap-8 w-full mb-7">
          <div className="flex-1 text-left">
            <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-black tracking-tight text-[#1F2937] leading-[1.12]">
              Find your <span className="text-[#1E5D4B]">PG</span>
              <br />
              in one sentence.
            </h1>
            <p className="mt-3.5 max-w-xl text-sm sm:text-base font-normal text-[#475569] leading-relaxed">
              Say where, how far, your budget and when. The agent searches, ranks, messages owners and books a visit.{" "}
              <b className="font-bold text-[#1E5D4B]">No forms.</b>
            </p>
          </div>

          <div className="shrink-0 w-full sm:w-auto flex justify-center md:justify-end">
            <ApartmentIllustration className="w-64 sm:w-76 md:w-[320px] lg:w-[360px] h-auto drop-shadow-xs" />
          </div>
        </div>

        {/* Floating Search Card */}
        <div className="w-full rounded-2xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-[0_4px_24px_rgba(30,93,75,0.06)] border border-[#E2E8F0]">
          {/* Row 1: Location Input */}
          <div className="flex items-center gap-3.5 pb-4">
            <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC] text-[#1E5D4B]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a8 8 0 0 0-8 8c0 5.4 7.05 11.5 7.35 11.76a1 1 0 0 0 1.3 0C12.95 21.5 20 15.4 20 10a8 8 0 0 0-8-8z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <input
              id="query-input"
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSelectedPrompt(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Girls PG near Andheri station, walking distance, under 6k"
              className="w-full bg-transparent text-base sm:text-lg font-semibold text-[#1F2937] outline-none placeholder:text-[#1F2937] placeholder:font-semibold"
              aria-label="Describe the PG you need"
            />
          </div>

          {/* Row 2: Voice & Submit Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F3] pt-4 pb-4">
            <div className="flex items-center gap-3 flex-1 min-w-[220px]">
              <button
                id="mic-btn"
                type="button"
                onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
                disabled={voice.supported === false}
                className="relative flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC] text-[#1E5D4B] hover:bg-[#D9EBE0] transition shadow-xs disabled:opacity-40 cursor-pointer"
                aria-label={voice.listening ? "Stop listening" : "Speak your request"}
                title={voice.supported === false ? "Voice not supported in this browser, please type" : "Speak (English / Hinglish)"}
              >
                {voice.listening && (
                  <>
                    <span className="mic-ring" />
                    <span className="mic-ring delay" />
                  </>
                )}
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                  <line x1="12" y1="18" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>

              <span className="text-xs sm:text-sm font-medium text-[#64748B]">
                {voice.listening ? (
                  <span className="text-[#1E5D4B] font-semibold flex items-center gap-2">
                    <span className="eq"><span /><span /><span /><span /></span>
                    Listening (en-IN)... speak now
                  </span>
                ) : voice.error ? (
                  <span className="text-amber-700 font-semibold">{voice.error}</span>
                ) : (
                  "Tap the mic to speak, or type. Enter to send."
                )}
              </span>
            </div>

            <button
              id="send-btn"
              type="button"
              onClick={submit}
              className="inline-flex items-center justify-center rounded-full bg-[#1E5D4B] hover:bg-[#16483A] px-6 py-2.5 text-sm font-semibold text-white shadow-xs transition cursor-pointer"
            >
              Find PGs →
            </button>
          </div>

          {/* Row 3: Quick Filters */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 border-t border-[#F1F5F3] pt-4">
            <span className="text-xs font-semibold text-[#1F2937] mr-1">Quick Filters:</span>
            <button
              type="button"
              onClick={() => appendFilter("near college")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] hover:bg-[#D9EBE0] px-3.5 py-1.5 text-xs font-semibold text-[#1E5D4B] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-[#1E5D4B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
              </svg>
              Near College
            </button>
            <button
              type="button"
              onClick={() => appendFilter("girls only")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] hover:bg-[#D9EBE0] px-3.5 py-1.5 text-xs font-semibold text-[#1E5D4B] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-[#1E5D4B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="5" />
                <path d="M12 13v8" />
                <path d="M9 18h6" />
              </svg>
              Girls Only
            </button>
            <button
              type="button"
              onClick={() => appendFilter("under Rs 8000")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] hover:bg-[#D9EBE0] px-3.5 py-1.5 text-xs font-semibold text-[#1E5D4B] transition cursor-pointer"
            >
              <span className="font-bold text-xs text-[#1E5D4B] leading-none shrink-0">₹</span>
              Under ₹8k
            </button>
            <button
              type="button"
              onClick={() => appendFilter("fully furnished")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] hover:bg-[#D9EBE0] px-3.5 py-1.5 text-xs font-semibold text-[#1E5D4B] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-[#1E5D4B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Fully Furnished
            </button>
            <button
              type="button"
              onClick={() => appendFilter("AC room")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] hover:bg-[#D9EBE0] px-3.5 py-1.5 text-xs font-semibold text-[#1E5D4B] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-[#1E5D4B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              </svg>
              AC Rooms
            </button>
          </div>
        </div>

        {/* Divider: TAP TO TRY EXAMPLE PROMPTS: */}
        <div className="relative flex py-8 items-center w-full max-w-5xl">
          <div className="flex-grow border-t border-[#CBD5E1]"></div>
          <span className="flex-shrink mx-4 text-[11px] sm:text-xs font-bold tracking-widest text-[#64748B] uppercase">
            TAP TO TRY EXAMPLE PROMPTS:
          </span>
          <div className="flex-grow border-t border-[#CBD5E1]"></div>
        </div>

        {/* Example Prompt Pills */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full max-w-5xl">
          {EXAMPLES.map((ex, i) => {
            const isSelected = selectedPrompt === i || (selectedPrompt === null && text === ex.full && text.length > 0);
            return (
              <button
                key={ex.full}
                id={`example-${i}`}
                type="button"
                onClick={() => {
                  setSelectedPrompt(i);
                  setText(ex.full);
                }}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-[13px] font-medium transition cursor-pointer shadow-xs truncate ${
                  isSelected
                    ? "bg-[#1E5D4B] text-white hover:bg-[#16483A]"
                    : "bg-[#E8F2EC] text-[#475569] hover:bg-[#D9EBE0] border border-[#CBD5E1]"
                }`}
              >
                <svg
                  className={`h-4 w-4 shrink-0 ${isSelected ? "text-white" : "text-[#1E5D4B]"}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a8 8 0 0 0-8 8c0 5.4 7.05 11.5 7.35 11.76a1 1 0 0 0 1.3 0C12.95 21.5 20 15.4 20 10a8 8 0 0 0-8-8z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="truncate">
                  {ex.display}
                </span>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  // ───────────────────────────── AGENT RESULTS STATE ─────────────────────────────
  const budget = params?.max_budget ?? null;
  const showEmpty = !running && !error && !clarify && finalText !== null && ranked.length === 0;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5">
      {/* Top Bar with Search, Back & Home Button */}
      <header className="mb-3 flex items-center gap-2 sm:gap-3">
        <button
          id="back-btn"
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("home");
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 sm:px-3.5 py-1.5 text-xs sm:text-sm font-bold text-[#1E5D4B] border border-[#CBD5E1] shadow-xs hover:bg-[#E8F2EC] hover:border-[#1E5D4B] transition cursor-pointer shrink-0"
          title="Back to Search"
          aria-label="Back to Search"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back</span>
        </button>

        <button
          id="home-btn"
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("home");
          }}
          className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg font-black text-[#1E5D4B] whitespace-nowrap cursor-pointer hover:opacity-90"
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
                OSM: <b className="text-[#1E5D4B]">{sourceStats?.osm ?? hits.filter((h) => (h.sources || []).some((s) => s.name === "OpenStreetMap")).length}</b>
              </span>
              <span className="rounded-md bg-[#E8F2EC] border border-[#B7D5C4] px-2.5 py-0.5 text-[#1F2937]">
                Geoapify: <b className="text-[#1E5D4B]">{sourceStats?.geoapify ?? 0}</b>
              </span>
              <span className="rounded-md bg-[#E8F2EC] border border-[#B7D5C4] px-2.5 py-0.5 text-[#1F2937]">
                Live Web: <b className="text-[#1E5D4B]">{sourceStats?.web ?? hits.filter((h) => (h.sources || []).some((s) => s.name !== "OpenStreetMap" && s.name !== "Geoapify")).length}</b>
              </span>
              <span className="rounded-md bg-[#1E5D4B] text-white px-2.5 py-0.5 font-black">
                Merged: {sourceStats?.merged ?? hits.length}
              </span>
            </div>
          )}

          {/* Direct Brokerage Quick-Access */}
          {hits.length > 0 && (
            <BrokerageBar
              landmark={point?.display_name ?? params?.landmark}
              city={params?.city_hint}
              gender={params?.preferences?.gender}
            />
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
