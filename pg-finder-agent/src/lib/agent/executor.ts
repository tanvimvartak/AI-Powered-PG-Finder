/**
 * Tool implementations executed server-side when Gemini returns a functionCall.
 * Emits UI events and reports real source metrics to the activity timeline.
 */
import "server-only";
import { geocode } from "../geo";
import { googleCalendarUrl, whatsappLink } from "../ics";
import { getListing, searchListings } from "../listings";
import { rankListings } from "../rank";
import type {
  AgentEvent,
  AgentRequestBody,
  EnquiryDraft,
  GeoPoint,
  ListingHit,
  OsmPlace,
  ParsedRequest,
  Preferences,
  RankedListing,
  SourceStats,
} from "../types";
import { DEFAULT_PREFS, parseRequest } from "./parser";

export interface AgentSession {
  body: AgentRequestBody;
  parsed?: ParsedRequest;
  point?: GeoPoint;
  lastSearch?: { hits: ListingHit[]; radius_m: number; max_price: number | null; stats: SourceStats };
  ranked?: RankedListing[];
  drafts: Record<string, EnquiryDraft>;
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
      return `Locating ${args.place_name || "target area"}...`;
    case "search_listings":
      return `Searching live sources within ${km(Number(args.radius_m))}${args.max_price ? ` under ${inr(Number(args.max_price))}` : ""}...`;
    case "rank_listings":
      return "Ranking verified & unverified options by distance & suitability...";
    case "draft_enquiry": {
      const l = getListing(String(args.listing_id));
      return `Drafting enquiry for ${l?.name ?? args.listing_id}...`;
    }
    case "contact_owner": {
      const l = getListing(String(args.listing_id));
      return `Drafting enquiry for ${l?.name ?? args.listing_id}...`;
    }
    case "schedule_visit":
      return "Creating proposed calendar visit...";
    default:
      return `Running ${name}...`;
  }
}

