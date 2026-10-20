/**
 * Real-world test runner for testing the live multi-source pipeline (OSM + Geoapify + Web Discovery).
 * Tests against http://localhost:3000/api/agent
 *
 * Verifies:
 * 1. Sources used and count per source.
 * 2. Top results with source URLs.
 * 3. ZERO listings from seed data (DEMO_MODE=false).
 * 4. Proper handling of "price unknown" listings.
 */

import fs from "node:fs";

const realQueries = [
  {
    id: "Q1_Mithibai_Real",
    text: "PG near Mithibai College within 1 km, budget 5000, need in 5 days",
    description: "Mithibai College Mumbai - 1km radius, budget 5k",
  },
  {
    id: "Q2_Andheri_Girls_Real",
    text: "Girls PG near Andheri station, walking distance, under 6k",
    description: "Girls PG near Andheri station - walking distance filter",
  },
  {
    id: "Q3_Non_Seed_City_Pune",
    text: "PG near Fergusson College in Pune within 2 km",
    description: "City NOT in old seed data (Pune) to prove it works anywhere in India",
  },
  {
    id: "Q4_Price_Unknown_Handling",
    text: "Hostel or PG near St. Xavier's College Mumbai within 1.5 km",
    description: "Tests price unknown handling (OSM/Web places with no listed price placed in 'Worth asking about')",
  },
];

async function runRealQuery(q: { id: string; text: string; description: string }) {
  console.log(`\n======================================================================`);
  console.log(`[TEST] ${q.id}: "${q.text}"`);
  console.log(`Purpose: ${q.description}`);
  console.log(`======================================================================`);

  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: q.text }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} from /api/agent`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: any[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        try {
          const ev = JSON.parse(line.slice(6));
          events.push(ev);
        } catch {}
      }
    }
  }

  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  const steps = events.filter((e) => e.type === "step" && e.status !== "running");
  const rankedEvent = events.find((e) => e.type === "ranked");
  const ranked = rankedEvent?.results || [];
  const sourceStats = rankedEvent?.source_stats || {};
  const final = events.find((e) => e.type === "final")?.text || "";

  // 1. Sources used and count per source
  console.log(`\n[Execution Time] ${duration}s`);
  console.log(`[Sources Used & Counts]:`);
  console.log(`  - OpenStreetMap Overpass: ${sourceStats.osm_count ?? 0}`);
  console.log(`  - Geoapify Places:        ${sourceStats.geoapify_count ?? 0}`);
  console.log(`  - Live Web Discovery:     ${sourceStats.web_count ?? 0}`);
  console.log(`  - Merged Total:           ${sourceStats.merged_count ?? ranked.length}`);

  // 2. Verify zero seed listings
  const seedListings = ranked.filter(
    (r: any) =>
      r.listing.is_sample === true ||
      r.listing.id?.startsWith("pg-") ||
      (r.listing.sources && r.listing.sources.some((s: any) => s.name === "sample_data"))
  );

  if (seedListings.length > 0) {
    console.error(`[ERROR] FOUND ${seedListings.length} SEED LISTING(S) IN REAL MODE!`);
    throw new Error("Zero seed listings violation in real mode.");
  } else {
    console.log(`[HONESTY CHECK] PASSED: Exactly 0 seed/sample listings returned.`);
  }

  // 3. Top results (up to 5) with source URLs and pricing status
  console.log(`\n[Top ${Math.min(5, ranked.length)} Results]:`);
  const top5 = ranked.slice(0, 5);
  top5.forEach((item: any, i: number) => {
    const l = item.listing;
    const priceStr = l.price_status === "unknown" ? "Price not listed. Ask owner" : `₹${l.monthly_rent}/mo`;
    console.log(`  ${i + 1}. ${l.name}`);
    console.log(`     Group: ${item.group || "top_match"}`);
    console.log(`     Price: ${priceStr} (status: ${l.price_status || "unknown"})`);
    console.log(`     Distance: ${l.distance_m}m (~${Math.round(l.distance_m / 80)} min walk)`);
    console.log(`     Verification: ${l.verification || "unverified"}`);
    console.log(`     Sources (${l.sources?.length || 0}):`);
    (l.sources || []).forEach((s: any) => {
      console.log(`       * ${s.name}: ${s.url}`);
    });
    console.log(`     Why: ${item.why}`);
  });

  // Check unknown price handling
  const unknownPriceCount = ranked.filter((r: any) => r.listing.price_status === "unknown").length;
  console.log(`\n[Price Analysis] Known price: ${ranked.length - unknownPriceCount}, Unknown price: ${unknownPriceCount}`);

  return {
    id: q.id,
    query: q.text,
    duration,
    sourceStats,
    totalRanked: ranked.length,
    seedCount: seedListings.length,
    topResults: top5.map((r: any) => ({
      name: r.listing.name,
      price: r.listing.monthly_rent,
      price_status: r.listing.price_status,
      sources: r.listing.sources,
    })),
  };
}

async function main() {
  console.log("Starting Real Data Multi-Source Test Suite...");
  const summary: any[] = [];
  let allZeroSeed = true;

  for (const q of realQueries) {
    try {
      const res = await runRealQuery(q);
      summary.push({ ...res, success: true });
      if (res.seedCount > 0) allZeroSeed = false;
    } catch (e: any) {
      console.error(`FAILED ${q.id}:`, e.message);
      summary.push({ id: q.id, query: q.text, success: false, error: e.message });
      allZeroSeed = false;
    }
  }

  fs.writeFileSync("real_test_summary.json", JSON.stringify(summary, null, 2));
  console.log("\n======================================================================");
  console.log("REAL DATA TEST SUITE SUMMARY");
  console.log("======================================================================");
  console.log(`Total queries executed: ${realQueries.length}`);
  console.log(`All queries used 0 seed listings: ${allZeroSeed ? "YES (PASSED)" : "NO (FAILED)"}`);
  console.log("Full report saved to real_test_summary.json");
}

main().catch(console.error);
