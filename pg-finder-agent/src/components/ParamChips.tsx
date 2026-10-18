"use client";
/**
 * Parsed parameters shown as editable chips. Users can tweak landmark,
 * radius, budget and deadline, then re-run without retyping.
 */
import { useState } from "react";
import type { AgentRequestBody, ParsedRequest } from "@/lib/types";

type Overrides = NonNullable<AgentRequestBody["overrides"]>;

interface Props {
  params: ParsedRequest;
  disabled: boolean;
  onRerun: (o: Overrides) => void;
}

export default function ParamChips({ params, disabled, onRerun }: Props) {
  // Parent re-mounts this component (via `key`) whenever new params arrive.
  const [landmark, setLandmark] = useState(params.landmark ?? "");
  const [radiusKm, setRadiusKm] = useState(String(params.radius_m / 1000));
  const [budget, setBudget] = useState(params.max_budget ? String(params.max_budget) : "");
  const [deadline, setDeadline] = useState(params.deadline_date ?? "");

  const dirty =
    landmark !== (params.landmark ?? "") || Number(radiusKm) * 1000 !== params.radius_m || budget !== (params.max_budget ? String(params.max_budget) : "") || deadline !== (params.deadline_date ?? "");

  function submit() {
    const o: Overrides = {};
    if (landmark.trim()) o.landmark = landmark.trim();
    const r = Math.round(parseFloat(radiusKm) * 1000);
    if (r > 0) o.radius_m = r;
    const b = parseInt(budget.replace(/\D/g, ""));
    if (b > 0) o.max_budget = b;
    if (deadline) o.deadline_date = deadline;
    onRerun(o);
  }

  const field = "bg-transparent outline-none text-ink placeholder:text-muted/60 min-w-0";
  const p = params.preferences;

  return (
    <div className="glass fade-up p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="chip py-1.5 text-sm" title="Landmark">
          🎓
          <input id="chip-landmark" className={`${field} w-36 sm:w-44`} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="landmark" aria-label="Landmark" />
        </label>
        <label className="chip py-1.5 text-sm" title="Radius (km)">
          📏
          <input id="chip-radius" className={`${field} w-10 text-right`} type="number" step="0.1" min="0.2" max="10" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} aria-label="Radius in km" />
          km
        </label>
        <label className="chip py-1.5 text-sm" title="Max budget (Rs/month)">
          ₹
          <input id="chip-budget" className={`${field} w-16`} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="any" aria-label="Max budget" />
          /mo
        </label>
        <label className="chip py-1.5 text-sm" title="Move-in deadline">
          📅
          <input id="chip-deadline" className={`${field} [color-scheme:dark]`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Move-in deadline" />
        </label>
        {p.gender !== "any" && <span className="chip">👤 {p.gender}</span>}
        {p.sharing !== "any" && <span className="chip">🛏 {p.sharing}</span>}
        {p.food !== "any" && <span className="chip">🍛 food {p.food === "required" ? "needed" : "not needed"}</span>}
        {params.sort_preference !== "best" && <span className="chip">↕ {params.sort_preference}</span>}
        {p.amenities.map((a) => (
          <span key={a} className="chip">
            ✓ {a}
          </span>
        ))}
        <button id="rerun-btn" type="button" onClick={submit} disabled={disabled} className={`ml-auto rounded-full px-4 py-1.5 text-sm font-semibold transition ${dirty ? "btn-primary" : "btn-ghost"} disabled:opacity-40`}>
          ↻ Re-run
        </button>
      </div>
      {params.assumptions.length > 0 && <p className="mt-2 text-xs text-muted">Assumptions: {params.assumptions.join(" · ")}</p>}
    </div>
  );
}