export async function executeTool(
  name: string,
  args: Args,
  s: AgentSession
): Promise<{ result: Record<string, unknown>; summary: string }> {
  switch (name) {
    // ───────────────────────── parse_request ─────────────────────────
    case "parse_request": {
      const { parsed, via } = await parseRequest(s.body.text, s.body.overrides);
      s.parsed = parsed;
      s.emit({ type: "params", params: parsed });
      if (parsed.clarification_question) {
        s.emit({ type: "clarify", question: parsed.clarification_question });
      }
      const bits = [
        parsed.landmark && `near ${parsed.landmark}`,
        `within ${km(parsed.radius_m)}`,
        parsed.max_budget && `under ${inr(parsed.max_budget)}`,
        parsed.deadline_date && `by ${parsed.deadline_date}`,
      ].filter(Boolean);
      return { result: { ...parsed, parsed_with: via }, summary: `Looking for a PG ${bits.join(", ")}` };
    }

    // ───────────────────────── geocode ─────────────────────────
    case "geocode": {
      const place = String(args.place_name || s.parsed?.landmark || "");
      const point = await geocode(place, (args.city_hint as string) || s.parsed?.city_hint);
      if (!point) {
        return {
          result: { error: `Could not find "${place}". Try a simpler or alternative landmark.` },
          summary: `Couldn't locate "${place}"`,
        };
      }
      s.point = point;
      s.emit({ type: "location", point, radius_m: s.parsed?.radius_m ?? 1000 });
      return {
        result: { lat: point.lat, lng: point.lng, display_name: point.display_name, source: point.source },
        summary: `Found ${point.display_name.split(",").slice(0, 2).join(",")}`,
      };
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

      // Guard: strict mode does not allow auto-relaxation
      if (s.body.strict && orig) {
        radius = Math.min(radius, orig.radius_m);
        if (orig.max_budget) maxPrice = Math.min(maxPrice ?? orig.max_budget, orig.max_budget);
      }

      // Relaxation tracking
      if (orig) {
        const prevR = s.relaxations.filter((r) => r.kind === "radius").at(-1)?.to ?? orig.radius_m;
        if (radius > prevR) {
          s.relaxations.push({ kind: "radius", from: prevR, to: radius });
          s.emit({
            type: "relaxation",
            kind: "radius",
            from: orig.radius_m,
            to: radius,
            message: `Expanding search radius from ${km(prevR)} to ${km(radius)} to find real listings.`,
          });
        }
        const prevB = s.relaxations.filter((r) => r.kind === "budget").at(-1)?.to ?? orig.max_budget;
        if (prevB && maxPrice && maxPrice > prevB) {
          s.relaxations.push({ kind: "budget", from: prevB, to: maxPrice });
          s.emit({
            type: "relaxation",
            kind: "budget",
            from: orig.max_budget!,
            to: maxPrice,
            message: `Raising budget from ${inr(prevB)} to ${inr(maxPrice)}.`,
          });
        }
      }

      // Multi-source live search execution
      const { hits, stats } = await searchListings({
        lat,
        lng,
        radius_m: radius,
        min_price: minPrice,
        max_price: maxPrice,
        gender,
        landmark: (args.landmark as string) || s.parsed?.landmark,
        city: (args.city as string) || s.parsed?.city_hint,
      });

      s.lastSearch = { hits, radius_m: radius, max_price: maxPrice, stats };
      s.emit({ type: "source_stats", stats });
      s.emit({
        type: "listings",
        hits,
        osm: [],
        radius_m: radius,
        center: { lat, lng },
        stats,
      });

      const strict = hits.filter((h) => h.fit === "match");
      const knownPrices = hits.filter((h) => h.price_status === "listed");
      const unknownPrices = hits.filter((h) => h.price_status === "unknown");

      let relaxation_hint: string | null = null;
      if (strict.length === 0 && !s.body.strict) {
        const radiusSteps = s.relaxations.filter((r) => r.kind === "radius").length;
        if (radiusSteps < 2 && radius < 8000) {
          relaxation_hint = `Relax radius: call search_listings again with radius_m=${Math.min(Math.round(radius * 1.5), 8000)}.`;
        } else {
          relaxation_hint = "No exact matches within radius; present real discovered places or suggest widening search.";
        }
      }

      return {
        result: {
          radius_m: radius,
          max_price: maxPrice,
          total_found: hits.length,
          known_price_matches: knownPrices.length,
          unknown_price_listings: unknownPrices.length,
          sources: stats,
          listings: hits.slice(0, 15).map((h) => ({
            id: h.id,
            name: h.name,
            rent: h.monthly_rent,
            price_status: h.price_status,
            distance_m: h.distance_m,
            sources: (h.sources || []).map((src) => src.name),
            contact_phone: h.contact_phone || null,
          })),
          relaxation_hint,
        },
        summary: `OSM: ${stats.osm}, Geoapify: ${stats.geoapify}, Web: ${stats.web}, merged to ${stats.merged}`,
      };
    }

    // ───────────────────────── rank_listings ─────────────────────────
    case "rank_listings": {
      if (!s.lastSearch) {
        return { result: { error: "Call search_listings first." }, summary: "No search results to rank" };
      }
      let hits = s.lastSearch.hits;
      const ids = args.listing_ids as string[] | undefined;
      if (ids?.length) hits = hits.filter((h) => ids.includes(h.id));
      if (!hits.length) {
        return { result: { ranked: [], note: "No listings to rank." }, summary: "Nothing to rank" };
      }

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

      const topMatches = ranked.filter((r) => r.group === "top_match");
      const worthAsking = ranked.filter((r) => r.group === "worth_asking");

      return {
        result: {
          top_matches_count: topMatches.length,
          worth_asking_count: worthAsking.length,
          top: ranked.map((r) => ({
            rank: r.rank,
            id: r.listing.id,
            name: r.listing.name,
            group: r.group,
            price_status: r.listing.price_status,
            rent: r.listing.monthly_rent,
            distance_m: r.listing.distance_m,
            sources: (r.listing.sources || []).map((src) => src.name),
            why: r.why,
          })),
        },
        summary: `Ranked ${topMatches.length} with listed price, ${worthAsking.length} worth asking about`,
      };
    }

    // ───────────────────────── draft_enquiry (formerly contact_owner) ─────────────────────────
    case "draft_enquiry":
    case "contact_owner": {
      const listingId = String(args.listing_id);
      const l = getListing(listingId);
      if (!l) {
        return { result: { error: `Unknown listing_id: ${listingId}` }, summary: "Unknown listing" };
      }

      const p = s.parsed;
      const moveIn = (args.move_in_date as string) || p?.deadline_date || "this week";
      const budget = (args.budget as number) || p?.max_budget;
      const sharing = (args.sharing_preference as string) || (p?.preferences.sharing !== "any" ? p?.preferences.sharing : "a");
      const gender = (args.gender as string) || (p?.preferences.gender !== "any" ? p?.preferences.gender : "");

      const sourceName = l.sources[0]?.name || "public listings";
      const message =
        `Hi, I found your PG/hostel listing for "${l.name}" via ${sourceName}. ` +
        `I am looking for ${sharing ? `${sharing} sharing ` : ""}accommodation${gender ? ` for ${gender}` : ""} ` +
        `with move-in around ${moveIn}${budget ? `, with my budget around Rs ${budget}/month` : ""}. ` +
        `Could you please let me know if a bed is currently available and what the monthly rent/deposit is? Thank you!`;

      // Phone handling
      let waLink: string | null = null;
      let telLink: string | null = null;
      let cleanPhone = l.contact_phone ? l.contact_phone.replace(/[^0-9]/g, "") : null;

      if (cleanPhone) {
        if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
        waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
        telLink = `tel:+${cleanPhone}`;
      }

      const draft: EnquiryDraft = {
        listing_id: l.id,
        listing_name: l.name,
        message,
        wa_link: waLink,
        tel_link: telLink,
        copy_text: message,
        phone: l.contact_phone || null,
        source_url: l.sources[0]?.url || l.website || null,
      };

      s.drafts[l.id] = draft;
      s.emit({ type: "enquiry_draft", draft });

      return {
        result: {
          draft_message: draft.message,
          has_phone: !!draft.phone,
          wa_link: draft.wa_link,
          tel_link: draft.tel_link,
          source_url: draft.source_url,
          note: "Agent drafted it. You send it.",
        },
        summary: `Drafted enquiry for ${l.name} (Agent drafted it. You send it.)`,
      };
    }

    // ───────────────────────── schedule_visit ─────────────────────────
    case "schedule_visit": {
      const l = getListing(String(args.listing_id));
      if (!l) {
        return { result: { error: "Unknown listing_id" }, summary: "Unknown listing" };
      }
      const dt = String(args.datetime).slice(0, 16);
      const plan = {
        listing_id: l.id,
        datetime: dt,
        ics_url: `/api/visit?listing_id=${l.id}&datetime=${encodeURIComponent(dt)}`,
        gcal_url: googleCalendarUrl(l, dt),
        status: "proposed_unconfirmed" as const,
      };
      s.emit({ type: "visit", plan });
      return {
        result: { ...plan, note: "Proposed visit time, not confirmed by owner." },
        summary: `Proposed visit at ${l.name} on ${dt.replace("T", " ")} (unconfirmed with owner)`,
      };
    }
  }

  return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}` };
}
