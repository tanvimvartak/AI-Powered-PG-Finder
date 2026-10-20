/**
 * Gemini function declarations for the agent's tools.
 * Types follow the OpenAPI subset used by the Gemini API.
 */
const S = (type: string, description?: string, extra: Record<string, unknown> = {}) => ({ type, ...(description ? { description } : {}), ...extra });

const PREFS = S("OBJECT", "Preferences from parse_request", {
  properties: {
    gender: S("STRING", undefined, { enum: ["boys", "girls", "any"] }),
    sharing: S("STRING", undefined, { enum: ["single", "double", "triple", "any"] }),
    food: S("STRING", undefined, { enum: ["required", "not_needed", "any"] }),
    amenities: S("ARRAY", undefined, { items: S("STRING") }),
  },
});

export const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: "parse_request",
        description: "Extract structured search parameters (landmark, radius, budget, deadline, preferences, assumptions) from the student's sentence. Always call first.",
        parameters: S("OBJECT", undefined, { properties: { text: S("STRING", "The student's original sentence") }, required: ["text"] }),
      },
      {
        name: "geocode",
        description: "Convert a place name to coordinates using OpenStreetMap Nominatim (with a curated fallback for common landmarks).",
        parameters: S("OBJECT", undefined, {
          properties: { place_name: S("STRING", "e.g. 'Mithibai College'"), city_hint: S("STRING", "e.g. 'Mumbai'", { nullable: true }) },
          required: ["place_name"],
        }),
      },
      {
        name: "search_listings",
        description:
          "Find real PG, hostel, and student accommodation listings within radius_m of (lat,lng) using live public sources (OpenStreetMap Overpass, Geoapify, and Live Web Discovery). Returns real places with sources, price_status ('listed' or 'unknown'), and distance.",
        parameters: S("OBJECT", undefined, {
          properties: {
            lat: S("NUMBER"),
            lng: S("NUMBER"),
            radius_m: S("INTEGER", "Search radius in metres"),
            min_price: S("INTEGER", "Minimum monthly rent in Rs", { nullable: true }),
            max_price: S("INTEGER", "Maximum monthly rent in Rs, null for no cap", { nullable: true }),
            gender: S("STRING", "boys / girls / any", { enum: ["boys", "girls", "any"] }),
            landmark: S("STRING", "Name of landmark for web discovery context", { nullable: true }),
            city: S("STRING", "City name hint", { nullable: true }),
          },
          required: ["lat", "lng", "radius_m"],
        }),
      },
      {
        name: "rank_listings",
        description:
          "Rank real listings into 'top_match' (known price within budget) and 'worth_asking' (price unknown, contact owner) groups. Never excludes unknown price listings. Returns ranked places with 'why' and distance/walk time.",
        parameters: S("OBJECT", undefined, {
          properties: {
            listing_ids: S("ARRAY", "Optional subset of listing ids", { items: S("STRING") }),
            preferences: PREFS,
            deadline_date: S("STRING", "YYYY-MM-DD", { nullable: true }),
            max_budget: S("INTEGER", "Budget used for scoring (Rs)", { nullable: true }),
            radius_m: S("INTEGER", "Radius actually used in the search"),
            sort_preference: S("STRING", undefined, { enum: ["best", "cheapest", "closest"] }),
          },
          required: ["radius_m"],
        }),
      },
      {
        name: "draft_enquiry",
        description:
          "Draft a personalized enquiry message for the student to send to the PG/hostel owner. Returns a message, real wa.me link (if phone exists), tel: link, copy text, and source URL. The student sends it themselves ('Agent drafted it. You send it.').",
        parameters: S("OBJECT", undefined, {
          properties: {
            listing_id: S("STRING", "ID of the listing"),
            move_in_date: S("STRING", "Target move-in date YYYY-MM-DD", { nullable: true }),
            budget: S("INTEGER", "Monthly budget in INR", { nullable: true }),
            sharing_preference: S("STRING", "single/double/triple/any", { nullable: true }),
            gender: S("STRING", "boys/girls/any", { nullable: true }),
          },
          required: ["listing_id"],
        }),
      },
      {
        name: "schedule_visit",
        description:
          "Create a proposed visit: returns a downloadable .ics calendar file URL and a Google Calendar add-event URL (proposed, not confirmed by owner). Only call if the student explicitly gave a time.",
        parameters: S("OBJECT", undefined, {
          properties: { listing_id: S("STRING"), datetime: S("STRING", "Local IST time 'YYYY-MM-DDTHH:MM'") },
          required: ["listing_id", "datetime"],
        }),
      },
    ],
  },
];
