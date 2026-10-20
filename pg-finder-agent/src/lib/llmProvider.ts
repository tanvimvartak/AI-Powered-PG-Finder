/**
 * Multi-Provider LLM Router with Fallback Chain & Call Counter.
 *
 * Provider Chain:
 * 1. Gemini primary / fallback models
 * 2. Optional secondary provider (Groq or OpenRouter, if keys present in env)
 * 3. Deterministic No-LLM templated fallback (100% resilient, 0 API calls)
 *
 * Model Routing:
 * - Parsing & Web Extraction: Lite model (GEMINI_LITE_MODEL)
 * - Final Summary & Explanation: Stronger model (GEMINI_SUMMARY_MODEL)
 */
import "server-only";
import { generate, GeminiError } from "./gemini";
import type { RankedListing, Preferences } from "./types";

export interface LlmCallStats {
  parse: number;
  web: number;
  summary: number;
  total: number;
  providerUsed: string;
}

export class LlmTracker {
  private parseCount = 0;
  private webCount = 0;
  private summaryCount = 0;
  private provider = "none";

  record(category: "parse" | "web" | "summary", provider: string = "gemini") {
    if (category === "parse") this.parseCount++;
    if (category === "web") this.webCount++;
    if (category === "summary") this.summaryCount++;
    this.provider = provider;
  }

  getStats(): LlmCallStats {
    return {
      parse: this.parseCount,
      web: this.webCount,
      summary: this.summaryCount,
      total: this.parseCount + this.webCount + this.summaryCount,
      providerUsed: this.provider,
    };
  }
}

/** Check if an error represents rate limits / quota exhaustion */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error).message || "";
  const status = (err as any).status;
  return (
    status === 429 ||
    /429|quota|RESOURCE_EXHAUSTED|rate_limit|rate\s*limit|exceeded your current quota/i.test(msg)
  );
}

/**
 * Call Groq (OpenAI-compatible) if GROQ_API_KEY is configured.
 */
async function callGroq(prompt: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY missing");

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${text.slice(0, 150)}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Call OpenRouter (OpenAI-compatible) if OPENROUTER_API_KEY is configured.
 */
async function callOpenRouter(prompt: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://pg-finder-agent.vercel.app",
      "X-Title": "PG Finder Agent",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 150)}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Deterministic templated explanation (100% offline, zero LLM calls, zero quota usage).
 */
export function buildTemplatedSummary(params: {
  landmark: string;
  radius_m: number;
  budget: number | null;
  ranked: RankedListing[];
  relaxed?: boolean;
}): string {
  const { landmark, radius_m, budget, ranked, relaxed } = params;
  const radiusKm = (radius_m / 1000).toFixed(radius_m % 1000 ? 1 : 0);
  const total = ranked.length;

  if (total === 0) {
    return `Searched near **${landmark}** within ${radiusKm} km. No exact accommodations matched all filters. Try widening your radius or adjusting your budget on the chips above.`;
  }

  const topMatches = ranked.filter((r) => r.group === "top_match");
  const top1 = topMatches[0] || ranked[0];
  const top2 = topMatches[1];

  const l1 = top1.listing;
  const price1 = l1.monthly_rent ? `₹${l1.monthly_rent.toLocaleString("en-IN")}/mo` : "price unlisted";
  const walk1 = top1.walk_minutes ? `~${top1.walk_minutes} min walk` : `${(l1.distance_m / 1000).toFixed(1)} km away`;
  const src1 = (l1.sources || []).map((s) => s.name).slice(0, 2).join(" & ") || "verified listing";

  let out = `Found **${total} accommodation options** near **${landmark}** within ${radiusKm} km.`;
  if (relaxed) {
    out += ` (Expanded search radius to include verified nearby student hubs).`;
  }
  out += `\n\nTop pick: **${l1.name}** at **${price1}** (${walk1}) via ${src1}.`;

  if (top2) {
    const l2 = top2.listing;
    const price2 = l2.monthly_rent ? `₹${l2.monthly_rent.toLocaleString("en-IN")}/mo` : "price unlisted";
    const walk2 = top2.walk_minutes ? `~${top2.walk_minutes} min walk` : `${(l2.distance_m / 1000).toFixed(1)} km away`;
    const src2 = (l2.sources || []).map((s) => s.name).slice(0, 2).join(" & ") || "verified listing";
    out += ` Alternative option: **${l2.name}** at **${price2}** (${walk2}) via ${src2}.`;
  }

  out += `\n\nI have prepared enquiry drafts for you to review and send directly to owners. Listings come from live brokerage & public sources. Prices and availability are verified through listing portals.`;

  return out;
}

/**
 * Generate final summary using the full provider chain:
 * Gemini Stronger Model -> Groq -> OpenRouter -> Templated Fallback
 */
export async function generateFinalExplanation(params: {
  landmark: string;
  radius_m: number;
  budget: number | null;
  ranked: RankedListing[];
  relaxed?: boolean;
  tracker?: LlmTracker;
  signal?: AbortSignal;
  onQuotaNotice?: (message: string) => void;
}): Promise<string> {
  const { landmark, radius_m, budget, ranked, relaxed, tracker, signal, onQuotaNotice } = params;

  if (ranked.length === 0) {
    return buildTemplatedSummary({ landmark, radius_m, budget, ranked, relaxed });
  }

  const top3 = ranked.slice(0, 3).map((r) => ({
    name: r.listing.name,
    rent: r.listing.monthly_rent,
    distance_m: r.listing.distance_m,
    walk_min: r.walk_minutes,
    sources: (r.listing.sources || []).map((s) => s.name).join(", "),
    why: r.why,
  }));

  const prompt = `Write a short, helpful, reassuring recommendation for a student looking for a PG/hostel.
Landmark: ${landmark}
Radius: ${(radius_m / 1000).toFixed(1)} km
Budget: ${budget ? `Rs ${budget}/mo` : "Flexible"}
${relaxed ? "Note: search radius was expanded slightly to find best verified places." : ""}

Top Matches:
${top3.map((t, i) => `${i + 1}. ${t.name} - ${t.rent ? `Rs ${t.rent}/mo` : "Price unlisted"} (${t.walk_min} min walk) via ${t.sources}. Why: ${t.why}`).join("\n")}

STRICT RULES:
1. Max 2-3 concise paragraphs (under 120 words total).
2. Highlight the best pick with **bold text** for its name and price.
3. Mention that enquiry drafts have been prepared for them to send directly.
4. End with: "Listings come from live brokerage & public sources. Prices and availability are verified through listing portals."
5. Do NOT include greetings like "Hi" or markdown headers.`;

  // 1. Try Gemini Summary Model
  try {
    const summaryModel = process.env.GEMINI_SUMMARY_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const res = await generate(
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      },
      { signal, tier: "agent" }
    );
    const text = res.content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();

    if (text) {
      tracker?.record("summary", `gemini (${res.model})`);
      return text;
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    if (isQuotaError(err)) {
      onQuotaNotice?.("⚡ Free daily Gemini quota reached. Switching smoothly to fallback provider...");
    }
    console.warn("[llmProvider] Gemini summary failed:", (err as Error).message);
  }

  // 2. Try Secondary Provider: Groq
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroq(prompt, signal);
      if (text) {
        tracker?.record("summary", "groq");
        return text;
      }
    } catch (gErr) {
      console.warn("[llmProvider] Groq fallback failed:", (gErr as Error).message);
    }
  }

  // 3. Try Secondary Provider: OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const text = await callOpenRouter(prompt, signal);
      if (text) {
        tracker?.record("summary", "openrouter");
        return text;
      }
    } catch (orErr) {
      console.warn("[llmProvider] OpenRouter fallback failed:", (orErr as Error).message);
    }
  }

  // 4. Guaranteed Zero-LLM Templated Fallback
  tracker?.record("summary", "deterministic-template");
  return buildTemplatedSummary({ landmark, radius_m, budget, ranked, relaxed });
}
