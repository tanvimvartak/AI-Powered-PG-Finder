"use client";
/**
 * Live activity timeline: high-contrast, clear and readable.
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
      ? "bg-[#F08A5D]"
      : item.status === "running"
        ? "bg-[#1E5D4B] animate-pulse"
        : item.status === "error" || item.kind === "error"
          ? "bg-[#DC2626]"
          : item.kind === "thought"
            ? "bg-[#475569]"
            : "bg-[#1E5D4B]";

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
          <span className={`flex-1 text-sm font-bold leading-snug ${item.kind === "thought" ? "italic text-[#334155] font-semibold" : item.kind === "relaxation" ? "text-[#C2410C]" : item.kind === "error" ? "text-red-700" : "text-[#1F2937]"}`}>
            {item.label}
            {item.status === "running" && <span className="ml-1 text-[#1E5D4B] font-black">⋯</span>}
          </span>
          {hasRaw && <span className="text-xs font-bold text-[#1E5D4B] hover:underline">{open ? "hide" : "details"}</span>}
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[11px]">
          {item.input !== undefined && (
            <div>
              <div className="mb-1 font-bold text-[#334155]">→ {item.tool} input</div>
              <pre className="thin-scroll max-h-40 overflow-auto rounded-lg bg-[#E8F2EC] p-2.5 font-mono text-[#1F2937] font-semibold border border-[#B7D5C4]">{JSON.stringify(item.input, null, 2)}</pre>
            </div>
          )}
          {item.output !== undefined && (
            <div>
              <div className="mb-1 font-bold text-[#334155]">← output</div>
              <pre className="thin-scroll max-h-56 overflow-auto rounded-lg bg-[#E8F2EC] p-2.5 font-mono text-[#1E5D4B] font-semibold border border-[#B7D5C4]">{JSON.stringify(item.output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Timeline({ items, running }: { items: TimelineItem[]; running: boolean }) {
  return (
    <section className="glass p-4 border-2 border-[#CBD5E1]" aria-label="Agent activity">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black tracking-wider text-[#1F2937] uppercase">Agent Activity</h2>
        {running ? (
          <span className="chip bg-[#E8F2EC] text-[#1E5D4B] font-extrabold border border-[#B7D5C4]">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#1E5D4B]" /> searching
          </span>
        ) : items.length ? (
          <span className="chip bg-[#E8F2EC] text-[#1E5D4B] font-extrabold border border-[#B7D5C4]">✓ complete</span>
        ) : null}
      </div>
      <ol className="relative space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[9px] before:w-px before:bg-[#94A3B8]">
        {items.map((it) => (
          <Row key={it.id} item={it} />
        ))}
        {running && items.length === 0 && (
          <li className="relative pl-7 text-sm font-bold text-[#334155]">
            <span className="absolute top-[7px] left-[5px] h-2.5 w-2.5 animate-pulse rounded-full bg-[#1E5D4B]" /> Starting agent...
          </li>
        )}
      </ol>
    </section>
  );
}
