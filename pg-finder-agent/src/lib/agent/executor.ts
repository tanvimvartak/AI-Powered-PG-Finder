/**
 * Tool implementations executed server-side when Gemini returns a functionCall.
 * Each tool emits UI events (map pins, ranked cards, owner replies) via `emit`
 * and returns a COMPACT result to the model (to save tokens on the free tier).
 */
import "server-only";
import { generateJson } from "../gemini";
import { geocode, overpassHostels } from "../geo";
import { googleCalendarUrl, whatsappLink } from "../ics";
import { countInRadius, getListing, searchListings } from "../listings";
import { rankListings } from "../rank";
import type { AgentEvent, AgentRequestBody, GeoPoint, ListingHit, OsmPlace, OwnerReply, ParsedRequest, Preferences, RankedListing } from "../types";
import { addDays, DEFAULT_PREFS, isoDate, parseRequest, todayIST } from "./parser";
import { OWNER_ROLEPLAY_PROMPT } from "./systemPrompt";

export interface AgentSession {
  body: AgentRequestBody;
  parsed?: ParsedRequest;
  point?: GeoPoint;
  lastSearch?: { hits: ListingHit[]; osm: OsmPlace[]; radius_m: number; max_price: number | null };
  ranked?: RankedListing[];
  replies: Record<string, OwnerReply>;
  /** Owner replies computed in one batched LLM call for parallel contact_owner calls. */
  prefetchedReplies?: Record<string, OwnerReply>;
  relaxations: { kind: "radius" | "budget"; from: number; to: number }[];
  emit: (e: AgentEvent) => void;
}

