/**
 * parse_request implementation.
 * Primary: Gemini structured output (JSON schema). Fallback: a regex heuristic
 * parser so the app still works if the LLM is unavailable.
 * Both paths go through `normalize()` which enforces sane defaults.
 */
import "server-only";
import { generateJson } from "../gemini";
import type { AgentRequestBody, ParsedRequest, Preferences } from "../types";
import { PARSER_PROMPT } from "./systemPrompt";

// ───────── dates (IST) ─────────
export function todayIST(): Date {
  const now = new Date(Date.now() + 330 * 60000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_PREFS: Preferences = { gender: "any", sharing: "any", food: "any", amenities: [] };

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const PARSE_SCHEMA = S("OBJECT", {
  properties: {
    landmark: S("STRING", { nullable: true }),
    city_hint: S("STRING", { nullable: true }),
    radius_m: S("INTEGER"),
    min_budget: S("INTEGER", { nullable: true }),
    max_budget: S("INTEGER", { nullable: true }),
    deadline_date: S("STRING", { nullable: true, description: "YYYY-MM-DD" }),
    sort_preference: S("STRING", { enum: ["best", "cheapest", "closest"] }),
    preferences: S("OBJECT", {
      properties: {
        gender: S("STRING", { enum: ["boys", "girls", "any"] }),
        sharing: S("STRING", { enum: ["single", "double", "triple", "any"] }),
        food: S("STRING", { enum: ["required", "not_needed", "any"] }),
        amenities: S("ARRAY", { items: S("STRING") }),
      },
      required: ["gender", "sharing", "food", "amenities"],
    }),
    assumptions: S("ARRAY", { items: S("STRING") }),
    clarification_question: S("STRING", { nullable: true }),
  },
  required: ["landmark", "city_hint", "radius_m", "min_budget", "max_budget", "deadline_date", "sort_preference", "preferences", "assumptions", "clarification_question"],
});

/** Regex fallback (also documents the phrasing we expect to handle). */
export function heuristicParse(text: string): ParsedRequest {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, "");
  const today = todayIST();
  const assumptions: string[] = ["Parsed with the offline fallback parser (Gemini unavailable)."];

  let radius = 1000;
  const km = t.match(/(\d+(?:\.\d+)?)\s*(km|kilomet)/);
  const m = t.match(/(\d+)\s*(m\b|mtr|metre|meter)/);
  if (km) radius = parseFloat(km[1]) * 1000;
  else if (m) radius = parseInt(m[1]);
  else if (!/walking|paidal/.test(t)) assumptions.push("No radius given, using 1 km.");

  let min: number | null = null;
  let max: number | null = null;
  const num = (s: string) => (s.endsWith("k") ? parseFloat(s) * 1000 : parseInt(s));
  const range = t.match(/(\d+k?)\s*(?:to|-)\s*(\d+k?)/);
  const single = t.match(/(?:rs\.?|₹|budget|under|below|upto|up to|within)?\s*(\d{4,6}|\d+(?:\.\d)?k)\b/);
  if (range) [min, max] = [num(range[1]), num(range[2])];
  else if (single) max = num(single[1]);

  let deadline = addDays(today, 7);
  const inDays = t.match(/in\s+(\d+)\s*days?/);
  const dayIdx = WEEKDAYS.findIndex((d) => t.includes(d.toLowerCase()));
  if (inDays) deadline = addDays(today, parseInt(inDays[1]));
  else if (/in a week|1 week/.test(t)) deadline = addDays(today, 7);
  else if (/urgent|asap|jaldi/.test(t)) deadline = addDays(today, 2);
  else if (/tomorrow|\bkal\b/.test(t)) deadline = addDays(today, 1);
  else if (dayIdx >= 0) deadline = addDays(today, ((dayIdx - today.getUTCDay() + 7) % 7) || 7);
  else assumptions.push("No move-in date given, assuming within 7 days.");

  const lm = text.match(/(?:near|of|around|close to)\s+([A-Za-z .]+?)(?:\s+(?:within|under|budget|by|in|,|\.|for)|$)/i) || text.match(/([A-Za-z .]+?)\s+ke\s+pa+s/i);
  const landmark = lm ? lm[1].trim() : null;

  return {
    landmark,
    city_hint: null,
    radius_m: radius,
    min_budget: min,
    max_budget: max,
    deadline_date: isoDate(deadline),
    sort_preference: /cheap|sasta/.test(t) ? "cheapest" : /nearest|closest/.test(t) ? "closest" : "best",
    preferences: {
      gender: /girl|ladies|women/.test(t) ? "girls" : /boys|gents/.test(t) ? "boys" : "any",
      sharing: /single/.test(t) ? "single" : /double/.test(t) ? "double" : /triple/.test(t) ? "triple" : "any",
      food: /food|meal|tiffin|khana/.test(t) ? "required" : "any",
      amenities: ["wifi", "ac", "laundry", "geyser", "gym", "cctv"].filter((a) => new RegExp(`\\b${a}\\b`).test(t)),
    },
    assumptions,
    clarification_question: landmark ? null : "Which college, station or area should the PG be near?",
  };
}

/** Enforce defaults/bounds and apply user chip overrides. */
function normalize(p: ParsedRequest, overrides?: AgentRequestBody["overrides"]): ParsedRequest {
  const today = todayIST();
  const out: ParsedRequest = {
    ...p,
    radius_m: Math.round(Math.min(Math.max(p.radius_m || 1000, 200), 10000)),
    preferences: { ...DEFAULT_PREFS, ...p.preferences },
    assumptions: p.assumptions ?? [],
    sort_preference: p.sort_preference ?? "best",
  };
  if (!out.deadline_date || !/^\d{4}-\d{2}-\d{2}$/.test(out.deadline_date) || out.deadline_date < isoDate(today)) {
    out.deadline_date = isoDate(addDays(today, 7));
  }
  if (out.min_budget && out.max_budget && out.min_budget > out.max_budget) [out.min_budget, out.max_budget] = [out.max_budget, out.min_budget];
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined && v !== null && v !== "") (out as unknown as Record<string, unknown>)[k] = v;
    }
    if (overrides.landmark) out.clarification_question = null;
    out.assumptions = [...out.assumptions, "Some values were edited by you on the parameter chips."];
  }
  return out;
}

export async function parseRequest(text: string, overrides?: AgentRequestBody["overrides"]): Promise<{ parsed: ParsedRequest; via: "gemini" | "fallback" }> {
  const today = todayIST();
  const prompt = PARSER_PROMPT.replace("{TODAY}", isoDate(today)).replace("{WEEKDAY}", WEEKDAYS[today.getUTCDay()]);
  try {
    const parsed = await generateJson<ParsedRequest>(`Student sentence: """${text}"""`, PARSE_SCHEMA, prompt);
    return { parsed: normalize(parsed, overrides), via: "gemini" };
  } catch (e) {
    console.warn("[parse_request] Gemini failed, using heuristic:", (e as Error).message);
    return { parsed: normalize(heuristicParse(text), overrides), via: "fallback" };
  }
}
