/**
 * Deterministic, explainable ranking for PG listings.
 *
 * Weighted factors (each scored 0..1):
 *   price        real monthly cost vs budget (rent + electricity + maintenance, food value credited)
 *   distance     closeness relative to the search radius
 *   amenities    requested amenities matched (or general amenity richness)
 *   reviews      rating + keyword sentiment of review snippets
 *   availability available on/before the user's deadline
 *   hidden       penalties for high deposits & extra charges
 *
 * For larger radii the distance/travel weight is increased: when someone is
 * willing to go 5 km, commute convenience matters more than when everything
 * is walkable.
 */
import type { ListingHit, Preferences, RankedListing } from "./types";

/** Approximate monthly value of meals when food is included (Mumbai student mess). */
export const FOOD_VALUE = 2500;
const WALK_M_PER_MIN = 80; // ~4.8 km/h

const NEG = ["bedbug", "dirty", "leak", "damp", "ignored", "refund", "problem", "noisy", "noise", "crowded", "rarely", "strict", "changing rules", "deducts", "huge", "far"];
const POS = ["clean", "safe", "homely", "excellent", "great", "good", "caring", "peaceful", "worth", "spacious", "modern", "value"];

function sentiment(snippets: string[]): number {
  const text = snippets.join(" ").toLowerCase();
  const neg = NEG.filter((w) => text.includes(w)).length;
  const pos = POS.filter((w) => text.includes(w)).length;
  return Math.max(-1, Math.min(1, (pos - neg * 1.5) / 3));
}

const daysBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
const inr = (n: number) => "Rs " + n.toLocaleString("en-IN");

export interface RankInput {
  hits: ListingHit[];
  preferences: Preferences;
  deadline_date: string | null;
  max_budget: number | null;
  radius_m: number;
  sort_preference?: "best" | "cheapest" | "closest";
  top_n?: number;
}

export function weightsFor(radius: number, sort: RankInput["sort_preference"]) {
  // travel weight grows with radius: 0.20 @ ≤1 km → 0.32 @ ≥5 km
  const travel = 0.2 + Math.min(Math.max((radius - 1000) / 4000, 0), 1) * 0.12;
  const w = { price: 0.28, distance: travel, amenities: 0.1, reviews: 0.17, availability: 0.15, hidden: 0.1 };
  if (sort === "cheapest") w.price += 0.2;
  if (sort === "closest") w.distance += 0.2;
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / sum])) as typeof w;
}

export function rankListings(input: RankInput): RankedListing[] {
  const { hits, preferences, deadline_date, max_budget, radius_m } = input;
  const w = weightsFor(radius_m, input.sort_preference);
  const budget = max_budget ?? Math.max(...hits.map((h) => h.monthly_rent), 1);

  const scored = hits.map((l) => {
    const flags: string[] = [];
    const pros: string[] = [];
    const extras = l.extra_charges.electricity + l.extra_charges.maintenance;
    const effective = l.monthly_rent + extras;
    // Food value credit: included food saves money vs eating out
    const valueCost = effective - (l.food_included ? FOOD_VALUE : 0) + (!l.food_included && preferences.food === "required" ? FOOD_VALUE : 0);

    // ── price
    let price: number;
    if (valueCost <= budget) price = 0.6 + 0.4 * (1 - valueCost / budget);
    else price = Math.max(0, 0.6 - ((valueCost - budget) / budget) * 4);
    if (input.sort_preference === "cheapest") price = Math.max(0, 1 - effective / (budget * 1.5));

    // ── distance
    const distance = Math.max(0, 1 - l.distance_m / (radius_m * (1 + 0.35)));
    const walk = Math.round(l.distance_m / WALK_M_PER_MIN);

    // ── amenities
    const wanted = preferences.amenities.map((a) => a.toLowerCase());
    const amenities = wanted.length ? wanted.filter((a) => l.amenities.includes(a)).length / wanted.length : Math.min(l.amenities.length / 5, 1);

    // ── reviews
    const sent = sentiment(l.review_snippets);
    const reviews = Math.max(0, Math.min(1, (l.rating - 2) / 3 + sent * 0.15));

    // ── availability
    let availability = 1;
    if (deadline_date) {
      const late = daysBetween(l.available_from, deadline_date);
      if (late > 0) {
        availability = Math.max(0, 0.3 - late * 0.03);
        flags.push(`Available only from ${l.available_from}, ${late} day${late > 1 ? "s" : ""} after your deadline`);
      }
    }

    // ── hidden costs
    let hidden = 1;
    if (l.deposit > 2 * l.monthly_rent) {
      hidden -= 0.6;
      flags.push(`High deposit ${inr(l.deposit)} (${Math.round(l.deposit / l.monthly_rent)}× rent)`);
    }
    if (extras > 0) {
      hidden -= 0.3;
      const parts = [l.extra_charges.electricity && `electricity ~${inr(l.extra_charges.electricity)}`, l.extra_charges.maintenance && `maintenance ${inr(l.extra_charges.maintenance)}`].filter(Boolean).join(" + ");
      flags.push(`Extra ${parts}/month → real cost ${inr(effective)}`);
      if (max_budget && l.monthly_rent <= max_budget && effective > max_budget) flags.push(`Real monthly cost exceeds your ${inr(max_budget)} budget`);
    }
    if (!l.food_included && preferences.food === "required") flags.push("Food not included (~" + inr(FOOD_VALUE) + "/month extra)");
    hidden = Math.max(0, hidden);

    // ── review & fit flags
    if (l.rating < 3) flags.push(`Poor rating ${l.rating}★: "${l.review_snippets[0]}"`);
    if (l.fit === "stretch" && max_budget) flags.push(`${inr(l.monthly_rent - max_budget)} over budget`);
    if (l.fit === "outside") flags.push(`Slightly outside your radius (${(l.distance_m / 1000).toFixed(1)} km)`);
    if (preferences.sharing !== "any" && l.sharing_type !== preferences.sharing) flags.push(`${l.sharing_type} sharing (you asked for ${preferences.sharing})`);

    // ── pros (for the "why this one" line)
    if (max_budget && effective <= max_budget) pros.push(`${inr(effective)} all-in, within budget`);
    if (l.food_included) pros.push(l.fit === "stretch" ? `food included (worth ~${inr(FOOD_VALUE)}), so effectively cheaper` : "food included");
    if (walk <= 12) pros.push(`${walk} min walk`);
    else if (l.distance_m <= 3000) pros.push(`${(l.distance_m / 1000).toFixed(1)} km (~${Math.round(l.distance_m / 250)} min by auto)`);
    if (l.rating >= 4.3) pros.push(`rated ${l.rating}★`);
    if (availability === 1 && deadline_date) pros.push("ready before your deadline");
    if (wanted.length && amenities === 1) pros.push(`has ${wanted.join(", ")}`);

    const breakdown = { price, distance, amenities, reviews, availability, hidden };
    const score = Math.round(100 * (w.price * price + w.distance * distance + w.amenities * amenities + w.reviews * reviews + w.availability * availability + w.hidden * hidden));

    return {
      listing: l,
      score,
      effective_monthly_cost: effective,
      walk_minutes: walk,
      why: pros.slice(0, 3).join(", ").replace(/^./, (c) => c.toUpperCase()) || "Closest available option",
      red_flags: flags,
      breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, input.top_n ?? 5)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
