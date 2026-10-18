/**
 * Automated test runner for the 6 queries specified in Section 7.
 * Tests against http://localhost:3000/api/agent
 */
import fs from "node:fs";

const queries = [
  { id: "Q1_Mithibai", text: "Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days" },
  { id: "Q2_Powai", text: "PG near Powai IIT within 2 km, budget 8,000, need it in 3 days" },
  { id: "Q3_Andheri_Girls", text: "Girls PG near Andheri station, walking distance, under 6k" },
  { id: "Q4_Thane_Cheapest", text: "Cheapest PG within 5 km of Thane station, by Monday" },
  { id: "Q5_Hinglish", text: "Mithibai ke paas 5000 mein PG chahiye" },
  { id: "Q6_Impossible_Relaxation", text: "PG near Dadar station within 500 m under Rs 2,500, need it tomorrow" },
];

async function runQuery(q: { id: string; text: string }) {
  console.log(`\n========================================\nRunning ${q.id}: "${q.text}"\n========================================`);
  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: q.text }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
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
  const relaxations = events.filter((e) => e.type === "relaxation");
  const ranked = events.find((e) => e.type === "ranked")?.results || [];
  const ownerReplies = events.filter((e) => e.type === "owner_reply").map((e) => e.reply);
  const final = events.find((e) => e.type === "final")?.text || "";

  console.log(`Duration: ${duration}s`);
  console.log(`Steps completed (${steps.length}):`);
  for (const s of steps) {
    console.log(`  - [${s.status}] ${s.tool}: ${s.label}`);
  }
  if (relaxations.length) {
    console.log(`Relaxations (${relaxations.length}):`);
    for (const r of relaxations) {
      console.log(`  - ${r.message}`);
    }
  }
  console.log(`Ranked results count: ${ranked.length}`);
  if (ranked.length > 0) {
    console.log(`Top pick: ${ranked[0].listing.name} (Rent: Rs ${ranked[0].listing.monthly_rent}, Score: ${ranked[0].score}, Distance: ${ranked[0].listing.distance_m}m)`);
    console.log(`Why: ${ranked[0].why}`);
    if (ranked[0].red_flags.length) console.log(`Flags: ${ranked[0].red_flags.join("; ")}`);
  }
  console.log(`Simulated owner replies: ${ownerReplies.length}`);
  console.log(`Final answer summary:\n${final.slice(0, 300)}...`);

  return { id: q.id, query: q.text, duration, stepsCount: steps.length, relaxationsCount: relaxations.length, rankedCount: ranked.length, topPick: ranked[0]?.listing.name, final };
}

async function main() {
  const summary: any[] = [];
  for (const q of queries) {
    try {
      const res = await runQuery(q);
      summary.push({ ...res, success: true });
    } catch (e: any) {
      console.error(`FAILED ${q.id}:`, e.message);
      summary.push({ id: q.id, query: q.text, success: false, error: e.message });
    }
  }
  fs.writeFileSync("test_summary.json", JSON.stringify(summary, null, 2));
  console.log("\nAll queries completed. Summary written to test_summary.json");
}

main().catch(console.error);
