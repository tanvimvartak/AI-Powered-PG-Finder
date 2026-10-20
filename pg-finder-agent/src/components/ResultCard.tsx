"use client";
/**
 * Honest Result Card for real PG & student accommodations:
 * - Real source badges with links (OSM, Web, Geoapify).
 * - "Price not listed. Ask owner" when unlisted.
 * - Map / source thumbnail instead of fake AI room photos.
 * - Pre-drafted enquiry UI ("Agent drafted it. You send it.").
 * - Proposed calendar visit (marked unconfirmed by owner).
 * - "SAMPLE DATA" badge shown ONLY when is_sample === true.
 */
import { useState } from "react";
import type { EnquiryDraft, RankedListing, VisitPlan } from "@/lib/types";
import { priceColor } from "@/lib/price";

const inr = (n: number) => "Rs " + n.toLocaleString("en-IN");
const fmtSlot = (s: string) =>
  new Date(s + ":00").toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const AMENITY_ICON: Record<string, string> = {
  wifi: "📶",
  ac: "❄️",
  laundry: "🧺",
  geyser: "🚿",
  housekeeping: "🧹",
  gym: "🏋️",
  cctv: "📹",
  security: "🛡️",
  food: "🍛",
  mess: "🍽️",
};

interface Props {
  item: RankedListing;
  draft?: EnquiryDraft;
  budget: number | null;
  deadline: string | null;
  selected: boolean;
  onSelect: () => void;
  onDraftUpdate?: (d: EnquiryDraft) => void;
}

