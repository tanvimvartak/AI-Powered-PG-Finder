"use client";
/**
 * Honest Result Card for real PG & student accommodations:
 * - High-contrast Modern Calm Trustworthy styling
 * - All text is rich Charcoal (#1F2937) and Dark Slate (#334155) - zero faint light-grey text
 * - Prominent, high-contrast action buttons
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
  const color = isUnknownPrice ? "#334155" : priceColor(l.monthly_rent, budget);

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
      className={`fade-up cursor-pointer overflow-hidden rounded-2xl border-2 transition-all duration-200 bg-white ${
        selected
          ? "border-[#1E5D4B] ring-4 ring-[#1E5D4B]/20 shadow-lg"
          : "border-[#CBD5E1] hover:border-[#1E5D4B] hover:shadow-md"
      }`}
      style={{ animationDelay: `${item.rank * 50}ms` }}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Left Thumbnail & Source Info */}
        <div className="relative flex h-36 shrink-0 flex-col justify-between overflow-hidden bg-[#E8F2EC] p-3.5 sm:h-auto sm:w-44 border-b sm:border-b-0 sm:border-r border-[#B7D5C4]">
          <div className="flex items-center justify-between">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#1E5D4B] text-xs font-black text-white shadow-sm">
              #{item.rank}
            </div>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-[#1E5D4B] border border-[#B7D5C4] shadow-xs">
              {item.group === "worth_asking" ? "Worth Asking" : "Top Match"}
            </span>
          </div>

          <div className="my-auto py-2 text-center">
            <div className="text-3xl">🏡</div>
            <div className="mt-1 font-mono text-xs font-bold text-[#1F2937]">
              {l.lat.toFixed(3)}, {l.lng.toFixed(3)}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {(l.sources || []).map((s, idx) => (
              <a
                key={idx}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-[#1E5D4B] border border-[#B7D5C4] hover:bg-[#1E5D4B] hover:text-white transition-colors"
                title={`View on ${s.name}`}
              >
                🔗 {s.name}
              </a>
            ))}
          </div>
        </div>

        {/* Right Details Container */}
        <div className="flex-1 space-y-3 p-4">
          {/* Title & Badge */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-black leading-tight text-[#1F2937]">{l.name}</h3>
              <p className="mt-1 text-xs font-semibold text-[#334155]">{l.address}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {l.is_sample ? (
                <span className="badge-sample font-black text-[#C2410C]">
                  SAMPLE DATA
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-xs font-black text-[#1E5D4B] border border-[#B7D5C4]">
                  <span>🛡️</span> Verified
                </span>
              )}
            </div>
          </div>

          {/* Pricing & Distance */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {isUnknownPrice ? (
              <span className="rounded-lg bg-[#E8F2EC] px-3 py-1 text-xs font-bold text-[#1F2937] border border-[#B7D5C4]">
                Price unlisted · <span className="font-extrabold text-[#C2410C]">Ask owner</span>
              </span>
            ) : (
              <span className="text-2xl font-black" style={{ color }}>
                {inr(l.monthly_rent!)}
                <span className="text-xs font-bold text-[#334155]">/mo</span>
              </span>
            )}
            <span className="text-xs font-extrabold text-[#1F2937]">
              📍 {km < 1 ? `${l.distance_m} m` : `${km.toFixed(1)} km`} · 🚶 {item.walk_minutes} min walk
            </span>
          </div>

          {/* Feature Chips */}
          <div className="flex flex-wrap gap-1.5">
            {l.sharing_type && <span className="chip">{l.sharing_type} sharing</span>}
            <span className="chip font-bold text-[#1F2937]">{l.gender === "any" ? "boys & girls" : l.gender}</span>
            {l.food_included === true && (
              <span className="chip font-bold text-[#1E5D4B]">🍛 meals included</span>
            )}
            {l.food_included === false && <span className="chip font-bold text-[#334155]">no meals</span>}
            {l.contact_phone && (
              <span className="chip font-bold text-[#1E5D4B]">📞 Phone listed</span>
            )}
            {l.amenities.map((a) => (
              <span key={a} className="chip font-bold text-[#1F2937]">
                {AMENITY_ICON[a.toLowerCase()] ?? "•"} {a}
              </span>
            ))}
          </div>

          {/* Why this option */}
          <div className="rounded-xl border border-[#B7D5C4] bg-[#E8F2EC] px-3.5 py-2.5 text-xs leading-relaxed">
            <span className="font-extrabold text-[#1E5D4B]">Why this option: </span>
            <span className="font-bold text-[#1F2937]">{item.why}</span>
          </div>

          {/* Red flags */}
          {item.red_flags.length > 0 && (
            <ul className="space-y-1">
              {item.red_flags.map((f) => (
                <li key={f} className="flex gap-1.5 text-xs font-bold text-[#9A3412] bg-[#FEF3C7] rounded-lg p-2 border border-[#FDE68A]">
                  <span>ℹ️</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Outreach Enquiry Section */}
          <div
            className="rounded-xl border-2 border-[#CBD5E1] bg-[#FFFFFF] p-3.5 text-sm space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-black text-[#1F2937]">
                💬 Outreach Enquiry
                <span className="rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-[11px] font-extrabold text-[#1E5D4B] border border-[#B7D5C4]">
                  Agent drafted · You send
                </span>
              </span>
              {draft && (
                <button
                  type="button"
                  onClick={() => setShowEnquiry((s) => !s)}
                  className="text-xs font-bold text-[#1E5D4B] hover:underline"
                >
                  {showEnquiry ? "hide" : "view"}
                </button>
              )}
            </div>

            {draft ? (
              showEnquiry && (
                <div className="space-y-2.5">
                  <div className="rounded-lg bg-[#F8FAFC] border border-[#CBD5E1] p-3 text-xs text-[#1F2937] font-semibold leading-relaxed font-mono">
                    "{draft.message}"
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {draft.wa_link && (
                      <a
                        href={draft.wa_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#16A34A] hover:bg-[#15803D] text-white px-4 py-2 text-xs font-black shadow-xs transition-colors"
                        id={`wa-${l.id}`}
                      >
                        <span>🟢</span> Send on WhatsApp
                      </a>
                    )}

                    {draft.tel_link && (
                      <a
                        href={draft.tel_link}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#334155] hover:bg-[#1E293B] text-white px-4 py-2 text-xs font-black transition-colors"
                        id={`tel-${l.id}`}
                      >
                        <span>📞</span> Call ({draft.phone})
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => copyText(draft.copy_text)}
                      className="inline-flex items-center gap-1 rounded-full bg-white hover:bg-[#E8F2EC] text-[#1F2937] px-3.5 py-2 text-xs font-bold border-2 border-[#CBD5E1] transition-colors"
                      id={`copy-${l.id}`}
                    >
                      {copied ? "✓ Copied!" : "📋 Copy message"}
                    </button>

                    {draft.source_url && !draft.phone && (
                      <a
                        href={draft.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-extrabold text-[#1E5D4B] hover:underline ml-auto"
                      >
                        View Source Listing ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-xs font-bold text-[#334155]">Draft a personalized inquiry for this place:</span>
                <button
                  type="button"
                  className="btn-secondary text-xs font-extrabold"
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
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#B7D5C4] bg-[#E8F2EC] p-3 text-xs font-bold text-[#1F2937]">
                <span>🗓️ Proposed visit on <b className="text-[#1E5D4B] font-black">{fmtSlot(visit.datetime)}</b> (pending owner confirmation)</span>
                <div className="flex gap-2 ml-auto">
                  <a className="btn-ghost text-xs py-1 px-3 font-bold" href={visit.ics_url} download id={`ics-${l.id}`}>
                    ⬇ .ics file
                  </a>
                  <a
                    className="btn-ghost text-xs py-1 px-3 font-bold"
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
              <div className="space-y-2 rounded-xl border-2 border-[#CBD5E1] bg-white p-3.5">
                <div className="text-xs font-extrabold text-[#1F2937]">
                  Choose proposed visit time (to add to your calendar):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <input
                    type="datetime-local"
                    className="chip bg-[#FFF8F2] text-[#1F2937] font-bold"
                    value={slot || defaultSlot()}
                    onChange={(e) => setSlot(e.target.value)}
                    aria-label="Proposed visit time"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-primary px-4 py-1.5 text-xs font-black"
                    onClick={confirmVisit}
                    disabled={busy === "visit"}
                    id={`confirm-slot-${l.id}`}
                  >
                    {busy === "visit" ? "Scheduling..." : "Add to Calendar"}
                  </button>
                  <button type="button" className="btn-ghost text-xs font-bold" onClick={() => setPicking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost w-full py-2.5 text-xs sm:w-auto font-black text-[#1E5D4B] border-2 border-[#1E5D4B] hover:bg-[#E8F2EC]"
                onClick={() => setPicking(true)}
                id={`propose-visit-${l.id}`}
              >
                📅 Propose a visit (save to calendar)
              </button>
            )}
            {err && <p className="mt-2 text-xs font-bold text-red-600">{err}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}
