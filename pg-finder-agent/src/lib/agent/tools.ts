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
          "Find PG listings within radius_m of (lat,lng) from the local SAMPLE database using the Haversine formula, plus hostels/guest houses from OpenStreetMap Overpass as a supplement. Returns strict matches and labelled near-misses, plus a relaxation_hint when nothing matches.",
        parameters: S("OBJECT", undefined, {
          properties: {
            lat: S("NUMBER"),
            lng: S("NUMBER"),
            radius_m: S("INTEGER", "Search radius in metres"),
            min_price: S("INTEGER", "Minimum monthly rent in Rs", { nullable: true }),
            max_price: S("INTEGER", "Maximum monthly rent in Rs, null for no cap", { nullable: true }),
            gender: S("STRING", "boys / girls / any", { enum: ["boys", "girls", "any"] }),
          },
          required: ["lat", "lng", "radius_m"],
        }),
      },
      {
        name: "rank_listings",
        description:
          "Score listings from the most recent search_listings call using weighted factors (price vs budget incl. hidden costs, distance, amenities, reviews, availability by deadline). Returns the top 5 with 'why' and red flags. Pass listing_ids to restrict, or omit to rank all results of the latest search.",
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
        name: "contact_owner",
        description: "Send a message to the PG owner (SIMULATED: another AI role-plays the owner). Returns the simulated reply, availability, confirmed rent, visit slots and a real wa.me click-to-chat link.",
        parameters: S("OBJECT", undefined, {
          properties: { listing_id: S("STRING"), message: S("STRING", "Polite message to the owner") },
          required: ["listing_id", "message"],
        }),
      },
      {
        name: "schedule_visit",
        description: "Create a visit: returns a downloadable .ics calendar file URL and a Google Calendar add-event URL. Only call if the student explicitly gave a time.",
        parameters: S("OBJECT", undefined, {
          properties: { listing_id: S("STRING"), datetime: S("STRING", "Local IST time 'YYYY-MM-DDTHH:MM'") },
          required: ["listing_id", "datetime"],
        }),
      },
    ],
  },
];
