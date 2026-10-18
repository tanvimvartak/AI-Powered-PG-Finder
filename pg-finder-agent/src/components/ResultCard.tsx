"use client";
/**
 * Ranked result card: rent, real cost, distance/walk time, amenities, rating,
 * the agent's "why", red flags, simulated owner reply and visit scheduling.
 */
import { useState } from "react";
import type { OwnerReply, RankedListing, VisitPlan } from "@/lib/types";
import { priceColor } from "@/lib/price";

const inr = (n: number) => "Rs " + n.toLocaleString("en-IN");
const fmtSlot = (s: string) =>
  new Date(s + ":00").toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const AMENITY_ICON: Record<string, string> = { wifi: "📶", ac: "❄️", laundry: "🧺", geyser: "🚿", housekeeping: "🧹", gym: "🏋️", cctv: "📹" };

interface Props {
  item: RankedListing;
  reply?: OwnerReply;
  contacting?: boolean;
  budget: number | null;
  deadline: string | null;
  selected: boolean;
  onSelect: () => void;
  onReply: (r: OwnerReply) => void;
}

function defaultSlot() {
  const d = new Date(Date.now() + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T11:00`;
}

export default function ResultCard({ item, reply, contacting, budget, deadline, selected, onSelect, onReply }: Props) {
  const l = item.listing;
  const [showReply, setShowReply] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [visit, setVisit] = useState<VisitPlan | null>(null);
  const [busy, setBusy] = useState<"visit" | "contact" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const km = l.distance_m / 1000;
  const color = priceColor(l.monthly_rent, budget);

  async function confirmVisit() {
    const dt = slot || reply?.visit_slots[0] || defaultSlot();
    setBusy("visit");
    setErr(null);
    try {
      const res = await fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listing_id: l.id, datetime: dt }) });
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

  async function contact() {
    setBusy("contact");
    setErr(null);
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listing_id: l.id, deadline_date: deadline, max_budget: budget }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not reach owner");
      onReply(json);
      setShowReply(true);
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
      className={`glass fade-up overflow-hidden transition-all duration-300 ${selected ? "ring-2 ring-violet-400/70 shadow-[0_0_40px_-10px_rgba(139,92,246,.7)]" : "hover:border-white/20"}`}
      style={{ animationDelay: `${item.rank * 60}ms` }}
    >
      <div className="flex flex-col sm:flex-row">
        {/* photo */}
        <div className="relative h-40 shrink-0 sm:h-auto sm:w-44">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.photos[0]} alt={`Room at ${l.name}`} className="h-full w-full object-cover" loading="lazy" />
          <div className="absolute top-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-sm font-bold shadow-lg">#{item.rank}</div>
          <div className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] backdrop-blur">score {item.score}</div>
        </div>

        <div className="flex-1 space-y-2.5 p-4">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base leading-tight font-semibold">{l.name}</h3>
              <p className="text-xs text-muted">{l.address}</p>
            </div>
            <span className="badge-sample" title="This listing is fictional demo data">Sample data</span>
          </div>

          {/* key facts */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-xl font-bold" style={{ color }}>
              {inr(l.monthly_rent)}
              <span className="text-xs font-normal text-muted">/mo</span>
            </span>
            {item.effective_monthly_cost !== l.monthly_rent && <span className="text-xs text-amber-300">real cost {inr(item.effective_monthly_cost)}</span>}
            <span className="text-sm">
              📍 {km < 1 ? `${l.distance_m} m` : `${km.toFixed(1)} km`} · 🚶 {item.walk_minutes} min
            </span>
            <span className="text-sm">⭐ {l.rating}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="chip">{l.sharing_type} sharing</span>
            <span className="chip">{l.gender === "any" ? "boys & girls" : l.gender}</span>
            {l.food_included && <span className="chip border-emerald-400/30 text-emerald-300">🍛 food included</span>}
            <span className="chip">deposit {inr(l.deposit)}</span>
            {l.amenities.map((a) => (
              <span key={a} className="chip">
                {AMENITY_ICON[a] ?? "•"} {a}
              </span>
            ))}
          </div>

          {/* why */}
          <p className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-sm">
            <span className="font-semibold text-violet-200">Why we picked this: </span>
            {item.why}
          </p>

          {/* red flags */}
          {item.red_flags.length > 0 && (
            <ul className="space-y-1">
              {item.red_flags.map((f) => (
                <li key={f} className="flex gap-1.5 text-xs text-red-300">
                  <span>⚠️</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {/* owner reply */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm" onClick={(e) => e.stopPropagation()}>
            {contacting && !reply ? (
              <div className="flex items-center gap-2 text-muted">
                <span className="eq">
                  <span />
                  <span />
                  <span />
                </span>
                Agent is messaging {l.owner_name}...
              </div>
            ) : reply ? (
              <>
                <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowReply((s) => !s)} id={`reply-toggle-${l.id}`}>
                  <span>
                    💬 <b>{l.owner_name}</b> replied{" "}
                    <span className={reply.available_by_deadline ? "text-emerald-300" : "text-amber-300"}>{reply.available_by_deadline ? "· available by your date" : "· not available by your date"}</span>
                  </span>
                  <span className="text-xs text-muted">{showReply ? "hide" : "view"}</span>
                </button>
                {showReply && (
                  <div className="mt-2 space-y-2">
                    <div className="text-[10px] font-semibold tracking-wider text-amber-300 uppercase">Simulated owner reply</div>
                    <p className="rounded-lg rounded-tl-none bg-emerald-900/30 px-3 py-2 text-[13px] leading-relaxed">{reply.reply}</p>
                    <p className="text-[11px] text-muted">You (sent by agent): “{reply.message_sent}”</p>
                  </div>
                )}
                <a href={reply.wa_link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-emerald-300 hover:underline" id={`wa-${l.id}`}>
                  Open real WhatsApp chat with this message ↗
                </a>
              </>
            ) : (
              <button type="button" className="btn-ghost text-xs" onClick={contact} disabled={busy === "contact"} id={`contact-${l.id}`}>
                {busy === "contact" ? "Messaging owner..." : "💬 Ask owner (simulated)"}
              </button>
            )}
          </div>

          {/* visit */}
          <div onClick={(e) => e.stopPropagation()}>
            {visit ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm">
                <span>✅ Visit on {fmtSlot(visit.datetime)}</span>
                <a className="btn-ghost text-xs" href={visit.ics_url} download id={`ics-${l.id}`}>
                  ⬇ .ics file
                </a>
                <a className="btn-ghost text-xs" href={visit.gcal_url} target="_blank" rel="noopener noreferrer" id={`gcal-${l.id}`}>
                  Google Calendar ↗
                </a>
              </div>
            ) : picking ? (
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <div className="text-xs text-muted">Pick a visit slot{reply ? " (offered by owner)" : ""}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {(reply?.visit_slots ?? []).map((s) => (
                    <button key={s} type="button" onClick={() => setSlot(s)} className={`chip ${slot === s ? "border-violet-400 bg-violet-500/30" : ""}`}>
                      {fmtSlot(s)}
                    </button>
                  ))}
                  <input
                    type="datetime-local"
                    className="chip bg-transparent text-ink [color-scheme:dark]"
                    value={slot && !reply?.visit_slots.includes(slot) ? slot : ""}
                    onChange={(e) => setSlot(e.target.value)}
                    aria-label="Custom visit time"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={confirmVisit} disabled={busy === "visit"} id={`confirm-slot-${l.id}`}>
                    {busy === "visit" ? "Scheduling..." : "Confirm"}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setPicking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-primary w-full py-2.5 text-sm sm:w-auto" onClick={() => setPicking(true)} id={`confirm-visit-${l.id}`}>
                📅 Confirm visit
              </button>
            )}
            {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}
