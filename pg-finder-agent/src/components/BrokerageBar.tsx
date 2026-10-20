"use client";

import React from "react";

interface BrokerageBarProps {
  landmark?: string | null;
  city?: string | null;
  gender?: string | null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function BrokerageBar({ landmark, city, gender }: BrokerageBarProps) {
  const cleanLandmark = (landmark || "Andheri")
    .replace(/station|railway|college|campus|metro/gi, "")
    .trim() || (landmark || "Andheri");
  const locSlug = slug(cleanLandmark);
  const citySlug = slug(city || "Mumbai");
  const isGirls = gender === "girls";
  const isBoys = gender === "boys";
  const genderSuffix = isGirls ? "-for-girls" : isBoys ? "-for-boys" : "";

  const portals = [
    {
      name: "MagicBricks",
      label: "MagicBricks",
      icon: "🏢",
      url: `https://www.magicbricks.com/pg-paying-guests-in-${locSlug}-${citySlug}-nrsid`,
      accent: "#D8232A",
    },
    {
      name: "NoBroker",
      label: "NoBroker (0 Brokerage)",
      icon: "🏠",
      url: `https://www.nobroker.in/paying-guest-in-${locSlug}-${citySlug}`,
      accent: "#009587",
    },
    {
      name: "Housing.com",
      label: "Housing.com",
      icon: "🏘️",
      url: `https://housing.com/in/rent/pg-in-${locSlug}-${citySlug}`,
      accent: "#6D28D9",
    },
    {
      name: "99acres",
      label: "99acres",
      icon: "📍",
      url: `https://www.99acres.com/pg-near-${locSlug}-${citySlug}-ffid`,
      accent: "#0284C7",
    },
    {
      name: "ZoloStays",
      label: "Zolo Stays",
      icon: "⚡",
      url: `https://zolostays.com/${citySlug}/${locSlug}`,
      accent: "#7C3AED",
    },
    {
      name: "Stanza Living",
      label: "Stanza Living",
      icon: "🛋️",
      url: `https://www.stanzaliving.com/${citySlug}`,
      accent: "#EA580C",
    },
  ];

  return (
    <div className="rounded-2xl border-2 border-[#B7D5C4] bg-[#E8F2EC]/80 p-3.5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🌐</span>
          <span className="text-xs font-black uppercase tracking-wider text-[#1E5D4B]">
            Browse on Live Brokerage Portals ({cleanLandmark}, {city || "Mumbai"})
          </span>
        </div>
        <span className="text-[11px] font-bold text-[#475569]">Direct Portal Search · No Fees</span>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {portals.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#1F2937] border border-[#CBD5E1] hover:border-[#1E5D4B] hover:text-[#1E5D4B] hover:shadow-xs transition-all cursor-pointer"
            title={`Open search for PGs near ${cleanLandmark} on ${p.name}`}
          >
            <span>{p.icon}</span>
            <span>{p.label}</span>
            <span className="text-[10px] text-slate-400">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}
