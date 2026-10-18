/**
 * Shared types used by the server-side agent and the client UI.
 */

export type Sharing = "single" | "double" | "triple";
export type Gender = "boys" | "girls" | "any";

/** A PG listing as stored in data/listings.json (all SAMPLE data). */
export interface Listing {
  id: string;
  name: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  monthly_rent: number;
  deposit: number;
  food_included: boolean;
  sharing_type: Sharing;
  gender: Gender;
  amenities: string[];
  rating: number;
  review_snippets: string[];
  available_from: string; // YYYY-MM-DD
  extra_charges: { electricity: number; maintenance: number };
  owner_name: string;
  owner_phone: string;
  photos: string[];
  is_sample: boolean;
}

/** Listing enriched with search-time info. */
export interface ListingHit extends Listing {
  distance_m: number;
  /** "match" = inside radius & budget; "stretch" = slightly over budget; "outside" = slightly outside radius */
  fit: "match" | "stretch" | "outside";
}

/** A place returned by OpenStreetMap Overpass (no price data, unverified). */
export interface OsmPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface Preferences {
  gender: Gender;
  sharing: Sharing | "any";
  food: "required" | "not_needed" | "any";
  amenities: string[];
}

/** Output of the parse_request tool. */
export interface ParsedRequest {
  landmark: string | null;
  city_hint: string | null;
  radius_m: number;
  min_budget: number | null;
  max_budget: number | null;
  deadline_date: string | null; // YYYY-MM-DD
  sort_preference: "best" | "cheapest" | "closest";
  preferences: Preferences;
  assumptions: string[];
  clarification_question: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  display_name: string;
  source: "curated" | "cache" | "nominatim";
}

export interface RankedListing {
  rank: number;
  listing: ListingHit;
  score: number; // 0..100
  effective_monthly_cost: number;
  walk_minutes: number;
  why: string;
  red_flags: string[];
  breakdown: Record<string, number>;
}

export interface OwnerReply {
  listing_id: string;
  simulated: true;
  message_sent: string;
  reply: string;
  available_by_deadline: boolean;
  confirmed_rent: number;
  visit_slots: string[]; // ISO datetimes (local, no TZ)
  wa_link: string;
}

export interface VisitPlan {
  listing_id: string;
  datetime: string;
  ics_url: string;
  gcal_url: string;
}

/** Client → server body for /api/agent */
export interface AgentRequestBody {
  text: string;
  /** Values the user edited on the parameter chips; they override the parser. */
  overrides?: Partial<Pick<ParsedRequest, "landmark" | "radius_m" | "max_budget" | "deadline_date">>;
  /** If true the agent must NOT relax constraints (user rejected a relaxation). */
  strict?: boolean;
}

/** Events streamed over SSE from /api/agent to the UI. */
export type AgentEvent =
  | { type: "step"; id: string; status: "running" | "done" | "error"; label: string; tool?: string; input?: unknown; output?: unknown }
  | { type: "thought"; text: string }
  | { type: "params"; params: ParsedRequest }
  | { type: "location"; point: GeoPoint; radius_m: number }
  | { type: "listings"; hits: ListingHit[]; osm: OsmPlace[]; radius_m: number; center: { lat: number; lng: number } }
  | { type: "relaxation"; kind: "radius" | "budget"; from: number; to: number; message: string }
  | { type: "ranked"; results: RankedListing[] }
  | { type: "owner_reply"; reply: OwnerReply }
  | { type: "visit"; plan: VisitPlan }
  | { type: "clarify"; question: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };
