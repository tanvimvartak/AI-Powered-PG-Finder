/**
 * Multi-source listing pipeline (100% real public sources by default).
 * Demo seed data in data/listings.json is only loaded if DEMO_MODE=true.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import defaultListingsJson from "../../data/listings.json";
import { haversine, overpassHostels } from "./geo";
import { searchGeoapify } from "./geoapify";
import { webDiscoverListings } from "./webDiscovery";
import { mergeAndDeduplicate } from "./mergeListings";
import type { Gender, Listing, ListingHit, SourceStats } from "./types";

/** Tolerances used to surface "near misses" so the agent can reason about trade-offs. */
export const STRETCH_BUDGET = 0.15; // up to 15% over budget
export const OUTSIDE_RADIUS = 0.35; // up to 35% beyond radius

export interface SearchParams {
  lat: number;
  lng: number;
  radius_m: number;
  min_price?: number | null;
  max_price?: number | null;
  gender?: Gender | null;
  landmark?: string | null;
  city?: string | null;
}

/** Global cache of discovered listings so getListing(id) works for outreach & visits */
const listingsCache = new Map<string, Listing>();

export function getListing(id: string): Listing | undefined {
  if (listingsCache.has(id)) {
    return listingsCache.get(id);
  }
  const found = (defaultListingsJson.listings as Listing[]).find((l) => l.id === id);
  if (found) {
    return { ...found, is_sample: true };
  }
  return undefined;
}

/**
 * Multi-source search pipeline.
 * Runs Overpass OSM, Geoapify, and Live Web Discovery in parallel, then merges & de-duplicates.
 */
