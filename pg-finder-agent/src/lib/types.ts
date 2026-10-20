/**
 * Shared types used by the server-side agent and the client UI.
 */

export type Sharing = "single" | "double" | "triple";
export type Gender = "boys" | "girls" | "any";

export interface ListingSource {
  name: string; // e.g. "OpenStreetMap", "Geoapify", "MagicBricks", "Housing.com", "Google Maps"
  url: string;  // Direct URL to listing or source page
}

/** A PG / student accommodation listing (real or demo). */
export interface Listing {
  id: string;
  name: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  /** Null if not stated by public source; never invent a price */
  monthly_rent: number | null;
  deposit: number | null;
  food_included: boolean | null;
  sharing_type: Sharing | null;
  gender: Gender;
  amenities: string[];
  sources: ListingSource[];
  last_checked: string;
  price_status: "listed" | "unknown";
  verification: "unverified" | "verified";
  confidence: number;
  contact_phone?: string | null;
  website?: string | null;
  snippet?: string | null;
  is_sample?: boolean;
  /** Legacy demo fields (only present if is_sample === true) */
  rating?: number;
  review_snippets?: string[];
  available_from?: string;
  extra_charges?: { electricity: number; maintenance: number };
  owner_name?: string;
  owner_phone?: string;
  photos?: string[];
}

/** Listing enriched with search-time info. */
export interface ListingHit extends Listing {
  distance_m: number;
  /** "match" = inside radius & budget (or unknown price inside radius); "stretch" = slightly over budget; "outside" = slightly outside radius */
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
  phone?: string | null;
  website?: string | null;
  osm_url?: string;
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
  effective_monthly_cost: number | null;
  walk_minutes: number;
  why: string;
  red_flags: string[];
  breakdown: Record<string, number>;
  group: "top_match" | "worth_asking";
}

/** Pre-drafted enquiry student sends themselves. */
export interface EnquiryDraft {
  listing_id: string;
  listing_name: string;
  message: string;
  wa_link: string | null;
  tel_link: string | null;
  copy_text: string;
  phone: string | null;
  source_url: string | null;
}

/** Simulated owner reply kept only for DEMO_MODE. */
export interface OwnerReply {
  listing_id: string;
  simulated: true;
  message_sent: string;
  reply: string;
  available_by_deadline: boolean;
  confirmed_rent: number;
  visit_slots: string[];
  wa_link: string;
}

export interface VisitPlan {
  listing_id: string;
  datetime: string;
  ics_url: string;
  gcal_url: string;
  status: "proposed_unconfirmed";
}

export interface SourceStats {
  osm: number;
  geoapify: number;
  web: number;
  merged: number;
}

/** Client → server body for /api/agent */
export interface AgentRequestBody {
  text: string;
  overrides?: Partial<Pick<ParsedRequest, "landmark" | "radius_m" | "max_budget" | "deadline_date">>;
  strict?: boolean;
}

/** Events streamed over SSE from /api/agent to the UI. */
export type AgentEvent =
  | { type: "step"; id: string; status: "running" | "done" | "error"; label: string; tool?: string; input?: unknown; output?: unknown }
  | { type: "thought"; text: string }
  | { type: "params"; params: ParsedRequest }
  | { type: "location"; point: GeoPoint; radius_m: number }
  | { type: "source_stats"; stats: SourceStats }
  | { type: "listings"; hits: ListingHit[]; osm: OsmPlace[]; radius_m: number; center: { lat: number; lng: number }; stats?: SourceStats }
  | { type: "relaxation"; kind: "radius" | "budget"; from: number; to: number; message: string }
  | { type: "ranked"; results: RankedListing[]; worth_asking?: RankedListing[] }
  | { type: "enquiry_draft"; draft: EnquiryDraft }
  | { type: "owner_reply"; reply: OwnerReply }
  | { type: "visit"; plan: VisitPlan }
  | { type: "clarify"; question: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

