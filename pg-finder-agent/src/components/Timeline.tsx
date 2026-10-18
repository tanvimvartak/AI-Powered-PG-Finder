"use client";
/**
 * Live activity timeline: one row per agent step, expandable to show raw
 * tool inputs/outputs.
 */
import { useState } from "react";

export interface TimelineItem {
  id: string;
  kind: "step" | "thought" | "relaxation" | "error" | "final";
  status?: "running" | "done" | "error";
  label: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  at: number;
}

const ICON: Record<string, string> = {
  parse_request: "🧠",
  geocode: "📍",
  search_listings: "🔎",
  rank_listings: "🏆",
  contact_owner: "💬",
  schedule_visit: "📅",
};

function Row({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const hasRaw = item.input !== undefined || item.output !== undefined;
  const dot =
    item.kind === "relaxation"
      ? "bg-amber-400"
      : item.status === "running"
        ? "bg-violet-400 animate-pulse"
        : item.status === "error" || item.kind === "error"
          ? "bg-red-400"
          : item.kind === "thought"
            ? "bg-slate-500"
            : "bg-emerald-400";

  return (
    <li className="fade-up relative pl-7">
      <span className={`absolute left-[5px] top-[7px] h-2.5 w-2.5 rounded-full ${dot}`} />
      <button
        type="button"
        onClick={() => hasRaw && setOpen((o) => !o)}
        className={`w-full text-left ${hasRaw ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={open}
        id={`timeline-${item.id}`}
      >
        <div className="flex items-start gap-2">
          <span className="text-sm">{item.kind === "relaxation" ? "↔️" : item.kind === "thought" ? "💭" : (item.tool && ICON[item.tool]) || "⚙️"}</span>
          <span className={`flex-1 text-sm leading-snug ${item.kind === "thought" ? "italic text-muted" : item.kind === "relaxation" ? "text-amber-200" : item.kind === "error" ? "text-red-300" : ""}`}>
            {item.label}
            {item.status === "running" && <span className="ml-1 text-muted">⋯</span>}
          </span>
          {hasRaw && <span className="text-[10px] text-muted">{open ? "hide" : "raw"}</span>}
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[11px]">
          {item.input !== undefined && (
            <div>
              <div className="mb-1 font-semibold text-muted">→ {item.tool} input</div>
              <pre className="thin-scroll max-h-40 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-violet-200">{JSON.stringify(item.input, null, 2)}</pre>
            </div>
          )}
          {item.output !== undefined && (
            <div>
              <div className="mb-1 font-semibold text-muted">← output</div>
              <pre className="thin-scroll max-h-56 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-emerald-200">{JSON.stringify(item.output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Timeline({ items, running }: { items: TimelineItem[]; running: boolean }) {
  return (
    <section className="glass p-4" aria-label="Agent activity">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Agent activity</h2>
        {running ? (
          <span className="chip text-violet-200">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-violet-400" /> working
          </span>
        ) : items.length ? (
          <span className="chip text-emerald-300">✓ done</span>
        ) : null}
      </div>
      <ol className="relative space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[9px] before:w-px before:bg-white/10">
        {items.map((it) => (
          <Row key={it.id} item={it} />
        ))}
        {running && items.length === 0 && (
          <li className="relative pl-7 text-sm text-muted">
            <span className="absolute top-[7px] left-[5px] h-2.5 w-2.5 animate-pulse rounded-full bg-violet-400" /> Starting agent...
          </li>
        )}
      </ol>
    </section>
  );
}