type Args = Record<string, unknown>;
const inr = (n: number) => "Rs " + n.toLocaleString("en-IN");
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`);

/** Plain-language labels for the activity timeline. */
export function stepLabel(name: string, args: Args): string {
  switch (name) {
    case "parse_request":
      return "Understanding your request...";
    case "geocode":
      return `Locating ${args.place_name}...`;
    case "search_listings":
      return `Searching PGs within ${km(Number(args.radius_m))}${args.max_price ? ` under ${inr(Number(args.max_price))}` : ""}...`;
    case "rank_listings":
      return "Ranking options by price, distance, reviews & hidden costs...";
    case "contact_owner": {
      const l = getListing(String(args.listing_id));
      return `Messaging owner of ${l?.name ?? args.listing_id}...`;
    }
    case "schedule_visit":
      return "Scheduling a visit...";
    default:
      return `Running ${name}...`;
  }
}

export async function executeTool(name: string, args: Args, s: AgentSession): Promise<{ result: Record<string, unknown>; summary: string }> {
  switch (name) {
    // ───────────────────────── parse_request ─────────────────────────
    case "parse_request": {
      // Always parse the user's ORIGINAL text (the model may paraphrase).
      const { parsed, via } = await parseRequest(s.body.text, s.body.overrides);
      s.parsed = parsed;
      s.emit({ type: "params", params: parsed });
      if (parsed.clarification_question) s.emit({ type: "clarify", question: parsed.clarification_question });
      const bits = [parsed.landmark && `near ${parsed.landmark}`, `within ${km(parsed.radius_m)}`, parsed.max_budget && `under ${inr(parsed.max_budget)}`, parsed.deadline_date && `by ${parsed.deadline_date}`].filter(Boolean);
      return { result: { ...parsed, parsed_with: via }, summary: `Looking for a PG ${bits.join(", ")}` };
    }

    // ───────────────────────── geocode ─────────────────────────
    case "geocode": {
      const place = String(args.place_name || s.parsed?.landmark || "");
      const point = await geocode(place, (args.city_hint as string) || s.parsed?.city_hint);
      if (!point) return { result: { error: `Could not find "${place}". Try a simpler or alternative name.` }, summary: `Couldn't locate "${place}"` };
      s.point = point;
      s.emit({ type: "location", point, radius_m: s.parsed?.radius_m ?? 1000 });
      return { result: { lat: point.lat, lng: point.lng, display_name: point.display_name, source: point.source }, summary: `Found ${point.display_name.split(",").slice(0, 2).join(",")} (${point.source})` };
    }

    // ───────────────────────── search_listings ─────────────────────────
    case "search_listings": {
      const lat = Number(args.lat ?? s.point?.lat);
      const lng = Number(args.lng ?? s.point?.lng);
      let radius = Math.round(Number(args.radius_m) || s.parsed?.radius_m || 1000);
      let maxPrice = args.max_price == null ? null : Number(args.max_price);
      const minPrice = args.min_price == null ? null : Number(args.min_price);
      const gender = (args.gender as Preferences["gender"]) || s.parsed?.preferences.gender || "any";
      const orig = s.parsed;

      // Guard: in strict mode the model is not allowed to widen constraints.
      if (s.body.strict && orig) {
        radius = Math.min(radius, orig.radius_m);
        if (orig.max_budget) maxPrice = Math.min(maxPrice ?? orig.max_budget, orig.max_budget);
      }

      // Detect & announce relaxation vs. the user's original request.
      if (orig) {
        const prevR = s.relaxations.filter((r) => r.kind === "radius").at(-1)?.to ?? orig.radius_m;
        if (radius > prevR) {
          s.relaxations.push({ kind: "radius", from: prevR, to: radius });
          s.emit({ type: "relaxation", kind: "radius", from: orig.radius_m, to: radius, message: `Nothing matched${orig.max_budget ? ` under ${inr(orig.max_budget)}` : ""} within ${km(prevR)}, so I expanded the search to ${km(radius)}.` });
        }
        const prevB = s.relaxations.filter((r) => r.kind === "budget").at(-1)?.to ?? orig.max_budget;
        if (prevB && maxPrice && maxPrice > prevB) {
          s.relaxations.push({ kind: "budget", from: prevB, to: maxPrice });
          s.emit({ type: "relaxation", kind: "budget", from: orig.max_budget!, to: maxPrice, message: `Still nothing within ${inr(prevB)} even at ${km(radius)}, so I raised the budget to ${inr(maxPrice)}.` });
        }
      }

      const hits = searchListings({ lat, lng, radius_m: radius, min_price: minPrice, max_price: maxPrice, gender });
      const osm = await overpassHostels(lat, lng, radius);
      s.lastSearch = { hits, osm: osm.places, radius_m: radius, max_price: maxPrice };
      s.emit({ type: "listings", hits, osm: osm.places, radius_m: radius, center: { lat, lng } });

      const strict = hits.filter((h) => h.fit === "match");
      const total = countInRadius(lat, lng, radius);
      let relaxation_hint: string | null = null;
      if (strict.length === 0 && !s.body.strict) {
        const radiusSteps = s.relaxations.filter((r) => r.kind === "radius").length;
        const budgetSteps = s.relaxations.filter((r) => r.kind === "budget").length;
        if (radiusSteps < 2 && radius < 8000) relaxation_hint = `Relax radius: call search_listings again with radius_m=${Math.min(Math.round(radius * 1.5), 8000)} (same budget).`;
        else if (budgetSteps < 1 && maxPrice) relaxation_hint = `Relax budget: call search_listings again with max_price=${Math.round((maxPrice * 1.15) / 100) * 100} (same radius ${radius}).`;
        else relaxation_hint = "Relaxation limit reached. Rank whatever near-misses exist (if any) and explain honestly.";
      }

      return {
        result: {
          radius_m: radius,
          max_price: maxPrice,
          total_pgs_in_radius: total,
          strict_matches: strict.length,
          near_misses: hits.length - strict.length,
          listings: hits.slice(0, 15).map((h) => ({ id: h.id, name: h.name, rent: h.monthly_rent, distance_m: h.distance_m, fit: h.fit, food: h.food_included, rating: h.rating, available_from: h.available_from, deposit: h.deposit })),
          osm_hostels_found: osm.places.length,
          osm_note: osm.error ? `Overpass unavailable (${osm.error})` : "OSM places have no price data and are shown as grey pins only.",
          data_note: "Local listings are SAMPLE DATA.",
          relaxation_hint,
        },
        summary: `Found ${total} PGs within ${km(radius)}, ${strict.length} within budget${hits.length - strict.length ? ` (+${hits.length - strict.length} near misses)` : ""}${osm.places.length ? `, ${osm.places.length} more hostels on OSM` : ""}`,
      };
    }

    // ───────────────────────── rank_listings ─────────────────────────
    case "rank_listings": {
      if (!s.lastSearch) return { result: { error: "Call search_listings first." }, summary: "No search results to rank" };
      let hits = s.lastSearch.hits;
      const ids = args.listing_ids as string[] | undefined;
      if (ids?.length) hits = hits.filter((h) => ids.includes(h.id));
      if (!hits.length) return { result: { ranked: [], note: "No listings to rank." }, summary: "Nothing to rank" };
      const p = s.parsed;
      const ranked = rankListings({
        hits,
        preferences: { ...DEFAULT_PREFS, ...(p?.preferences ?? {}), ...((args.preferences as Preferences) ?? {}) },
        deadline_date: (args.deadline_date as string) ?? p?.deadline_date ?? null,
        max_budget: (args.max_budget as number) ?? s.lastSearch.max_price ?? p?.max_budget ?? null,
        radius_m: Number(args.radius_m) || s.lastSearch.radius_m,
        sort_preference: (args.sort_preference as "best") ?? p?.sort_preference,
      });
      s.ranked = ranked;
      s.emit({ type: "ranked", results: ranked });
      return {
        result: {
          top: ranked.map((r) => ({ rank: r.rank, id: r.listing.id, name: r.listing.name, score: r.score, rent: r.listing.monthly_rent, real_monthly_cost: r.effective_monthly_cost, distance_m: r.listing.distance_m, why: r.why, red_flags: r.red_flags })),
        },
        summary: `Top pick: ${ranked[0].listing.name} (score ${ranked[0].score})`,
      };
    }

    // ───────────────────────── contact_owner (SIMULATED) ─────────────────────────
    case "contact_owner": {
      const l = getListing(String(args.listing_id));
      if (!l) return { result: { error: "Unknown listing_id" }, summary: "Unknown listing" };
      const message = String(args.message || `Hi, is a bed available in ${l.name}?`);
      const reply = s.prefetchedReplies?.[l.id] ?? (await simulateOwner(l.id, message, s.parsed));
      s.replies[l.id] = reply;
      s.emit({ type: "owner_reply", reply });
      return {
        result: { simulated: true, reply: reply.reply, available_by_deadline: reply.available_by_deadline, confirmed_rent: reply.confirmed_rent, visit_slots: reply.visit_slots },
        summary: `${l.owner_name} replied (simulated): ${reply.available_by_deadline ? "available" : "not available by your date"}`,
      };
    }

    // ───────────────────────── schedule_visit ─────────────────────────
    case "schedule_visit": {
      const l = getListing(String(args.listing_id));
      if (!l) return { result: { error: "Unknown listing_id" }, summary: "Unknown listing" };
      const dt = String(args.datetime).slice(0, 16);
      const plan = { listing_id: l.id, datetime: dt, ics_url: `/api/visit?listing_id=${l.id}&datetime=${encodeURIComponent(dt)}`, gcal_url: googleCalendarUrl(l, dt) };
      s.emit({ type: "visit", plan });
      return { result: plan, summary: `Visit at ${l.name} on ${dt.replace("T", " ")}` };
    }
  }
  return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}` };
}

/** Fill the owner role-play brief for one listing. */
function ownerBrief(listingId: string): string {
  const l = getListing(listingId)!;
  const extras = [l.extra_charges.electricity && `electricity ~Rs ${l.extra_charges.electricity}/month`, l.extra_charges.maintenance && `maintenance Rs ${l.extra_charges.maintenance}/month`].filter(Boolean).join(", ") || "none";
  return OWNER_ROLEPLAY_PROMPT.replace("{OWNER}", l.owner_name)
    .replace("{NAME}", l.name)
    .replace("{AREA}", l.area)
    .replace("{RENT}", String(l.monthly_rent))
    .replace("{SHARING}", l.sharing_type)
    .replace("{GENDER}", l.gender === "any" ? "boys & girls" : l.gender + " only")
    .replace("{DEPOSIT}", String(l.deposit))
    .replace("{FOOD}", l.food_included ? "included (breakfast + dinner)" : "not included")
    .replace("{EXTRAS}", extras)
    .replace("{AVAILABLE}", l.available_from)
    .replace("{RATING}", String(l.rating))
    .replace("{TODAY}", isoDate(todayIST()));
}

function templateReply(listingId: string, message: string, deadline: string): OwnerReply {
  const l = getListing(listingId)!;
  const today = todayIST();
  const d1 = isoDate(addDays(today, 1));
  const d2 = isoDate(addDays(today, 2));
  const avail = l.available_from <= deadline;
  return {
    listing_id: l.id,
    simulated: true,
    message_sent: message,
    reply: `Hello! ${avail ? "Yes, bed is available" : `Bed will be free only from ${l.available_from}`}. Rent is Rs ${l.monthly_rent}, deposit Rs ${l.deposit}. You can come see the room tomorrow or day after. (auto-generated template reply)`,
    available_by_deadline: avail,
    confirmed_rent: l.monthly_rent,
    visit_slots: [`${d1}T11:00`, `${d1}T17:30`, `${d2}T12:00`],
    wa_link: whatsappLink(l.owner_phone, message),
  };
}

/**
 * Second LLM call: role-play one or more owners in a SINGLE request (saves
 * free-tier quota when the agent contacts 3 owners in parallel).
 * Falls back to templated replies (still labelled simulated) if Gemini fails.
 */
export async function simulateOwners(items: { listingId: string; message: string }[], parsed?: ParsedRequest): Promise<OwnerReply[]> {
  const deadline = parsed?.deadline_date ?? isoDate(addDays(todayIST(), 7));
  const ctx = `The student wants to move in by ${deadline}${parsed?.max_budget ? ` with a budget of Rs ${parsed.max_budget}` : ""}.`;
  const prompt =
    `You will role-play ${items.length} DIFFERENT PG owners. Reply separately as each one, following that owner's brief exactly. ${ctx}\n\n` +
    items.map((it) => `### listing_id: ${it.listingId}\n${ownerBrief(it.listingId)}\n\nStudent's WhatsApp message:\n"""${it.message}"""`).join("\n\n");
  try {
    const out = await generateJson<{ replies: { listing_id: string; reply: string; confirmed_rent: number; visit_slots: string[] }[] }>(prompt, {
      type: "OBJECT",
      properties: {
        replies: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { listing_id: { type: "STRING" }, reply: { type: "STRING" }, confirmed_rent: { type: "INTEGER" }, visit_slots: { type: "ARRAY", items: { type: "STRING" } } },
            required: ["listing_id", "reply", "confirmed_rent", "visit_slots"],
          },
        },
      },
      required: ["replies"],
    });
    return items.map((it) => {
      const r = out.replies.find((x) => x.listing_id === it.listingId);
      const l = getListing(it.listingId)!;
      if (!r) return templateReply(it.listingId, it.message, deadline);
      const slots = (r.visit_slots ?? []).filter((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)).map((v) => v.slice(0, 16));
      return {
        listing_id: l.id,
        simulated: true,
        message_sent: it.message,
        reply: r.reply,
        available_by_deadline: l.available_from <= deadline,
        confirmed_rent: r.confirmed_rent || l.monthly_rent,
        visit_slots: slots.length ? slots.slice(0, 3) : templateReply(l.id, it.message, deadline).visit_slots,
        wa_link: whatsappLink(l.owner_phone, it.message),
      };
    });
  } catch (e) {
    console.warn("[contact_owner] role-play failed, using template:", (e as Error).message);
    return items.map((it) => templateReply(it.listingId, it.message, deadline));
  }
}

export async function simulateOwner(listingId: string, message: string, parsed?: ParsedRequest): Promise<OwnerReply> {
  return (await simulateOwners([{ listingId, message }], parsed))[0];
}