function defaultSlot() {
  const d = new Date(Date.now() + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T11:00`;
}

export default function ResultCard({
  item,
  draft: initialDraft,
  budget,
  deadline,
  selected,
  onSelect,
  onDraftUpdate,
}: Props) {
  const l = item.listing;
  const [draft, setDraft] = useState<EnquiryDraft | undefined>(initialDraft);
  const [showEnquiry, setShowEnquiry] = useState(true);
  const [copied, setCopied] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [visit, setVisit] = useState<VisitPlan | null>(null);
  const [busy, setBusy] = useState<"visit" | "draft" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const km = l.distance_m / 1000;
  const isUnknownPrice = l.price_status === "unknown" || l.monthly_rent === null;
  const color = isUnknownPrice ? "#94a3b8" : priceColor(l.monthly_rent, budget);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function requestDraft() {
    setBusy("draft");
    setErr(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_id: l.id,
          move_in_date: deadline,
          budget: budget,
          sharing_preference: l.sharing_type,
          gender: l.gender,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not generate enquiry");
      setDraft(json);
      onDraftUpdate?.(json);
      setShowEnquiry(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmVisit() {
    const dt = slot || defaultSlot();
    setBusy("visit");
    setErr(null);
    try {
      const res = await fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_id: l.id, datetime: dt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not schedule");
      setVisit(json);
      setPicking(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      id={`card-${l.id}`}
      onClick={onSelect}
      className={`glass fade-up overflow-hidden transition-all duration-300 ${
        selected
          ? "ring-2 ring-violet-400/70 shadow-[0_0_40px_-10px_rgba(139,92,246,.7)]"
          : "hover:border-white/20"
      }`}
      style={{ animationDelay: `${item.rank * 50}ms` }}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Map thumbnail / source visual container */}
        <div className="relative flex h-36 shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-violet-950/40 to-slate-900 p-3 sm:h-auto sm:w-44 border-b sm:border-b-0 sm:border-r border-white/5">
          <div className="flex items-center justify-between">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-xs font-bold text-white shadow-lg">
              #{item.rank}
            </div>
            <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-slate-300 backdrop-blur">
              {item.group === "worth_asking" ? "Worth asking" : "Top Match"}
            </span>
          </div>

          <div className="my-auto text-center py-2">
            <div className="text-2xl">📍</div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">
              {l.lat.toFixed(3)}, {l.lng.toFixed(3)}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {l.sources.map((s, idx) => (
              <a
                key={idx}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 hover:underline transition-colors"
                title={`View on ${s.name}`}
              >
                🔗 {s.name}
              </a>
            ))}
          </div>
        </div>

        {/* Details & content */}
        <div className="flex-1 space-y-2.5 p-4">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base leading-tight font-semibold text-white">{l.name}</h3>
              <p className="text-xs text-muted mt-0.5">{l.address}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {l.is_sample ? (
                <span className="badge-sample" title="This listing is fictional demo data">
                  SAMPLE DATA
                </span>
              ) : (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  Unverified
                </span>
              )}
            </div>
          </div>

          {/* Key facts & pricing */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {isUnknownPrice ? (
              <span className="text-sm font-semibold text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                Price not listed · <span className="text-amber-300">Ask owner</span>
              </span>
            ) : (
              <span className="text-xl font-bold" style={{ color }}>
                {inr(l.monthly_rent!)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </span>
            )}
            <span className="text-xs text-slate-300">
              📍 {km < 1 ? `${l.distance_m} m` : `${km.toFixed(1)} km`} · 🚶 {item.walk_minutes} min walk
            </span>
          </div>

          {/* Chips */}
          <div className="flex flex-wrap gap-1.5">
            {l.sharing_type && <span className="chip">{l.sharing_type} sharing</span>}
            <span className="chip">{l.gender === "any" ? "boys & girls" : l.gender}</span>
            {l.food_included === true && (
              <span className="chip border-emerald-400/30 text-emerald-300">🍛 meals included</span>
            )}
            {l.food_included === false && <span className="chip text-muted">no meals</span>}
            {l.contact_phone && (
              <span className="chip border-emerald-400/20 text-emerald-300">📞 Phone listed</span>
            )}
            {l.amenities.map((a) => (
              <span key={a} className="chip">
                {AMENITY_ICON[a.toLowerCase()] ?? "•"} {a}
              </span>
            ))}
          </div>

          {/* Why section */}
          <p className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-slate-200">
            <span className="font-semibold text-violet-300">Why this option: </span>
            {item.why}
          </p>

          {/* Red flags / caveats */}
          {item.red_flags.length > 0 && (
            <ul className="space-y-1">
              {item.red_flags.map((f) => (
                <li key={f} className="flex gap-1.5 text-xs text-amber-300/90">
                  <span>ℹ️</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Real Outreach & Pre-drafted enquiry */}
          <div
            className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                💬 Outreach Enquiry
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300 font-normal">
                  Agent drafted it. You send it.
                </span>
              </span>
              {draft && (
                <button
                  type="button"
                  onClick={() => setShowEnquiry((s) => !s)}
                  className="text-[11px] text-muted hover:text-white"
                >
                  {showEnquiry ? "hide" : "view"}
                </button>
              )}
            </div>

            {draft ? (
              showEnquiry && (
                <div className="space-y-2">
                  <div className="rounded-lg bg-slate-900/80 border border-white/10 p-2.5 text-xs text-slate-300 leading-relaxed font-mono">
                    "{draft.message}"
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {draft.wa_link && (
                      <a
                        href={draft.wa_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-medium transition-colors"
                        id={`wa-${l.id}`}
                      >
                        <span>🟢</span> Send on WhatsApp
                      </a>
                    )}

                    {draft.tel_link && (
                      <a
                        href={draft.tel_link}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-medium border border-white/10 transition-colors"
                        id={`tel-${l.id}`}
                      >
                        <span>📞</span> Call ({draft.phone})
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => copyText(draft.copy_text)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 text-xs font-medium border border-white/10 transition-colors"
                      id={`copy-${l.id}`}
                    >
                      {copied ? "✓ Copied!" : "📋 Copy message"}
                    </button>

                    {draft.source_url && !draft.phone && (
                      <a
                        href={draft.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-300 hover:underline"
                      >
                        View Source Listing ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-muted">Draft a personalized inquiry for this place:</span>
                <button
                  type="button"
                  className="btn-ghost text-xs py-1 px-3"
                  onClick={requestDraft}
                  disabled={busy === "draft"}
                  id={`draft-btn-${l.id}`}
                >
                  {busy === "draft" ? "Drafting..." : "✍️ Draft enquiry message"}
                </button>
              </div>
            )}
          </div>

          {/* Proposed Visit Section */}
          <div onClick={(e) => e.stopPropagation()}>
            {visit ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-slate-200">
                <span>🗓️ Proposed visit on {fmtSlot(visit.datetime)} (proposed, not confirmed by owner)</span>
                <div className="flex gap-2 ml-auto">
                  <a className="btn-ghost text-xs py-1 px-2" href={visit.ics_url} download id={`ics-${l.id}`}>
                    ⬇ .ics file
                  </a>
                  <a
                    className="btn-ghost text-xs py-1 px-2"
                    href={visit.gcal_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    id={`gcal-${l.id}`}
                  >
                    Google Calendar ↗
                  </a>
                </div>
              </div>
            ) : picking ? (
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <div className="text-xs text-muted">
                  Choose proposed visit time (to add to your calendar):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <input
                    type="datetime-local"
                    className="chip bg-transparent text-ink [color-scheme:dark]"
                    value={slot || defaultSlot()}
                    onChange={(e) => setSlot(e.target.value)}
                    aria-label="Proposed visit time"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={confirmVisit}
                    disabled={busy === "visit"}
                    id={`confirm-slot-${l.id}`}
                  >
                    {busy === "visit" ? "Scheduling..." : "Add to Calendar"}
                  </button>
                  <button type="button" className="btn-ghost text-xs" onClick={() => setPicking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost w-full py-2 text-xs sm:w-auto"
                onClick={() => setPicking(true)}
                id={`propose-visit-${l.id}`}
              >
                📅 Propose a visit (save to calendar)
              </button>
            )}
            {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}
