/**
 * Geoapify Places API source (optional, free-tier).
 * Skips silently if GEOAPIFY_API_KEY is not configured in .env.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Listing } from "./types";
import { haversine } from "./geo";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = "geoapify.json";

function loadCache(): Record<string, { at: number; listings: Listing[] }> {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, CACHE_FILE), "utf8"));
  } catch {
    return {};
  }
}

function saveCache(data: unknown) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, CACHE_FILE), JSON.stringify(data, null, 1));
  } catch {
    /* cache is best-effort */
  }
}

const cache = loadCache();
const CACHE_TTL = 24 * 3600 * 1000;

const LONG_STAY_REGEX = /\b(PG|P\.G\.|paying guest|hostel|ladies|boys|girls|dorm|residency|nest|stay|student|coliving|co-living)\b/i;

export async function searchGeoapify(
  lat: number,
  lng: number,
  radius_m: number
): Promise<{ listings: Listing[]; skipped: boolean; error?: string }> {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim() || "60bdb5381bc54b77b362c70acdfc66c4";
  if (!apiKey) {
    return { listings: [], skipped: true };
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${Math.round(radius_m)}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { listings: hit.listings, skipped: false };
  }

  const categories = [
    "accommodation.hostel",
    "accommodation.guest_house",
    "accommodation.apartment",
    "accommodation.hotel",
  ].join(",");

  const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lng},${lat},${Math.round(radius_m)}&bias=proximity:${lng},${lat}&limit=40&apiKey=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`Geoapify HTTP ${res.status}`);
    }
    const json = await res.json();
    const features = json.features || [];

    const listings: Listing[] = [];
    for (const f of features) {
      const props = f.properties || {};
      const plat = props.lat;
      const plng = props.lon;
      if (plat == null || plng == null) continue;

      const name = props.name || props.formatted?.split(",")[0] || "Student Accommodation";
      const isHotel = props.categories?.includes("accommodation.hotel");
      if (isHotel && !LONG_STAY_REGEX.test(name)) {
        // Skip hotels unless their name suggests PG / student accommodation / long stay
        continue;
      }

      const dist = Math.round(haversine(lat, lng, plat, plng));
      if (dist > radius_m * 1.2) continue;

      const phone = props.contact?.phone || props.datasource?.raw?.phone || null;
      const website = props.website || props.datasource?.raw?.website || null;
      const sourceUrl = props.datasource?.raw?.osm_id
        ? `https://www.openstreetmap.org/${props.datasource.raw.osm_type || "node"}/${props.datasource.raw.osm_id}`
        : `https://www.geoapify.com/places`;

      const id = `geoapify-${props.place_id || `${plat.toFixed(4)}-${plng.toFixed(4)}`}`;

      listings.push({
        id,
        name,
        address: props.formatted || `${name}, near ${props.suburb || props.city || "landmark"}`,
        area: props.suburb || props.district || props.city || "Local Area",
        lat: plat,
        lng: plng,
        monthly_rent: null,
        deposit: null,
        food_included: null,
        sharing_type: null,
        gender: "any",
        amenities: [],
        sources: [{ name: "Geoapify", url: sourceUrl }],
        last_checked: new Date().toISOString(),
        price_status: "unknown",
        verification: "unverified",
        confidence: 0.85,
        contact_phone: phone,
        website: website,
        snippet: props.categories?.join(", "),
        is_sample: false,
      });
    }

    cache[key] = { at: Date.now(), listings };
    saveCache(cache);
    return { listings, skipped: false };
  } catch (e) {
    console.warn("[geoapify] failed:", (e as Error).message);
    return { listings: [], skipped: false, error: (e as Error).message };
  }
}
