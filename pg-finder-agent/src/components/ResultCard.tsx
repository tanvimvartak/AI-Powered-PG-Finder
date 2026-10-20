"use client";
/**
 * Honest Result Card for real PG & student accommodations:
 * - Modern Calm Trustworthy styling (Deep Teal, Warm Beige, Leaf Mist, Terracotta, Charcoal, Slate)
 * - Real source badges with links (OSM, Web, Geoapify).
 * - "Price not listed · Ask owner" when unlisted.
 * - Clean Leaf Mist thumbnail container with coordinates & sources.
 * - Pre-drafted enquiry UI ("Agent drafted it. You send it.").
 * - Proposed calendar visit (marked unconfirmed by owner).
 * - "SAMPLE DATA" badge shown ONLY when is_sample === true.
 */
import { useState } from "react";
import type { EnquiryDraft, RankedListing, VisitPlan } from "@/lib/types";
import { priceColor } from "@/lib/price";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
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
  cctv: "🛡️",
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
  const color = isUnknownPrice ? "#64748B" : priceColor(l.monthly_rent, budget);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate draft");
      setDraft(data);
      onDraftUpdate?.(data);
    } catch (e: any) {
      setErr(e.message || "Failed to create draft");
    } finally {
      setBusy(null);
    }
  }

  async function confirmVisit() {
    const chosen = slot || defaultSlot();
    setBusy("visit");
    setErr(null);
    try {
      const res = await fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_id: l.id,
          slot: chosen,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule visit");
      setVisit(data);
      setPicking(false);
    } catch (e: any) {
      setErr(e.message || "Failed to schedule visit");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      id={`card-${l.id}`}
      onClick={onSelect}
      className={`fade-up cursor-pointer overflow-hidden rounded-2xl border transition-all duration-200 bg-white ${
        selected
          ? "border-[#1E5D4B] ring-2 ring-[#1E5D4B]/30 shadow-md"
          : "border-[#E5E7EB] hover:border-[#4F8F74] hover:shadow-sm"
      }`}
      style={{ animationDelay: `${item.rank * 50}ms` }}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Visual / source summary container */}
        <div className="relative flex h-36 shrink-0 flex-col justify-between overflow-hidden bg-[#E8F2EC] p-3.5 sm:h-auto sm:w-44 border-b sm:border-b-0 sm:border-r border-[#D5E4DB]">
          <div className="flex items-center justify-between">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#1E5D4B] text-xs font-bold text-white shadow-sm">
              #{item.rank}
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#1E5D4B] border border-[#D5E4DB] shadow-xs">
              {item.group === "worth_asking" ? "Worth Asking" : "Top Match"}
            </span>
          </div>

          <div className="my-auto py-2 text-center">
            <div className="text-2xl">🏡</div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
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
                className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#1E5D4B] border border-[#D5E4DB] hover:bg-[#1E5D4B] hover:text-white transition-colors"
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
              <h3 className="text-base font-bold leading-tight text-[#1F2937]">{l.name}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{l.address}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {l.is_sample ? (
                <span className="badge-sample" title="This listing is fictional demo data">
                  SAMPLE DATA
                </span>
              ) : (
                <span className="badge-verified flex items-center gap-1">
                  <span>🛡️</span> Verified
                </span>
              )}
            </div>
          </div>

          {/* Pricing & distance */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {isUnknownPrice ? (
              <span className="rounded-lg bg-[#E8F2EC] px-2.5 py-1 text-xs font-semibold text-[#1F2937] border border-[#D5E4DB]">
                Price unlisted · <span className="text-[#F08A5D]">Ask owner</span>
              </span>
            ) : (
              <span className="text-xl font-extrabold" style={{ color }}>
                {inr(l.monthly_rent!)}
                <span className="text-xs font-normal text-slate-500">/mo</span>
              </span>
            )}
            <span className="text-xs text-slate-600 font-medium">
              📍 {km < 1 ? `${l.distance_m} m` : `${km.toFixed(1)} km`} · 🚶 {item.walk_minutes} min walk
            </span>
          </div>

          {/* Amenities & preferences chips */}
          <div className="flex flex-wrap gap-1.5">
            {l.sharing_type && <span className="chip">{l.sharing_type} sharing</span>}
            <span className="chip">{l.gender === "any" ? "boys & girls" : l.gender}</span>
            {l.food_included === true && (
              <span className="chip text-[#1E5D4B] font-semibold">🍛 meals included</span>
            )}
            {l.food_included === false && <span className="chip text-slate-500">no meals</span>}
            {l.contact_phone && (
              <span className="chip text-[#1E5D4B]">📞 Phone listed</span>
            )}
            {l.amenities.map((a) => (
              <span key={a} className="chip">
                {AMENITY_ICON[a.toLowerCase()] ?? "•"} {a}
              </span>
            ))}
          </div>

          {/* Why this option */}
          <div className="rounded-xl border border-[#D5E4DB] bg-[#E8F2EC] px-3 py-2 text-xs leading-relaxed text-slate-700">
            <span className="font-bold text-[#1E5D4B]">Why this option: </span>
            {item.why}
          </div>

          {/* Red flags / caveats */}
          {item.red_flags.length > 0 && (
            <ul className="space-y-1">
              {item.red_flags.map((f) => (
                <li key={f} className="flex gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg p-1.5 border border-amber-200">
                  <span>ℹ️</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Outreach Enquiry section */}
          <div
            className="rounded-xl border border-[#E5E7EB] bg-[#FFF8F2] p-3 text-sm space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#1F2937]">
                💬 Outreach Enquiry
                <span className="rounded-full bg-[#E8F2EC] px-2 py-0.5 text-[10px] font-semibold text-[#1E5D4B] border border-[#D5E4DB]">
                  Agent drafted · You send
                </span>
              </span>
              {draft && (
                <button
                  type="button"
                  onClick={() => setShowEnquiry((s) => !s)}
                  className="text-[11px] font-semibold text-[#1E5D4B] hover:underline"
                >
                  {showEnquiry ? "hide" : "view"}
                </button>
              )}
            </div>

            {draft ? (
              showEnquiry && (
                <div className="space-y-2">
                  <div className="rounded-lg bg-white border border-[#E5E7EB] p-2.5 text-xs text-slate-700 leading-relaxed font-mono">
                    "{draft.message}"
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {draft.wa_link && (
                      <a
                        href={draft.wa_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#1E5D4B] hover:bg-[#16483A] text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors"
                        id={`wa-${l.id}`}
                      >
                        <span>🟢</span> Send on WhatsApp
                      </a>
                    )}

                    {draft.tel_link && (
                      <a
                        href={draft.tel_link}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white hover:bg-[#E8F2EC] text-[#1F2937] px-3.5 py-1.5 text-xs font-semibold border border-[#E5E7EB] transition-colors"
                        id={`tel-${l.id}`}
                      >
                        <span>📞</span> Call ({draft.phone})
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => copyText(draft.copy_text)}
                      className="inline-flex items-center gap-1 rounded-full bg-white hover:bg-[#E8F2EC] text-slate-600 px-3 py-1.5 text-xs font-medium border border-[#E5E7EB] transition-colors"
                      id={`copy-${l.id}`}
                    >
                      {copied ? "✓ Copied!" : "📋 Copy message"}
                    </button>

                    {draft.source_url && !draft.phone && (
                      <a
                        href={draft.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E5D4B] hover:underline"
                      >
                        View Source Listing ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-slate-500">Draft a personalized inquiry for this place:</span>
                <button
                  type="button"
                  className="btn-secondary text-xs py-1 px-3"
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
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D5E4DB] bg-[#E8F2EC] p-3 text-xs text-slate-800">
                <span>🗓️ Proposed visit on <b>{fmtSlot(visit.datetime)}</b> (pending owner confirmation)</span>
                <div className="flex gap-2 ml-auto">
                  <a className="btn-ghost text-xs py-1 px-2.5" href={visit.ics_url} download id={`ics-${l.id}`}>
                    ⬇ .ics file
                  </a>
                  <a
                    className="btn-ghost text-xs py-1 px-2.5"
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
              <div className="space-y-2 rounded-xl border border-[#E5E7EB] bg-white p-3">
                <div className="text-xs font-medium text-slate-600">
                  Choose proposed visit time (to add to your calendar):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <input
                    type="datetime-local"
                    className="chip bg-[#FFF8F2] text-[#1F2937]"
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
                className="btn-ghost w-full py-2 text-xs sm:w-auto font-medium"
                onClick={() => setPicking(true)}
                id={`propose-visit-${l.id}`}
              >
                📅 Propose a visit (save to calendar)
              </button>
            )}
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}
