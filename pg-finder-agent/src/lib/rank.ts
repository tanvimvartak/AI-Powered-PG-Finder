/**
 * Deterministic, honest ranking for PG listings.
 * - Listings with known prices within budget rank above unknown-price ones.
 * - Unknown-price listings appear in a separate "Worth asking about" group.
 * - Distance and walking time are computed from real coordinates.
 * - Hidden-cost, review-sentiment and availability-by-deadline scoring are REMOVED
 *   unless the real source actually provides that data.
 */
import type { ListingHit, Preferences, RankedListing } from "./types";

const WALK_M_PER_MIN = 80; // ~4.8 km/h
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

export function rankListings(input: RankInput): RankedListing[] {
  const { hits, preferences, max_budget, radius_m, sort_preference } = input;

  const budget = max_budget ?? 15000;
  const wantedAmenities = (preferences.amenities || []).map((a) => a.toLowerCase());

  // 1. Partition into known price vs unknown price
  const withPrice = hits.filter((h) => h.price_status === "listed" && h.monthly_rent != null && h.monthly_rent > 0);
  const withoutPrice = hits.filter((h) => h.price_status === "unknown" || h.monthly_rent == null);

  // 2. Score known-price listings
  const scoredWithPrice = withPrice.map((l) => {
    const rent = l.monthly_rent!;
    const flags: string[] = [];
    const pros: string[] = [];

    const walk = Math.round(l.distance_m / WALK_M_PER_MIN);
    const distScore = Math.max(0, 1 - l.distance_m / (radius_m * 1.35));

    // Price score
    let priceScore = 0.5;
    if (rent <= budget) {
      priceScore = 0.6 + 0.4 * (1 - rent / budget);
      pros.push(`${inr(rent)}/mo (within budget)`);
    } else {
      priceScore = Math.max(0, 0.5 - ((rent - budget) / budget) * 2);
      flags.push(`${inr(rent - budget)} over your ${inr(budget)} budget`);
    }

    if (sort_preference === "cheapest") {
      priceScore = Math.max(0, 1 - rent / (budget * 1.5));
    }

    // Distance
    if (walk <= 10) pros.push(`${walk} min walk (${l.distance_m} m)`);
    else pros.push(`${(l.distance_m / 1000).toFixed(1)} km away`);

    // Amenities
    let amenScore = 0.5;
    if (wantedAmenities.length) {
      const matchCount = wantedAmenities.filter((w) => l.amenities.map((a) => a.toLowerCase()).includes(w)).length;
      amenScore = matchCount / wantedAmenities.length;
      if (matchCount > 0) pros.push(`offers ${wantedAmenities.join(", ")}`);
    } else if (l.amenities.length > 0) {
      amenScore = Math.min(1, l.amenities.length / 5);
      pros.push(`${l.amenities.length} listed amenities`);
    }

    // Food
    if (l.food_included === true) {
      pros.push("meals included");
    } else if (l.food_included === false && preferences.food === "required") {
      flags.push("meals not included");
    }

    // Sharing fit
    if (preferences.sharing !== "any" && l.sharing_type && l.sharing_type !== preferences.sharing) {
      flags.push(`${l.sharing_type} room (requested ${preferences.sharing})`);
    }

    // Weights
    const wPrice = sort_preference === "cheapest" ? 0.45 : 0.35;
    const wDist = sort_preference === "closest" ? 0.45 : 0.35;
    const wAmen = 0.15;
    const wConf = 0.15;

    const totalWeight = wPrice + wDist + wAmen + wConf;
    const score = Math.round(
      (100 * (wPrice * priceScore + wDist * distScore + wAmen * amenScore + wConf * l.confidence)) / totalWeight
    );

    const breakdown = {
      price: Math.round(priceScore * 100) / 100,
      distance: Math.round(distScore * 100) / 100,
      amenities: Math.round(amenScore * 100) / 100,
      confidence: Math.round(l.confidence * 100) / 100,
    };

    return {
      rank: 0,
      listing: l,
      score,
      effective_monthly_cost: rent,
      walk_minutes: walk,
      why: pros.slice(0, 3).join(", ").replace(/^./, (c) => c.toUpperCase()) || "Good match near destination",
      red_flags: flags,
      breakdown,
      group: "top_match" as const,
    };
  });

  scoredWithPrice.sort((a, b) => b.score - a.score);

  // 3. Score unknown-price listings ("Worth asking about")
  const scoredWithoutPrice = withoutPrice.map((l) => {
    const walk = Math.round(l.distance_m / WALK_M_PER_MIN);
    const distScore = Math.max(0, 1 - l.distance_m / (radius_m * 1.35));
    const flags: string[] = ["Price unverified. Contact owner for current rent."];
    const pros: string[] = ["Price not listed. Ask owner"];

    if (walk <= 10) pros.push(`${walk} min walk (${l.distance_m} m)`);
    else pros.push(`${(l.distance_m / 1000).toFixed(1)} km away`);

    if (l.sources.length) {
      pros.push(`found on ${l.sources.map((s) => s.name).join(", ")}`);
    }

    const score = Math.round(100 * (distScore * 0.7 + l.confidence * 0.3));
    const breakdown = {
      distance: Math.round(distScore * 100) / 100,
      confidence: Math.round(l.confidence * 100) / 100,
    };

    return {
      rank: 0,
      listing: l,
      score,
      effective_monthly_cost: null,
      walk_minutes: walk,
      why: pros.join(" • "),
      red_flags: flags,
      breakdown,
      group: "worth_asking" as const,
    };
  });

  // Sort unknown price listings by distance
  scoredWithoutPrice.sort((a, b) => a.listing.distance_m - b.listing.distance_m);

  // Combine: Top Matches first, then Worth Asking About
  const topLimit = input.top_n ?? 6;
  const finalResults: RankedListing[] = [
    ...scoredWithPrice.slice(0, topLimit),
    ...scoredWithoutPrice.slice(0, 6),
  ];

  finalResults.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return finalResults;
}