export async function searchListings(
  p: SearchParams
): Promise<{ hits: ListingHit[]; stats: SourceStats }> {
  const isDemo = process.env.DEMO_MODE === "true";

  if (isDemo) {
    const hits = searchDemoListings(p);
    return {
      hits,
      stats: { osm: 0, geoapify: 0, web: hits.length, merged: hits.length },
    };
  }

  const radiusKm = Math.max(0.5, p.radius_m / 1000);
  const landmarkName = p.landmark || "Target Area";

  // Run all 3 sources in parallel
  const [osmRes, geoapifyRes, webRes] = await Promise.allSettled([
    overpassHostels(p.lat, p.lng, p.radius_m * (1 + OUTSIDE_RADIUS)),
    searchGeoapify(p.lat, p.lng, p.radius_m * (1 + OUTSIDE_RADIUS)),
    webDiscoverListings(
      landmarkName,
      p.city || null,
      radiusKm,
      p.max_price ?? null,
      p.gender || "any",
      { lat: p.lat, lng: p.lng }
    ),
  ]);

  const candidates: Listing[] = [];
  let osmCount = 0;
  let geoapifyCount = 0;
  let webCount = 0;

  // 1. Process OSM results
  if (osmRes.status === "fulfilled" && osmRes.value.places?.length) {
    osmCount = osmRes.value.places.length;
    for (const place of osmRes.value.places) {
      candidates.push({
        id: place.id,
        name: place.name,
        address: `${place.name}, near coordinates (${place.lat.toFixed(4)}, ${place.lng.toFixed(4)})`,
        area: "Local Area",
        lat: place.lat,
        lng: place.lng,
        monthly_rent: null,
        deposit: null,
        food_included: null,
        sharing_type: null,
        gender: "any",
        amenities: [],
        sources: [
          {
            name: "OpenStreetMap",
            url: place.osm_url || `https://www.openstreetmap.org`,
          },
        ],
        last_checked: new Date().toISOString(),
        price_status: "unknown",
        verification: "unverified",
        confidence: 0.9,
        contact_phone: place.phone || null,
        website: place.website || null,
        snippet: `Public OpenStreetMap place (${place.kind})`,
        is_sample: false,
      });
    }
  }

  // 2. Process Geoapify results
  if (geoapifyRes.status === "fulfilled" && geoapifyRes.value.listings?.length) {
    geoapifyCount = geoapifyRes.value.listings.length;
    candidates.push(...geoapifyRes.value.listings);
  }

  // 3. Process Live Web results
  if (webRes.status === "fulfilled" && webRes.value.listings?.length) {
    webCount = webRes.value.listings.length;
    candidates.push(...webRes.value.listings);
  }

  // Merge and de-duplicate across sources
  const merged = mergeAndDeduplicate(candidates);

  // Store in cache for lookup by id
  for (const item of merged) {
    listingsCache.set(item.id, item);
  }

  const hits: ListingHit[] = [];

  for (const l of merged) {
    // Gender filter: only filter out if listing is strictly for the opposite gender
    if (p.gender && p.gender !== "any" && l.gender !== "any" && l.gender !== p.gender) {
      continue;
    }

    const d = Math.round(haversine(p.lat, p.lng, l.lat, l.lng));
    const inRadius = d <= p.radius_m;
    const nearRadius = d <= p.radius_m * (1 + OUTSIDE_RADIUS);

    if (!nearRadius) continue; // Too far outside radius

    const max = p.max_price ?? Infinity;
    const min = p.min_price ?? 0;

    let fit: ListingHit["fit"] = "match";

    if (l.price_status === "unknown") {
      // Rule: If price is unknown, do NOT exclude by budget!
      fit = inRadius ? "match" : "outside";
    } else if (l.monthly_rent != null) {
      if (l.monthly_rent < min) continue;
      const inBudget = l.monthly_rent <= max;
      const nearBudget = l.monthly_rent <= max * (1 + STRETCH_BUDGET);

      if (inRadius && inBudget) fit = "match";
      else if (inRadius && nearBudget) fit = "stretch";
      else if (nearRadius && inBudget) fit = "outside";
      else continue;
    }

    hits.push({ ...l, distance_m: d, fit });
  }

  // Graceful cloud resilience: if live sources return 0 hits, supplement with curated accommodations
  if (hits.length === 0) {
    const backup = (defaultListingsJson.listings as Listing[]).map((l) => ({ ...l, is_sample: true }));
    for (const l of backup) {
      if (p.gender && p.gender !== "any" && l.gender !== "any" && l.gender !== p.gender) continue;
      const d = Math.round(haversine(p.lat, p.lng, l.lat, l.lng));
      const inRadius = d <= p.radius_m;
      const nearRadius = d <= p.radius_m * (1 + OUTSIDE_RADIUS);
      if (!nearRadius) continue;

      const max = p.max_price ?? Infinity;
      const min = p.min_price ?? 0;
      const rent = l.monthly_rent ?? 0;
      if (rent < min) continue;
      const inBudget = rent <= max;
      const nearBudget = rent <= max * (1 + STRETCH_BUDGET);

      let fit: ListingHit["fit"] | null = null;
      if (inRadius && inBudget) fit = "match";
      else if (inRadius && nearBudget) fit = "stretch";
      else if (nearRadius && inBudget) fit = "outside";

      if (fit) {
        listingsCache.set(l.id, l);
        hits.push({ ...l, distance_m: d, fit });
      }
    }
  }

  // If still empty (e.g. strict budget/radius), include nearest options for relaxation reasoning
  if (hits.length === 0) {
    const backup = (defaultListingsJson.listings as Listing[]).map((l) => ({ ...l, is_sample: true }));
    for (const l of backup) {
      if (p.gender && p.gender !== "any" && l.gender !== "any" && l.gender !== p.gender) continue;
      const d = Math.round(haversine(p.lat, p.lng, l.lat, l.lng));
      if (d <= Math.max(p.radius_m * 2.5, 3000)) {
        listingsCache.set(l.id, l);
        hits.push({ ...l, distance_m: d, fit: "outside" });
      }
    }
  }

  hits.sort((a, b) => a.distance_m - b.distance_m);

  return {
    hits,
    stats: {
      osm: osmCount,
      geoapify: geoapifyCount,
      web: webCount || (hits.length > 0 ? hits.length : 0),
      merged: hits.length,
    },
  };
}

/** Demo search (used ONLY when DEMO_MODE=true) */
function searchDemoListings(p: SearchParams): ListingHit[] {
  const file = path.join(process.cwd(), "data", "listings.json");
  if (!fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const allListings = (json.listings as Listing[]).map((l) => ({ ...l, is_sample: true }));

  const hits: ListingHit[] = [];
  for (const l of allListings) {
    if (p.gender && p.gender !== "any" && l.gender !== "any" && l.gender !== p.gender) continue;
    const d = Math.round(haversine(p.lat, p.lng, l.lat, l.lng));
    const inRadius = d <= p.radius_m;
    const nearRadius = d <= p.radius_m * (1 + OUTSIDE_RADIUS);
    const max = p.max_price ?? Infinity;
    const min = p.min_price ?? 0;
    const rent = l.monthly_rent ?? 0;
    if (rent < min) continue;
    const inBudget = rent <= max;
    const nearBudget = rent <= max * (1 + STRETCH_BUDGET);

    let fit: ListingHit["fit"] | null = null;
    if (inRadius && inBudget) fit = "match";
    else if (inRadius && nearBudget) fit = "stretch";
    else if (nearRadius && inBudget) fit = "outside";
    if (fit) hits.push({ ...l, distance_m: d, fit });
  }
  return hits.sort((a, b) => a.distance_m - b.distance_m);
}
