/**
 * Merges and de-duplicates listings across sources (OSM Overpass, Geoapify, Live Web Discovery).
 * Matches by normalized name + coordinates within 50 m.
 * Keeps the union of fields and aggregates all sources on each listing.
 */
import "server-only";
import type { Listing, ListingSource } from "./types";
import { haversine } from "./geo";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pg|paying guest|hostel|ladies|boys|girls|accommodation|student|residency|living|house|nest|stay)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function areSamePlace(a: Listing, b: Listing): boolean {
  const dist = haversine(a.lat, a.lng, b.lat, b.lng);
  if (dist > 60) return false;

  const normA = normalizeName(a.name);
  const normB = normalizeName(b.name);

  // If very close coordinates (within 20m), consider matching if either name is generic or similar
  if (dist <= 20) return true;

  if (!normA || !normB) return dist <= 35;

  if (normA === normB || normA.includes(normB) || normB.includes(normA)) {
    return true;
  }

  // Token overlap check
  const tokensA = new Set(normA.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(normB.split(" ").filter((t) => t.length > 2));
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  const minTokens = Math.min(tokensA.size, tokensB.size);
  return minTokens > 0 && overlap / minTokens >= 0.5;
}

export function mergeAndDeduplicate(candidates: Listing[]): Listing[] {
  const merged: Listing[] = [];

  for (const cand of candidates) {
    const existingIndex = merged.findIndex((m) => areSamePlace(m, cand));

    if (existingIndex === -1) {
      merged.push({ ...cand });
    } else {
      const existing = merged[existingIndex];

      // Union of sources
      const existingUrls = new Set(existing.sources.map((s) => s.url));
      const combinedSources: ListingSource[] = [...existing.sources];
      for (const s of cand.sources) {
        if (!existingUrls.has(s.url)) {
          combinedSources.push(s);
          existingUrls.add(s.url);
        }
      }

      // Union of amenities
      const amenSet = new Set([...existing.amenities, ...cand.amenities]);

      // Best phone & website
      const bestPhone = existing.contact_phone || cand.contact_phone || null;
      const bestWebsite = existing.website || cand.website || null;

      // Price: known price takes precedence
      const hasCandPrice = cand.price_status === "listed" && cand.monthly_rent != null && cand.monthly_rent > 0;
      const hasExistPrice = existing.price_status === "listed" && existing.monthly_rent != null && existing.monthly_rent > 0;

      const monthly_rent = hasExistPrice ? existing.monthly_rent : hasCandPrice ? cand.monthly_rent : null;
      const price_status = hasExistPrice || hasCandPrice ? "listed" : "unknown";

      // Gender: specific ("boys" | "girls") takes precedence over "any"
      let gender = existing.gender;
      if (gender === "any" && cand.gender !== "any") {
        gender = cand.gender;
      }

      // Sharing
      const sharing_type = existing.sharing_type || cand.sharing_type || null;

      // Food
      const food_included = existing.food_included !== null ? existing.food_included : cand.food_included;

      // Confidence
      const confidence = Math.max(existing.confidence, cand.confidence);

      merged[existingIndex] = {
        ...existing,
        // Prefer longer / more descriptive name
        name: existing.name.length >= cand.name.length ? existing.name : cand.name,
        monthly_rent,
        price_status,
        contact_phone: bestPhone,
        website: bestWebsite,
        gender,
        sharing_type,
        food_included,
        amenities: Array.from(amenSet),
        sources: combinedSources,
        confidence,
        snippet: existing.snippet || cand.snippet,
        last_checked: new Date().toISOString(),
      };
    }
  }

  return merged;
}
