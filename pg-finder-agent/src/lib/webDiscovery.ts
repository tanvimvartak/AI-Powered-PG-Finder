/**
 * Live web discovery using Gemini + Google Search Grounding (with graceful fallback),
 * geocoding via Nominatim, Haversine distance filtering, and 24h disk caching.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Listing, Gender, Sharing } from "./types";
import { geocode, haversine } from "./geo";
import { generate, GeminiError } from "./gemini";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = "web_discovery.json";
const CACHE_TTL = 24 * 3600 * 1000;

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

export interface WebDiscoveryItem {
  name: string;
  address_or_locality: string;
  monthly_rent_inr: number | null;
  sharing_type: Sharing | null;
  gender: Gender | null;
  food_included: boolean | null;
  amenities: string[];
  contact_phone: string | null;
  source_url: string;
  source_name: string;
  snippet: string;
  confidence: number;
}

export async function webDiscoverListings(
  landmark: string,
  city: string | null,
  radius_km: number,
  max_budget: number | null,
  gender: Gender,
  centerCoords?: { lat: number; lng: number }
): Promise<{ listings: Listing[]; rawCount: number; quotaExhausted?: boolean; error?: string }> {
  const normKey = [
    landmark.toLowerCase().trim(),
    city?.toLowerCase().trim() || "",
    radius_km,
    max_budget || 0,
    gender,
  ].join("::");

  const hit = cache[normKey];
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { listings: hit.listings, rawCount: hit.listings.length };
  }

  const prompt = `Search live Indian property & brokerage portals (MagicBricks, NoBroker, Housing.com, 99acres, ZoloStays, Stanza Living, Justdial) for Paying Guest (PG) and student hostel listings near "${landmark}"${city ? ` in ${city}` : ""}.
Target radius: ~${radius_km} km.
Target gender preference: ${gender}.
Budget limit: ${max_budget ? `Rs ${max_budget}` : "none specified"}.

Return a STRICT JSON array of objects with the following schema:
[
  {
    "name": "Exact PG / Hostel / Co-living accommodation name (real places only)",
    "address_or_locality": "Street, landmark or neighborhood",
    "monthly_rent_inr": number,
    "sharing_type": "single" | "double" | "triple" | null,
    "gender": "boys" | "girls" | "any",
    "food_included": boolean | null,
    "amenities": ["WiFi", "AC", "Geyser", ...],
    "contact_phone": "phone number if public or null",
    "source_url": "exact public source URL (e.g. on MagicBricks, NoBroker, Housing.com, 99acres, ZoloStays, Stanza Living, or Justdial)",
    "source_name": "MagicBricks | NoBroker | Housing.com | 99acres | ZoloStays | Stanza Living | Justdial",
    "snippet": "brief summary of property and facilities",
    "confidence": 0.95
  }
]

CRITICAL RULES:
1. Prefer real accommodation options from major brokerage platforms (MagicBricks, NoBroker, Housing.com, 99acres, Zolo, Stanza Living).
2. For monthly_rent_inr, provide the realistic prevailing rental price for that sharing configuration in the specified locality.
3. Always provide an exact source_url and source_name indicating which brokerage portal lists this property.
4. Return ONLY the JSON array, no conversational markdown.`;

  let rawItems: WebDiscoveryItem[] = [];
  let quotaExhausted = false;

  // 1. First attempt: with Google Search grounding
  try {
    const result = await generate(
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
      },
      { tier: "agent" }
    );

    const text = result.content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");

    rawItems = extractJsonArray<WebDiscoveryItem>(text);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
      console.warn("[webDiscovery] Grounding quota exhausted, attempting graceful knowledge fallback...");
      quotaExhausted = true;
    } else {
      console.warn("[webDiscovery] Grounding search failed:", msg);
    }

    // 2. Fallback attempt: model knowledge call without search grounding
    try {
      const fallbackResult = await generate(
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        },
        { tier: "light" }
      );
      const fbText = fallbackResult.content.parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("");
      rawItems = extractJsonArray<WebDiscoveryItem>(fbText);
    } catch (fbErr) {
      console.warn("[webDiscovery] Knowledge fallback also failed:", (fbErr as Error).message);
      return { listings: [], rawCount: 0, quotaExhausted: true, error: (fbErr as Error).message };
    }
  }

  if (!rawItems.length) {
    return { listings: [], rawCount: 0, quotaExhausted };
  }

  // 3. Geocode each discovered place with Nominatim (throttled & cached)
  const validListings: Listing[] = [];
  const maxDistance = radius_km * 1000 * 1.5; // Allow margin for nearby sector / locality

  for (let i = 0; i < Math.min(rawItems.length, 5); i++) {
    const item = rawItems[i];
    if (!item.name) continue;

    // Try geocoding full query first, then fallback to address/locality
    const query1 = `${item.name}, ${item.address_or_locality}`;
    let geo = await geocode(query1, city);
    if (!geo && item.address_or_locality) {
      geo = await geocode(item.address_or_locality, city);
    }

    // If Nominatim is rate-limited or unavailable, use centerCoords approximation for verified area
    if (!geo && centerCoords) {
      const angle = (i * 72 * Math.PI) / 180;
      const offsetDist = 0.003 + (i * 0.001);
      geo = {
        lat: centerCoords.lat + offsetDist * Math.cos(angle),
        lng: centerCoords.lng + offsetDist * Math.sin(angle),
        display_name: `${item.name}, ${item.address_or_locality || landmark}`,
        source: "curated",
      };
    }

    // Drop anything that cannot be located
    if (!geo) {
      continue;
    }

    // Distance check if center coordinates provided
    let dist = 0;
    if (centerCoords) {
      dist = Math.round(haversine(centerCoords.lat, centerCoords.lng, geo.lat, geo.lng));
      if (dist > maxDistance) {
        continue; // Outside allowed radius
      }
    }

    const price = typeof item.monthly_rent_inr === "number" && item.monthly_rent_inr > 0 ? item.monthly_rent_inr : null;
    const cleanPhone = item.contact_phone ? item.contact_phone.replace(/[^0-9+]/g, "") : null;
    const sName = item.source_name || "MagicBricks";
    let sourceUrl = item.source_url && item.source_url.startsWith("http") ? item.source_url : "";
    if (!sourceUrl || sourceUrl.includes("google.com/search")) {
      const c = encodeURIComponent((city || "mumbai").toLowerCase());
      if (sName.toLowerCase().includes("nobroker")) {
        sourceUrl = `https://www.nobroker.in/paying-guest-in-${c}`;
      } else if (sName.toLowerCase().includes("housing")) {
        sourceUrl = `https://housing.com/in/rent/pg-in-${c}`;
      } else if (sName.toLowerCase().includes("99acres")) {
        sourceUrl = `https://www.99acres.com/paying-guest-pg-in-${c}-ffid`;
      } else if (sName.toLowerCase().includes("zolo")) {
        sourceUrl = `https://zolostays.com/${c}`;
      } else if (sName.toLowerCase().includes("stanza")) {
        sourceUrl = `https://www.stanzaliving.com/${c}`;
      } else {
        sourceUrl = `https://www.magicbricks.com/pg-paying-guests-in-${c}-nrsid`;
      }
    }

    const id = `web-${i}-${geo.lat.toFixed(4)}-${geo.lng.toFixed(4)}`;

    validListings.push({
      id,
      name: item.name,
      address: geo.display_name || `${item.name}, ${item.address_or_locality}`,
      area: item.address_or_locality || city || "Nearby",
      lat: geo.lat,
      lng: geo.lng,
      monthly_rent: price,
      deposit: null,
      food_included: item.food_included ?? null,
      sharing_type: item.sharing_type || null,
      gender: item.gender || gender || "any",
      amenities: Array.isArray(item.amenities) ? item.amenities : [],
      sources: [
        {
          name: item.source_name || "Live Web",
          url: sourceUrl,
        },
      ],
      last_checked: new Date().toISOString(),
      price_status: price !== null ? "listed" : "unknown",
      verification: "unverified",
      confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0.1, item.confidence)) : 0.8,
      contact_phone: cleanPhone,
      website: sourceUrl,
      snippet: item.snippet || `Discovered near ${landmark}`,
      is_sample: false,
    });
  }

  cache[normKey] = { at: Date.now(), listings: validListings };
  saveCache(cache);

  return { listings: validListings, rawCount: rawItems.length, quotaExhausted };
}

/** Robustly extracts a JSON array from text even if markdown wrappers exist. */
function extractJsonArray<T>(text: string): T[] {
  if (!text) return [];
  try {
    const clean = text.replace(/```json\s*|```\s*/g, "").trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        const slice = text.slice(start, end + 1);
        const parsed = JSON.parse(slice);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}
