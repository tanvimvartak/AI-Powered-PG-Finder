/**
 * Geo utilities: Haversine distance, Nominatim geocoding (rate-limited + cached,
 * with a curated fallback table) and Overpass (OSM) hostel lookup (cached).
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { GeoPoint, OsmPlace } from "./types";

const UA = () => process.env.OSM_USER_AGENT || "PGFinderAgent/0.1 (student demo)";
const CACHE_DIR = path.join(process.cwd(), "data", "cache");

/** Great-circle distance in metres. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ───────────────────────── small persistent JSON cache ─────────────────────────
function loadCache<T>(name: string): Record<string, T> {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), "utf8"));
  } catch {
    return {};
  }
}
function saveCache(name: string, data: unknown) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(data, null, 1));
  } catch {
    /* cache is best-effort */
  }
}

const geoCache = loadCache<GeoPoint>("geocode.json");
const overpassCache = loadCache<{ at: number; places: OsmPlace[] }>("overpass.json");

// ───────────────────────── curated landmark table ─────────────────────────
/**
 * Hand-checked coordinates for common student landmarks. Used first so the
 * demo is deterministic and never breaks if Nominatim is down/slow.
 */
const CURATED: { keys: RegExp; lat: number; lng: number; name: string }[] = [
  { keys: /mithibai/i, lat: 19.1075, lng: 72.8365, name: "Mithibai College, Vile Parle West, Mumbai" },
  { keys: /nmims/i, lat: 19.1033, lng: 72.8371, name: "NMIMS, Vile Parle West, Mumbai" },
  { keys: /vile\s*parle/i, lat: 19.0997, lng: 72.8436, name: "Vile Parle, Mumbai" },
  { keys: /andheri/i, lat: 19.1197, lng: 72.8464, name: "Andheri Railway Station, Mumbai" },
  { keys: /\biit\b|iitb/i, lat: 19.1334, lng: 72.9133, name: "IIT Bombay, Powai, Mumbai" },
  { keys: /powai/i, lat: 19.1176, lng: 72.906, name: "Powai, Mumbai" },
  { keys: /dadar/i, lat: 19.0187, lng: 72.843, name: "Dadar Railway Station, Mumbai" },
  { keys: /thane/i, lat: 19.186, lng: 72.9757, name: "Thane Railway Station, Thane" },
];

function curatedLookup(place: string): GeoPoint | null {
  const hit = CURATED.find((c) => c.keys.test(place));
  return hit ? { lat: hit.lat, lng: hit.lng, display_name: hit.name, source: "curated" } : null;
}

// ───────────────────────── Nominatim (1 req/s) ─────────────────────────
let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatim = 0;

/** Serialises Nominatim calls so we never exceed 1 request/second. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = Math.max(0, lastNominatim + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    return fn();
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

export async function geocode(place: string, cityHint?: string | null): Promise<GeoPoint | null> {
  const q = [place, cityHint].filter(Boolean).join(", ");
  const key = q.toLowerCase().trim();

  const curated = curatedLookup(place);
  if (curated) return curated;
  if (geoCache[key]) return { ...geoCache[key], source: "cache" };

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`;
    const data = await throttled(async () => {
      const res = await fetch(url, { headers: { "User-Agent": UA(), "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      return (await res.json()) as { lat: string; lon: string; display_name: string }[];
    });
    if (!data.length) return null;
    const point: GeoPoint = { lat: +data[0].lat, lng: +data[0].lon, display_name: data[0].display_name, source: "nominatim" };
    geoCache[key] = point;
    saveCache("geocode.json", geoCache);
    return point;
  } catch (e) {
    console.warn("[geocode] Nominatim failed:", (e as Error).message);
    return null;
  }
}

// ───────────────────────── Overpass (OSM hostels / guest houses) ─────────────────────────
const OVERPASS_TTL = 24 * 3600 * 1000;
/** Public Overpass instances, tried in order (the main one is often at capacity). */
const OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
let overpassDownUntil = 0; // circuit breaker after all mirrors fail

export async function overpassHostels(lat: number, lng: number, radius: number): Promise<{ places: OsmPlace[]; cached: boolean; error?: string }> {
  if (process.env.ENABLE_OVERPASS === "false") return { places: [], cached: false, error: "disabled" };
  const r = Math.min(Math.round(radius), 6000);
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${r}`;
  const hit = overpassCache[key];
  if (hit && Date.now() - hit.at < OVERPASS_TTL) return { places: hit.places, cached: true };
  if (Date.now() < overpassDownUntil) return { places: [], cached: false, error: "Overpass temporarily unavailable (skipping for a few minutes)" };

  const query = `[out:json][timeout:12];(nwr["tourism"~"^(hostel|guest_house)$"](around:${r},${lat},${lng});nwr["amenity"="dormitory"](around:${r},${lat},${lng}););out center 40;`;
  try {
    type OverpassJson = { elements: { id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
    let json: OverpassJson | null = null;
    let lastErr = "";
    for (const endpoint of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": UA(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = (await res.json()) as OverpassJson;
        break;
      } catch (e) {
        lastErr = `${new URL(endpoint).host}: ${(e as Error).message}`;
      }
    }
    if (!json) throw new Error(`all Overpass mirrors failed (${lastErr})`);
    const places: OsmPlace[] = json.elements
      .map((el) => {
        const plat = el.lat ?? el.center?.lat;
        const plng = el.lon ?? el.center?.lon;
        if (plat == null || plng == null) return null;
        return {
          id: `osm-${el.type}-${el.id}`,
          name: el.tags?.name || "Unnamed " + (el.tags?.tourism || "hostel").replace("_", " "),
          kind: el.tags?.tourism || el.tags?.amenity || "hostel",
          lat: plat,
          lng: plng,
          distance_m: Math.round(haversine(lat, lng, plat, plng)),
        };
      })
      .filter((p): p is OsmPlace => !!p)
      .sort((a, b) => a.distance_m - b.distance_m);
    overpassCache[key] = { at: Date.now(), places };
    saveCache("overpass.json", overpassCache);
    return { places, cached: false };
  } catch (e) {
    console.warn("[overpass] failed:", (e as Error).message);
    overpassDownUntil = Date.now() + 5 * 60 * 1000;
    return { places: [], cached: false, error: (e as Error).message };
  }
}
