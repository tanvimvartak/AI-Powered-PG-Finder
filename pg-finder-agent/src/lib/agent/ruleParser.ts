/**
 * Rule-based / Regex Parser for student PG search queries.
 *
 * Extracts common patterns without calling any LLM:
 * - Landmark / Area
 * - Radius in m / km / walking distance
 * - Budget in k / ₹ / Rs / under / max
 * - Move-in deadline in N days / next week / urgent
 * - Gender words (girls/ladies, boys/gents)
 * - Sharing & food preferences
 */
import type { ParsedRequest, Preferences } from "../types";
import { addDays, isoDate, todayIST, WEEKDAYS } from "./parser";

const KNOWN_LANDMARKS: { name: string; city: string; pattern: RegExp }[] = [
  { name: "Andheri Railway Station", city: "Mumbai", pattern: /\bandheri(?:\s+railway)?(?:\s+station)?\b/i },
  { name: "Mithibai College", city: "Mumbai", pattern: /\bmithibai(?:\s+college)?\b/i },
  { name: "Fergusson College", city: "Pune", pattern: /\bfergusson(?:\s+college)?\b/i },
  { name: "FC Road", city: "Pune", pattern: /\bfc\s+road\b/i },
  { name: "IIT Bombay", city: "Mumbai", pattern: /\b(?:iit\s+bombay|iit\s+powai)\b/i },
  { name: "Powai", city: "Mumbai", pattern: /\bpowai\b/i },
  { name: "St. Xavier's College", city: "Mumbai", pattern: /\bst\.?\s*xavier'?s?(?:\s+college)?\b/i },
  { name: "Dadar", city: "Mumbai", pattern: /\bdadar(?:\s+station)?\b/i },
  { name: "Thane", city: "Thane", pattern: /\bthane(?:\s+station)?\b/i },
  { name: "Vile Parle", city: "Mumbai", pattern: /\bvile\s+parle\b/i },
  { name: "Bandra", city: "Mumbai", pattern: /\bbandra\b/i },
  { name: "Koramangala", city: "Bengaluru", pattern: /\bkoramangala\b/i },
];

export function ruleBasedParse(text: string): { parsed: ParsedRequest; confident: boolean } {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, "");
  const today = todayIST();
  const assumptions: string[] = [];

  // 1. Detect Landmark & City
  let landmark: string | null = null;
  let cityHint: string | null = null;

  for (const item of KNOWN_LANDMARKS) {
    if (item.pattern.test(t)) {
      landmark = item.name;
      cityHint = item.city;
      break;
    }
  }

  if (!landmark) {
    const lmMatch =
      text.match(/(?:near|around|close to|opposite|at|in)\s+([A-Za-z0-9\s.'&-]+?)(?:\s+(?:within|under|budget|by|in\s+\d+|for|walking|with|,|\.|$)|$)/i) ||
      text.match(/([A-Za-z0-9\s.'&-]+?)\s+(?:ke\s*pa+s|nazdeek)/i);

    if (lmMatch && lmMatch[1].trim().length > 2) {
      landmark = lmMatch[1].trim();
    }
  }

  // Detect explicit city mentions if not inferred
  if (!cityHint) {
    if (/\bmumbai\b/i.test(t)) cityHint = "Mumbai";
    else if (/\bpune\b/i.test(t)) cityHint = "Pune";
    else if (/\b(?:bangalore|bengaluru)\b/i.test(t)) cityHint = "Bengaluru";
    else if (/\bdelhi\b/i.test(t)) cityHint = "Delhi";
    else if (/\bthane\b/i.test(t)) cityHint = "Thane";
    else if (landmark && /andheri|mithibai|powai|dadar|xavier|parle|bandra/i.test(landmark)) cityHint = "Mumbai";
    else if (landmark && /fergusson|fc\s*road|shivajinagar|pune/i.test(landmark)) cityHint = "Pune";
  }

  // 2. Radius extraction
  let radius = 1000;
  const kmMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:re|er)s?)/);
  const mMatch = t.match(/(\d+)\s*(?:m\b|mtr|metres?|meters?)/);
  if (kmMatch) {
    radius = Math.round(parseFloat(kmMatch[1]) * 1000);
  } else if (mMatch) {
    radius = parseInt(mMatch[1], 10);
  } else if (/\b(?:walking\s*distance|walkable|paidal|walk\s*to)\b/i.test(t)) {
    radius = 1000;
    assumptions.push("Assumed radius is 1000m for walking distance");
  } else {
    radius = 1000;
    assumptions.push("Assumed radius is 1000m as none was specified");
  }

  // 3. Budget extraction
  let minBudget: number | null = null;
  let maxBudget: number | null = null;

  const num = (s: string) => {
    s = s.toLowerCase().trim();
    if (s.endsWith("k")) return Math.round(parseFloat(s) * 1000);
    return parseInt(s, 10);
  };

  const rangeMatch = t.match(/(\d+k?)\s*(?:to|-)\s*(\d+k?)/i);
  const underKMatch = t.match(/(?:under|below|max|upto|within|budget(?:\s*is)?)\s*(?:rs\.?|₹|inr)?\s*(\d+k|\d{4,6})\b/i);
  const standaloneKMatch = t.match(/\b(\d+)\s*k\b/i);
  const rsMatch = t.match(/(?:rs\.?|₹|inr)\s*(\d{4,6}|\d+k)\b/i);

  if (rangeMatch) {
    minBudget = num(rangeMatch[1]);
    maxBudget = num(rangeMatch[2]);
  } else if (underKMatch) {
    maxBudget = num(underKMatch[1]);
  } else if (rsMatch) {
    maxBudget = num(rsMatch[1]);
  } else if (standaloneKMatch && !kmMatch) {
    maxBudget = num(standaloneKMatch[1] + "k");
  }

  const sortPreference = /\b(?:cheapest|cheap|sasta|lowest\s*price)\b/i.test(t)
    ? "cheapest"
    : /\b(?:nearest|closest|paas)\b/i.test(t)
    ? "closest"
    : "best";

  // 4. Move-in Deadline extraction
  let deadline = addDays(today, 7);
  const inDaysMatch = t.match(/\bin\s+(\d+)\s*days?\b/i);
  const weekdayMatch = WEEKDAYS.findIndex((d) => new RegExp(`\\bby\\s+${d}\\b`, "i").test(t));

  if (inDaysMatch) {
    deadline = addDays(today, parseInt(inDaysMatch[1], 10));
  } else if (/\b(?:in\s+a\s+week|1\s+week)\b/i.test(t)) {
    deadline = addDays(today, 7);
  } else if (/\b(?:urgent|asap|jaldi|immediately)\b/i.test(t)) {
    deadline = addDays(today, 2);
  } else if (/\b(?:tomorrow|kal)\b/i.test(t)) {
    deadline = addDays(today, 1);
  } else if (weekdayMatch >= 0) {
    const targetDay = weekdayMatch;
    const diff = (targetDay - today.getUTCDay() + 7) % 7 || 7;
    deadline = addDays(today, diff);
  } else {
    assumptions.push("Assumed deadline in 7 days as none was specified");
  }

  // 5. Gender preference
  const gender = /\b(?:girls?|ladies|women|female|ladkiyo|ladki)\b/i.test(t)
    ? "girls"
    : /\b(?:boys?|gents|men|male|ladko|ladka)\b/i.test(t)
    ? "boys"
    : "any";

  // 6. Sharing preference
  const sharing = /\b(?:single|private|1\s*sharing)\b/i.test(t)
    ? "single"
    : /\b(?:double|twin|2\s*sharing)\b/i.test(t)
    ? "double"
    : /\b(?:triple|3\s*sharing)\b/i.test(t)
    ? "triple"
    : "any";

  // 7. Food preference
  const food = /\b(?:no\s*food|without\s*food|no\s*meals)\b/i.test(t)
    ? "not_needed"
    : /\b(?:food|meals?|mess|tiffin|khana|breakfast|dinner)\b/i.test(t)
    ? "required"
    : "any";

  // 8. Amenities
  const amenities = ["wifi", "ac", "laundry", "geyser", "gym", "cctv", "housekeeping"].filter((a) =>
    new RegExp(`\\b${a}\\b`, "i").test(t)
  );

  // Confidence assessment
  const hasBudgetInText = /\b(?:budget|under|below|rs|₹|k\b|cost|price)\b/i.test(t);
  const budgetExtracted = maxBudget !== null;
  const isBudgetOk = !hasBudgetInText || budgetExtracted;
  const confident = Boolean(landmark && isBudgetOk);

  return {
    parsed: {
      landmark,
      city_hint: cityHint,
      radius_m: radius,
      min_budget: minBudget,
      max_budget: maxBudget,
      deadline_date: isoDate(deadline),
      sort_preference: sortPreference,
      preferences: {
        gender,
        sharing,
        food,
        amenities,
      },
      assumptions,
      clarification_question: landmark ? null : "Which college, station or area should the PG be near?",
    },
    confident,
  };
}
