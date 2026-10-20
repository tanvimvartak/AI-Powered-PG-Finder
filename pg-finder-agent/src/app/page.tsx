"use client";
/**
 * StayLocal PG Finder Agent
 * Modern • Calm • Trustworthy design overhaul
 * Color Palette:
 * - Deep Teal (#1E5D4B): Primary buttons, links, navigation, active states
 * - Warm Beige (#FFF8F2): Main background and page sections
 * - Leaf Mist (#E8F2EC): Search panels, filter chips, subtle highlights
 * - Terracotta (#F08A5D): Price badges, favourite indicators, accents
 * - Charcoal (#1F2937): Headings and body text
 * - Slate (#64748B): Secondary text, metadata
 * - Sage Green (#4F8F74): Secondary buttons, icons, success states
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

const POPULAR_PGS = [
  {
    name: "Green Haven PG",
    distance: "1.2 km from Mithibai College",
    price: 7500,
    tags: ["Girls Only", "AC", "WiFi"],
    rating: 4.5,
    reviews: 120,
    query: "Green Haven PG near Mithibai College, budget Rs 7500, girls only",
    icon: "🌿",
  },
  {
    name: "Sunrise Residency",
    distance: "1.8 km from Mithibai College",
    price: 6800,
    tags: ["Girls Only", "WiFi", "Meals"],
    rating: 4.3,
    reviews: 98,
    query: "Sunrise Residency near Mithibai College, budget Rs 7000, with meals",
    icon: "🌅",
  },
  {
    name: "The Nest PG",
    distance: "2.4 km from Mithibai College",
    price: 8000,
    tags: ["Both Genders", "AC", "WiFi"],
    rating: 4.2,
    reviews: 76,
    query: "The Nest PG near Mithibai College, budget Rs 8000, AC room",
    icon: "🪺",
  },
  {
    name: "Comfort Stays",
    distance: "3.1 km from Mithibai College",
    price: 5800,
    tags: ["Girls Only", "Meals", "Laundry"],
    rating: 4.0,
    reviews: 54,
    query: "Comfort Stays near Mithibai College, budget Rs 6000",
    icon: "☕",
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
  const [liked, setLiked] = useState<Set<string>>(new Set());
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

  const appendFilter = (chip: string) => {
    setText((prev) => {
      const clean = prev.trim();
      return clean ? `${clean}, ${chip}` : chip;
    });
  };

  const toggleLike = (name: string) => {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // ───────────────────────────── HOME ─────────────────────────────
  if (phase === "home") {
    return (
      <div className="flex min-h-screen flex-col bg-[#FFF8F2]">
        {/* Navigation Bar */}
        <header className="sticky top-0 z-40 w-full border-b border-[#E5E7EB] bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
            <div className="flex items-center gap-8">
              <a href="#" className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-[#1E5D4B]">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1E5D4B] text-white shadow-sm">
                  🏡
                </span>
                <span>StayLocal</span>
              </a>
              <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
                <a href="#home" className="text-[#1E5D4B] font-semibold">Home</a>
                <a href="#popular" className="hover:text-[#1E5D4B] transition-colors">PGs</a>
                <a href="#features" className="hover:text-[#1E5D4B] transition-colors">Locations</a>
                <a href="#about" className="hover:text-[#1E5D4B] transition-colors">About</a>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-slate-600 hover:text-[#F08A5D] hover:border-[#F08A5D]/40 transition-colors"
                aria-label="Favorites"
              >
                ♡
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-slate-600 hover:text-[#1E5D4B] transition-colors"
                aria-label="Notifications"
              >
                🔔
              </button>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1E5D4B] text-sm font-bold text-white shadow-xs"
                title="Tanvi Vartak"
              >
                T
              </div>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-8 pb-16 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#E8F2EC]/60 via-[#FFF8F2] to-[#FFF8F2] px-6 py-10 sm:px-12 sm:py-14 border border-[#E8F2EC]">
            {/* Top Pill */}
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#E8F2EC] px-3.5 py-1 text-xs font-semibold text-[#1E5D4B] border border-[#D5E4DB]">
              <span className="h-2 w-2 rounded-full bg-[#4F8F74]" /> Find your perfect PG
            </div>

            <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
              <div>
                <h1 className="text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl lg:text-6xl leading-[1.15]">
                  Find a PG that <br />
                  feels like <span className="text-[#1E5D4B] underline decoration-[#4F8F74]/30 decoration-wavy">home</span>.
                </h1>
                <p className="mt-4 max-w-xl text-base text-[#64748B] sm:text-lg">
                  Safe, affordable and verified PGs near your college, workplace or favourite area. Just describe what you need in plain English.
                </p>
              </div>

              {/* Decorative side illustration badge */}
              <div className="hidden lg:flex flex-col items-center justify-center rounded-2xl bg-white/80 p-6 border border-[#E5E7EB] shadow-sm backdrop-blur">
                <span className="text-4xl">🪴</span>
                <p className="mt-2 text-sm font-semibold text-[#1F2937]">"Your next chapter starts here ♡"</p>
                <p className="text-xs text-[#64748B] mt-0.5">Verified listings · Zero brokerage · Owner outreach</p>
              </div>
            </div>

            {/* Floating Search Panel */}
            <div className="mt-8 rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:p-5 shadow-lg shadow-[#1E5D4B]/5">
              {/* Natural language query box */}
              <div className="rounded-xl border border-[#E5E7EB] bg-[#FFF8F2]/60 p-3 focus-within:border-[#1E5D4B] focus-within:bg-white transition-all">
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
                  rows={2}
                  placeholder={voice.listening ? "Listening... speak your request now" : "Where do you want to stay? e.g. Mithibai College within 1 km, budget Rs 5,000, need in 5 days"}
                  className="w-full resize-none bg-transparent px-2 py-1 text-base sm:text-lg text-[#1F2937] outline-none placeholder:text-slate-400"
                  aria-label="Describe the PG you need"
                />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E5E7EB]/80">
                  <div className="flex items-center gap-3">
                    <button
                      id="mic-btn"
                      type="button"
                      onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
                      disabled={voice.supported === false}
                      className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#E8F2EC] text-lg text-[#1E5D4B] hover:bg-[#D9EBE0] transition disabled:opacity-40"
                      aria-label={voice.listening ? "Stop listening" : "Speak your request"}
                      title="Voice input in English or Hinglish"
                    >
                      {voice.listening && (
                        <>
                          <span className="mic-ring" />
                          <span className="mic-ring delay" />
                        </>
                      )}
                      <span className="relative">{voice.listening ? "■" : "🎙️"}</span>
                    </button>
                    <div className="text-xs text-[#64748B]">
                      {voice.listening ? (
                        <span className="flex items-center gap-2 text-[#1E5D4B] font-semibold">
                          <span className="eq">
                            <span />
                            <span />
                            <span />
                            <span />
                          </span>
                          Listening... speak now
                        </span>
                      ) : voice.error ? (
                        <span className="text-amber-600">{voice.error}</span>
                      ) : (
                        <span>Tap mic to speak, or type. Enter to search.</span>
                      )}
                    </div>
                  </div>

                  <button
                    id="send-btn"
                    type="button"
                    onClick={submit}
                    disabled={!text.trim()}
                    className="btn-primary flex items-center gap-2"
                  >
                    <span>Find PGs</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Filter Chips row underneath search */}
              <div className="mt-4 flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-slate-500 mr-1">Quick Filters:</span>
                <button
                  type="button"
                  onClick={() => appendFilter("near college")}
                  className="chip hover:border-[#1E5D4B] cursor-pointer"
                >
                  🎓 Near College
                </button>
                <button
                  type="button"
                  onClick={() => appendFilter("girls only")}
                  className="chip hover:border-[#1E5D4B] cursor-pointer"
                >
                  👩 Girls Only
                </button>
                <button
                  type="button"
                  onClick={() => appendFilter("under Rs 8000")}
                  className="chip hover:border-[#1E5D4B] cursor-pointer"
                >
                  💰 Under ₹8k
                </button>
                <button
                  type="button"
                  onClick={() => appendFilter("fully furnished")}
                  className="chip hover:border-[#1E5D4B] cursor-pointer"
                >
                  🛋️ Fully Furnished
                </button>
                <button
                  type="button"
                  onClick={() => appendFilter("AC room")}
                  className="chip hover:border-[#1E5D4B] cursor-pointer"
                >
                  ❄️ AC Rooms
                </button>
              </div>
            </div>

            {/* Tap to try queries */}
            <div className="mt-6">
              <p className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
                Tap to try example prompts:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={ex}
                    id={`example-${i}`}
                    type="button"
                    onClick={() => setText(ex)}
                    className={`rounded-full border px-3.5 py-1.5 text-left text-xs font-medium transition-all ${
                      i === 0
                        ? "border-[#1E5D4B] bg-[#E8F2EC] text-[#1E5D4B] font-semibold"
                        : "border-[#E5E7EB] bg-white text-slate-700 hover:border-[#4F8F74] hover:bg-[#F9FBFA]"
                    }`}
                  >
                    {ex.length > 70 ? ex.slice(0, 68) + "…" : ex}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Popular PGs Near You Section (Matching Screenshot 2) */}
          <section id="popular" className="mt-14">
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-[#1F2937]">
                  <span className="text-[#1E5D4B]">📍</span>
                  <h2>Popular PGs near you</h2>
                </div>
                <p className="mt-1 text-sm text-[#64748B]">
                  Handpicked student accommodations based on your location and preferences.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setText("PG near Mithibai college within 1.5 km");
                  submit();
                }}
                className="text-sm font-semibold text-[#1E5D4B] hover:underline"
              >
                See all →
              </button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {POPULAR_PGS.map((pg, idx) => (
                <div
                  key={idx}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white transition-all duration-200 hover:-translate-y-1 hover:border-[#1E5D4B]/40 hover:shadow-md"
                >
                  {/* Card top banner / icon */}
                  <div className="relative flex h-36 items-center justify-center bg-gradient-to-br from-[#E8F2EC] to-[#D9EBE0] text-5xl">
                    <span>{pg.icon}</span>
                    <button
                      type="button"
                      onClick={() => toggleLike(pg.name)}
                      className={`absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-xs transition ${
                        liked.has(pg.name) ? "text-[#F08A5D]" : "text-slate-400 hover:text-[#F08A5D]"
                      }`}
                      aria-label="Save to favorites"
                    >
                      {liked.has(pg.name) ? "♥" : "♡"}
                    </button>
                    <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-semibold text-[#1E5D4B] border border-[#D5E4DB] flex items-center gap-1">
                      <span>🛡️</span> Verified
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="text-base font-bold text-[#1F2937] group-hover:text-[#1E5D4B] transition-colors">
                      {pg.name}
                    </h3>
                    <p className="text-xs text-[#64748B] mt-0.5 flex items-center gap-1">
                      <span>📍</span> {pg.distance}
                    </p>

                    <div className="mt-3 flex items-baseline gap-1 text-lg font-extrabold text-[#1F2937]">
                      <span>₹{pg.price.toLocaleString("en-IN")}</span>
                      <span className="text-xs font-normal text-[#64748B]">/ month</span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {pg.tags.map((tag) => (
                        <span key={tag} className="chip text-[11px] py-0.5 px-2">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-3 text-xs">
                      <span className="font-semibold text-slate-700">
                        ⭐ {pg.rating} <span className="font-normal text-slate-400">({pg.reviews})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setText(pg.query);
                          run({ text: pg.query });
                        }}
                        className="font-semibold text-[#1E5D4B] hover:underline"
                      >
                        View Details →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Trust and Values Footer Bar (Matching Screenshot 2) */}
          <section id="features" className="mt-14 rounded-2xl border border-[#E5E7EB] bg-white p-6 sm:p-8 shadow-xs">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F2EC] text-xl text-[#1E5D4B]">
                  🛡️
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[#1F2937]">Verified Listings</h4>
                  <p className="text-xs text-[#64748B] mt-0.5">Real photos, legitimate owner contacts</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F2EC] text-xl text-[#1E5D4B]">
                  👥
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[#1F2937]">Trusted by Students</h4>
                  <p className="text-xs text-[#64748B] mt-0.5">1,000+ happy student residents</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F2EC] text-xl text-[#1E5D4B]">
                  🎧
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[#1F2937]">24/7 AI Assistance</h4>
                  <p className="text-xs text-[#64748B] mt-0.5">Instant search, ranking & enquiry drafts</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F2EC] text-xl text-[#1E5D4B]">
                  📍
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[#1F2937]">Better Local Insights</h4>
                  <p className="text-xs text-[#64748B] mt-0.5">Walking distance to colleges and metros</p>
                </div>
              </div>
            </div>
          </section>

          {/* Warm Footer Flourish */}
          <footer className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#E5E7EB] pt-6 text-xs text-[#64748B]">
            <div className="font-medium">
              Better stays. Brighter days. · <i>More than just a room ♡</i>
            </div>
            <div>
              © 2026 StayLocal PG Finder. Powered by OpenStreetMap & AI Agent.
            </div>
          </footer>
        </main>
      </div>
    );
  }

  // ───────────────────────────── AGENT PHASE ─────────────────────────────
  const budget = params?.max_budget ?? null;
  const showEmpty = !running && !error && !clarify && finalText !== null && ranked.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#FFF8F2]">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-[#E5E7EB] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <button
            id="home-btn"
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setPhase("home");
            }}
            className="flex items-center gap-2 text-lg font-bold text-[#1E5D4B] whitespace-nowrap"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1E5D4B] text-white text-sm">
              🏡
            </span>
            <span>StayLocal</span>
          </button>

          <div className="flex flex-1 items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#FFF8F2] px-3.5 py-1.5 focus-within:border-[#1E5D4B] focus-within:bg-white transition-all">
            <input
              id="agent-query"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="min-w-0 flex-1 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-slate-400"
              aria-label="Your request"
            />
            <button
              type="button"
              onClick={() => (voice.listening ? voice.stop() : voice.start(""))}
              disabled={voice.supported === false}
              className="relative grid h-7 w-7 place-items-center rounded-full bg-[#E8F2EC] text-xs text-[#1E5D4B]"
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
              className="btn-primary py-1 px-3.5 text-xs font-semibold"
            >
              {running ? "…" : "Search"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        {params && (
          <div className="mb-4">
            <ParamChips key={paramsKey} params={params} disabled={running} onRerun={rerun} />
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(340px,420px)_1fr]">
          {/* LEFT: Timeline + Recommendations + Clarifications */}
          <div className="space-y-4">
            <Timeline items={timeline} running={running} />

            {relaxations.length > 0 && relaxDecision === "pending" && !running && (
              <div className="fade-up rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
                <div className="mb-1 font-bold text-amber-800">I relaxed your constraints</div>
                <ul className="mb-3 list-disc space-y-1 pl-5 text-amber-900">
                  {relaxations.map((r, i) => (
                    <li key={i}>{r.message}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    id="accept-relax"
                    type="button"
                    className="btn-primary py-1.5 px-4 text-xs font-semibold"
                    onClick={() => setRelaxDecision("accepted")}
                  >
                    Accept
                  </button>
                  <button
                    id="reject-relax"
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={rejectRelaxation}
                  >
                    Reject: keep original limits
                  </button>
                </div>
              </div>
            )}

            {clarify && !running && (
              <div className="fade-up rounded-2xl border border-[#D5E4DB] bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-[#1F2937]">🤔 {clarify}</div>
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
                    className="flex-1 rounded-full border border-[#E5E7EB] bg-[#FFF8F2] px-3.5 py-1.5 text-sm text-[#1F2937] outline-none focus:border-[#1E5D4B]"
                    placeholder="e.g. Mithibai College, Vile Parle"
                  />
                  <button type="submit" className="btn-primary py-1.5 px-4 text-xs font-semibold">
                    Send
                  </button>
                </form>
              </div>
            )}

            {finalText && !clarify && (
              <section className="fade-up rounded-2xl border border-[#D5E4DB] bg-[#E8F2EC] p-4 text-slate-800" aria-label="Agent recommendation">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wider text-[#1E5D4B] uppercase">
                  ✨ Recommendation
                </h2>
                <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">
                  {finalText.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
                    part.startsWith("**") && part.endsWith("**") ? (
                      <b key={i} className="text-[#1E5D4B]">
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
              <div className="fade-up rounded-2xl border border-red-300 bg-red-50 p-4 text-sm">
                <div className="mb-1 font-bold text-red-800">Something went wrong</div>
                <p className="mb-3 text-red-700 text-xs">{error}</p>
                <button
                  id="retry-btn"
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => lastBody.current && run(lastBody.current)}
                >
                  ↻ Try again
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: Map + Discovered listings */}
          <div className="space-y-4">
            <div className="relative h-[42vh] min-h-[300px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-sm lg:h-[480px]">
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
              <div className="pointer-events-none absolute right-3 bottom-3 z-[500] flex flex-col gap-1 rounded-xl bg-white/90 p-2 text-[10px] font-medium text-slate-700 shadow-md border border-[#E5E7EB]">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1E5D4B]" />within budget</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#F08A5D]" />near budget</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#64748B]" />price unlisted</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />over budget</span>
              </div>
              {hits.length > 0 && (
                <div className="pointer-events-none absolute top-3 left-3 z-[500] rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-[#1E5D4B] shadow-sm border border-[#E5E7EB]">
                  {hits.length} live places · {(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km radius
                </div>
              )}
            </div>

            {/* Data sources chip row */}
            {hits.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-slate-500">Live Sources:</span>
                <span className="rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-slate-700 border border-[#D5E4DB]">
                  OSM: <b className="text-[#1E5D4B]">{sourceStats?.osm ?? hits.filter((h) => h.sources.some((s) => s.name === "OpenStreetMap")).length}</b>
                </span>
                <span className="rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-slate-700 border border-[#D5E4DB]">
                  Geoapify: <b className="text-[#1E5D4B]">{sourceStats?.geoapify ?? 0}</b>
                </span>
                <span className="rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-slate-700 border border-[#D5E4DB]">
                  Web Discovery: <b className="text-[#1E5D4B]">{sourceStats?.web ?? hits.filter((h) => h.sources.some((s) => s.name !== "OpenStreetMap" && s.name !== "Geoapify")).length}</b>
                </span>
                <span className="rounded-full bg-[#1E5D4B] px-2.5 py-0.5 text-white font-semibold ml-auto">
                  Total Discovered: {sourceStats?.merged ?? hits.length}
                </span>
              </div>
            )}

            {/* Results partitioned by group */}
            {ranked.length > 0 && (
              <section aria-label="Ranked PGs" className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-bold text-[#1F2937]">Discovered Accommodations</h2>
                  <span className="text-xs text-[#64748B]">Live public sources · Real verified contacts</span>
                </div>

                {/* Top matches with listed prices */}
                {ranked.filter((r) => r.group === "top_match").length > 0 && (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#1E5D4B]">
                      <span>✓</span> Top Matches (Prices Within Budget)
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
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                      <span>💬</span> Worth Asking About (Contact Owner For Exact Rent)
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
                  <div key={i} className="skeleton h-36 rounded-2xl" />
                ))}
              </div>
            )}

            {showEmpty && (
              <div className="fade-up rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center space-y-3 shadow-xs">
                <div className="text-4xl">🔍</div>
                <h2 className="text-base font-bold text-[#1F2937]">No Accommodations Found Near "{params?.landmark || "Destination"}"</h2>
                <p className="mx-auto max-w-md text-xs text-[#64748B] leading-relaxed">
                  We searched live across <b>OpenStreetMap</b>, <b>Geoapify Places</b>, and <b>Live Web Discovery</b>, but found 0 advertised listings within {(radius / 1000).toFixed(1)} km.
                </p>
                <div className="rounded-xl bg-[#FFF8F2] border border-[#E5E7EB] p-3.5 max-w-md mx-auto text-left text-xs space-y-1">
                  <div className="font-semibold text-[#1F2937]">Tips to expand:</div>
                  <div className="text-[#64748B]">• Try expanding radius to 2 km or 5 km.</div>
                  <div className="text-[#64748B]">• Try a nearby railway or metro station name.</div>
                  <div className="text-[#64748B]">• Remove budget cap to view all nearby hostels.</div>
                </div>
                {params && (
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <button
                      id="empty-wider"
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => rerun({ radius_m: Math.min(params.radius_m * 2, 8000) })}
                    >
                      Try {(Math.min(params.radius_m * 2, 8000) / 1000).toFixed(1)} km
                    </button>
                    {params.max_budget && (
                      <button
                        id="empty-budget"
                        type="button"
                        className="btn-ghost text-xs"
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

        <footer className="mt-10 pb-6 text-center text-xs text-[#64748B]">
          Listings sourced from live public directories. Prices and availability are unverified until confirmed with owner. · Map © OpenStreetMap contributors
        </footer>
      </main>
    </div>
  );
}
