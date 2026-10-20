/**
 * Brokerage integration helper for Indian property and PG portals:
 * MagicBricks, NoBroker, Housing.com, 99acres, ZoloStays, Stanza Living, Justdial, Sulekha.
 */
import "server-only";

export interface BrokeragePortalLink {
  name: string;
  url: string;
  badge: string;
  color: string;
  tagline: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getBrokeragePortalLinks(
  landmark: string = "Andheri",
  city: string = "Mumbai",
  gender: string = "any"
): BrokeragePortalLink[] {
  const cleanLandmark = landmark.replace(/station|college|metro|railway/gi, "").trim() || landmark;
  const locSlug = slug(cleanLandmark);
  const citySlug = slug(city);

  return [
    {
      name: "MagicBricks",
      url: `https://www.magicbricks.com/pg-paying-guests-in-${locSlug}-${citySlug}-nrsid`,
      badge: "🏢 MagicBricks",
      color: "#D8232A",
      tagline: "Over 500+ verified PG listings with photo & food details",
    },
    {
      name: "NoBroker",
      url: `https://www.nobroker.in/paying-guest-in-${locSlug}-${citySlug}`,
      badge: "🏠 NoBroker",
      color: "#009587",
      tagline: "Zero brokerage, direct owner contact & verified listings",
    },
    {
      name: "Housing.com",
      url: `https://housing.com/in/rent/pg-in-${locSlug}-${citySlug}`,
      badge: "🏘️ Housing.com",
      color: "#5B21B6",
      tagline: "Verified amenities, security ratings, and student filters",
    },
    {
      name: "99acres",
      url: `https://www.99acres.com/pg-near-${locSlug}-${citySlug}-ffid`,
      badge: "📍 99acres",
      color: "#0066CC",
      tagline: "Nearby transit hubs, colleges & price comparisons",
    },
    {
      name: "ZoloStays",
      url: `https://zolostays.com/${citySlug}/${locSlug}`,
      badge: "⚡ Zolo Stays",
      color: "#7C3AED",
      tagline: "Professionally managed co-living with meals & housekeeping",
    },
    {
      name: "Stanza Living",
      url: `https://www.stanzaliving.com/${citySlug}`,
      badge: "🛋️ Stanza Living",
      color: "#EA580C",
      tagline: "Premium student residences with chef meals & smart security",
    },
  ];
}
