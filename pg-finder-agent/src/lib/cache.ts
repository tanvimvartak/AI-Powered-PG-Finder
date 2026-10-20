/**
 * Persistent Response Cache with 24h TTL and Pre-Warmed Demo Cache.
 * Caches:
 *  1. agent_run (full end-to-end response for query)
 *  2. parsed_request
 *  3. geocode
 *  4. overpass
 *  5. geoapify
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent, GeoPoint, Listing, OsmPlace, ParsedRequest, RankedListing } from "./types";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "response_cache.json");
const TTL_MS = 24 * 3600 * 1000; // 24 hours

export interface CachedAgentRun {
  at: number;
  events: AgentEvent[];
  parsed: ParsedRequest;
  point: GeoPoint;
  ranked: RankedListing[];
  finalText: string;
}

interface CacheStore {
  agent_runs: Record<string, CachedAgentRun>;
  parsed_requests: Record<string, { at: number; data: ParsedRequest }>;
  geocodes: Record<string, { at: number; data: GeoPoint }>;
  overpass: Record<string, { at: number; data: OsmPlace[] }>;
  geoapify: Record<string, { at: number; data: Listing[] }>;
}

let storeMemory: CacheStore | null = null;

export function normalizeQueryKey(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function loadStore(): CacheStore {
  if (storeMemory) return storeMemory;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, "utf8");
      if (content.trim()) {
        storeMemory = JSON.parse(content);
        return storeMemory!;
      }
    }
  } catch (e) {
    console.warn("[Cache] Failed to load response_cache.json:", (e as Error).message);
  }

  storeMemory = {
    agent_runs: {},
    parsed_requests: {},
    geocodes: {},
    overpass: {},
    geoapify: {},
  };
  return storeMemory;
}

function saveStore() {
  if (!storeMemory) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(storeMemory, null, 1), "utf8");
  } catch (e) {
    /* best-effort persistence */
  }
}

// ───────────────────────── Agent Run Cache ─────────────────────────
export function getCachedAgentRun(query: string): CachedAgentRun | null {
  const store = loadStore();
  const key = normalizeQueryKey(query);
  const entry = store.agent_runs[key];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry;
  }
  return null;
}

export function setCachedAgentRun(query: string, data: Omit<CachedAgentRun, "at">) {
  const store = loadStore();
  const key = normalizeQueryKey(query);
  store.agent_runs[key] = { ...data, at: Date.now() };
  saveStore();
}

// ───────────────────────── Parsed Request Cache ─────────────────────────
export function getCachedParsedRequest(query: string): ParsedRequest | null {
  const store = loadStore();
  const key = normalizeQueryKey(query);
  const entry = store.parsed_requests[key];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry.data;
  }
  return null;
}

export function setCachedParsedRequest(query: string, data: ParsedRequest) {
  const store = loadStore();
  const key = normalizeQueryKey(query);
  store.parsed_requests[key] = { at: Date.now(), data };
  saveStore();
}

// ───────────────────────── Geocode Cache ─────────────────────────
export function getCachedGeocode(key: string): GeoPoint | null {
  const store = loadStore();
  const norm = normalizeQueryKey(key);
  const entry = store.geocodes[norm];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry.data;
  }
  return null;
}

export function setCachedGeocode(key: string, data: GeoPoint) {
  const store = loadStore();
  const norm = normalizeQueryKey(key);
  store.geocodes[norm] = { at: Date.now(), data };
  saveStore();
}

// ───────────────────────── Overpass Cache ─────────────────────────
export function getCachedOverpass(key: string): OsmPlace[] | null {
  const store = loadStore();
  const entry = store.overpass[key];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry.data;
  }
  return null;
}

export function setCachedOverpass(key: string, data: OsmPlace[]) {
  const store = loadStore();
  store.overpass[key] = { at: Date.now(), data };
  saveStore();
}

// ───────────────────────── Geoapify Cache ─────────────────────────
export function getCachedGeoapify(key: string): Listing[] | null {
  const store = loadStore();
  const entry = store.geoapify[key];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry.data;
  }
  return null;
}

export function setCachedGeoapify(key: string, data: Listing[]) {
  const store = loadStore();
  store.geoapify[key] = { at: Date.now(), data };
  saveStore();
}

// ───────────────────────── Pre-Warmed Demo Cache ─────────────────────────
/**
 * Pre-warms the cache with the 5 key sample queries so that demo requests
 * take zero LLM calls and return immediately with real verified data.
 */
export function initDemoCache() {
  const store = loadStore();

  const demoQueries: Record<string, { landmark: string; city: string; radius_m: number; budget: number; gender: "girls" | "boys" | "any"; deadlineDays: number }> = {
    "girls pg near andheri station walking distance under 6k": {
      landmark: "Andheri Railway Station",
      city: "Mumbai",
      radius_m: 1000,
      budget: 6000,
      gender: "girls",
      deadlineDays: 7,
    },
    "please find me a pg accommodation near mithibai college within 1 km radius my budget is rs 5 000 and i need the accommodation in 5 days": {
      landmark: "Mithibai College",
      city: "Mumbai",
      radius_m: 1000,
      budget: 5000,
      gender: "any",
      deadlineDays: 5,
    },
    "pg near fergusson college pune within 2 km budget 8000": {
      landmark: "Fergusson College",
      city: "Pune",
      radius_m: 2000,
      budget: 8000,
      gender: "any",
      deadlineDays: 7,
    },
    "hostel or pg near st xavier s college mumbai within 1 5 km": {
      landmark: "St. Xavier's College",
      city: "Mumbai",
      radius_m: 1500,
      budget: 12000,
      gender: "any",
      deadlineDays: 7,
    },
    "pg near iit bombay powai under 10k for boys": {
      landmark: "IIT Bombay",
      city: "Mumbai",
      radius_m: 1500,
      budget: 10000,
      gender: "boys",
      deadlineDays: 7,
    },
  };

  const today = new Date(Date.now() + 330 * 60000);
  const isoToday = today.toISOString().slice(0, 10);

  for (const [rawKey, spec] of Object.entries(demoQueries)) {
    const key = normalizeQueryKey(rawKey);
    if (!store.parsed_requests[key]) {
      const deadline = new Date(today.getTime() + spec.deadlineDays * 86400000).toISOString().slice(0, 10);
      store.parsed_requests[key] = {
        at: Date.now(),
        data: {
          landmark: spec.landmark,
          city_hint: spec.city,
          radius_m: spec.radius_m,
          min_budget: null,
          max_budget: spec.budget,
          deadline_date: deadline,
          sort_preference: "best",
          preferences: { gender: spec.gender, sharing: "any", food: "any", amenities: [] },
          assumptions: ["Pre-warmed demo cache entry for zero-latency response."],
          clarification_question: null,
        },
      };
    }
  }

  saveStore();
}

// Auto-initialize demo cache on module load
try {
  initDemoCache();
} catch {}
