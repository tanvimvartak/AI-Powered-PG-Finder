/**
 * Seed script: generates SAMPLE PG listings for 5 Mumbai student areas.
 *
 *   npm run seed
 *
 * ⚠️ ALL DATA HERE IS FICTIONAL SAMPLE DATA (is_sample: true).
 * Names, phone numbers and reviews are made up. Coordinates are computed
 * as exact offsets from real landmarks so distance-based demos are precise.
 *
 * `available_from` dates are relative to the day you run the seed, so
 * re-run it (it also runs automatically before `npm run dev`) to keep the
 * "available only after 10 days" style cases meaningful.
 */
import fs from "node:fs";
import path from "node:path";

type Sharing = "single" | "double" | "triple";
type Gender = "boys" | "girls" | "any";

// Real-world anchor points (approximate)
const ANCHORS = {
  mithibai: { lat: 19.1075, lng: 72.8365, area: "Vile Parle West", city: "Mumbai", pin: "400056" },
  andheri: { lat: 19.1197, lng: 72.8464, area: "Andheri", city: "Mumbai", pin: "400058" },
  powai: { lat: 19.1334, lng: 72.9133, area: "Powai", city: "Mumbai", pin: "400076" },
  dadar: { lat: 19.0187, lng: 72.843, area: "Dadar", city: "Mumbai", pin: "400028" },
  thane: { lat: 19.186, lng: 72.9757, area: "Thane West", city: "Thane", pin: "400601" },
} as const;
type AnchorKey = keyof typeof ANCHORS;

/** Move from (lat,lng) by `meters` along `bearingDeg` (spherical approximation). */
function offset(lat: number, lng: number, meters: number, bearingDeg: number) {
  const R = 6371000;
  const d = meters / R;
  const b = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: +((φ2 * 180) / Math.PI).toFixed(6), lng: +((λ2 * 180) / Math.PI).toFixed(6) };
}

function dateIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Spec {
  a: AnchorKey;
  dist: number; // metres from anchor
  brg: number; // bearing degrees
  name: string;
  street: string;
  rent: number;
  deposit: number;
  food: boolean;
  sharing: Sharing;
  gender: Gender;
  amen: string[];
  rating: number;
  reviews: string[];
  avail: number; // available in N days from seed date
  elec?: number; // monthly electricity charged extra (0 = included)
  maint?: number; // monthly maintenance extra
  note?: string; // internal note describing the tricky case
}

const W = ["wifi"];
const specs: Spec[] = [
  // ───────────── Vile Parle West (near Mithibai College) ─────────────
  { a: "mithibai", dist: 350, brg: 40, name: "Shree Sai Students PG", street: "JVPD Scheme, Gulmohar Road", rent: 4900, deposit: 5000, food: false, sharing: "double", gender: "boys", amen: [...W, "geyser", "laundry"], rating: 4.2, reviews: ["Clean rooms, 5 min walk to Mithibai", "Owner is strict about timings but fair"], avail: 2 },
  { a: "mithibai", dist: 600, brg: 120, name: "Annapurna Ladies & Gents PG", street: "Bajaj Road", rent: 5200, deposit: 5200, food: true, sharing: "double", gender: "any", amen: [...W, "geyser", "laundry", "housekeeping"], rating: 4.5, reviews: ["Homely Gujarati food twice a day", "Worth the small extra over budget because food is included"], avail: 1, note: "TRICKY: Rs 5,200 slightly over 5k budget but food included" },
  { a: "mithibai", dist: 1300, brg: 200, name: "Juhu Breeze Residency", street: "Juhu Tara Road, Santacruz West", rent: 4800, deposit: 4800, food: false, sharing: "double", gender: "boys", amen: [...W, "geyser"], rating: 4.0, reviews: ["Good value, a bit far from college", "Quiet lane, close to Juhu beach"], avail: 3, note: "TRICKY: under budget but 1.3 km away" },
  { a: "mithibai", dist: 450, brg: 300, name: "Budget Stay Parle", street: "Irla Society Road", rent: 3500, deposit: 3000, food: false, sharing: "triple", gender: "boys", amen: ["geyser"], rating: 2.1, reviews: ["Bedbugs in the mattress, owner ignored complaints", "Water supply only 2 hours a day", "Very cheap but dirty bathrooms"], avail: 0, note: "TRICKY: cheapest but very bad reviews" },
  { a: "mithibai", dist: 700, brg: 80, name: "Nest Co-Living Vile Parle", street: "Nehru Road", rent: 4700, deposit: 5000, food: false, sharing: "double", gender: "girls", amen: [...W, "ac", "geyser", "laundry", "cctv"], rating: 4.6, reviews: ["Very safe for girls, CCTV and warden", "AC rooms at this price is rare"], avail: 10, note: "TRICKY: great but available only after 10 days" },
  { a: "mithibai", dist: 500, brg: 170, name: "Parle Comfort PG", street: "VM Road", rent: 4500, deposit: 40000, food: false, sharing: "double", gender: "any", amen: [...W, "geyser", "ac"], rating: 3.9, reviews: ["Rooms are nice", "Deposit is very high and refund took 3 months"], avail: 2, elec: 800, maint: 300, note: "TRICKY: low rent but Rs 40k deposit + electricity & maintenance extra" },
  { a: "mithibai", dist: 850, brg: 10, name: "Dhanlaxmi Girls Hostel", street: "Hanuman Road", rent: 5000, deposit: 10000, food: true, sharing: "triple", gender: "girls", amen: [...W, "geyser", "laundry", "cctv"], rating: 4.1, reviews: ["Food is simple but good", "Curfew at 10 pm"], avail: 4 },
  { a: "mithibai", dist: 950, brg: 250, name: "Sunrise Boys PG", street: "Gulmohar Cross Road 6", rent: 6500, deposit: 13000, food: true, sharing: "single", gender: "boys", amen: [...W, "ac", "geyser", "laundry", "housekeeping"], rating: 4.4, reviews: ["Single room with AC, very peaceful", "Pricey but premium"], avail: 1 },
  { a: "mithibai", dist: 1800, brg: 60, name: "Santacruz Students Home", street: "Linking Road, Santacruz West", rent: 4200, deposit: 8000, food: false, sharing: "triple", gender: "any", amen: [...W, "geyser"], rating: 3.7, reviews: ["Okay for the price", "Crowded rooms"], avail: 0 },
  { a: "mithibai", dist: 250, brg: 220, name: "Mithi Heights PG", street: "N S Road 10, JVPD", rent: 7500, deposit: 15000, food: true, sharing: "single", gender: "girls", amen: [...W, "ac", "geyser", "laundry", "gym", "cctv"], rating: 4.7, reviews: ["Right opposite college gate", "Excellent food and security"], avail: 0 },

  // ───────────── Andheri (near Andheri station) ─────────────
  { a: "andheri", dist: 400, brg: 270, name: "Lokhandwala Girls Nest", street: "SV Road, Andheri West", rent: 5800, deposit: 10000, food: true, sharing: "double", gender: "girls", amen: [...W, "geyser", "laundry", "cctv"], rating: 4.3, reviews: ["Very close to station", "Warden aunty is caring"], avail: 2 },
  { a: "andheri", dist: 650, brg: 300, name: "Pink Petal Ladies PG", street: "Irla Bridge Road, Andheri West", rent: 5500, deposit: 5500, food: false, sharing: "triple", gender: "girls", amen: [...W, "geyser"], rating: 3.8, reviews: ["Affordable, okay hygiene", "Small rooms"], avail: 0 },
  { a: "andheri", dist: 900, brg: 20, name: "Shanti Women's Hostel", street: "Old Nagardas Road, Andheri East", rent: 6200, deposit: 12000, food: true, sharing: "double", gender: "girls", amen: [...W, "ac", "geyser", "laundry"], rating: 4.4, reviews: ["AC and food, great combo", "Slightly over 6k"], avail: 1 },
  { a: "andheri", dist: 300, brg: 120, name: "Andheri Central Boys PG", street: "Teli Gali, Andheri East", rent: 5000, deposit: 5000, food: false, sharing: "triple", gender: "boys", amen: [...W, "geyser"], rating: 3.6, reviews: ["Next to station, noisy", "Value for money"], avail: 0 },
  { a: "andheri", dist: 1500, brg: 250, name: "Versova Co-Live", street: "Yari Road, Versova", rent: 9000, deposit: 18000, food: false, sharing: "single", gender: "any", amen: [...W, "ac", "geyser", "laundry", "gym", "housekeeping"], rating: 4.6, reviews: ["Modern co-living, great community", "Expensive"], avail: 3 },
  { a: "andheri", dist: 1100, brg: 180, name: "Gilbert Hill Girls PG", street: "Gilbert Hill Road, Andheri West", rent: 4800, deposit: 30000, food: false, sharing: "triple", gender: "girls", amen: [...W], rating: 3.4, reviews: ["Deposit is huge", "Owner deducts for small things"], avail: 5, elec: 600 },
  { a: "andheri", dist: 700, brg: 60, name: "Chakala Boys Hostel", street: "Chakala, Andheri East", rent: 6800, deposit: 7000, food: true, sharing: "double", gender: "boys", amen: [...W, "ac", "geyser"], rating: 4.0, reviews: ["Near metro", "Food quality varies"], avail: 2 },
  { a: "andheri", dist: 2200, brg: 330, name: "Oshiwara Student Stay", street: "Link Road, Oshiwara", rent: 5200, deposit: 6000, food: false, sharing: "double", gender: "any", amen: [...W, "geyser", "laundry"], rating: 4.1, reviews: ["Spacious rooms", "Far from station, need auto"], avail: 1 },
  { a: "andheri", dist: 550, brg: 210, name: "Saraswati Ladies PG", street: "Dadabhai Road, Andheri West", rent: 6000, deposit: 6000, food: true, sharing: "triple", gender: "girls", amen: [...W, "geyser", "cctv"], rating: 4.2, reviews: ["Safe, homely food", "Strict 9:30 pm curfew"], avail: 12, note: "available only after 12 days" },

  // ───────────── Powai (near IIT Bombay) ─────────────
  { a: "powai", dist: 600, brg: 200, name: "IIT Gate PG", street: "Adi Shankaracharya Marg, Powai", rent: 7500, deposit: 15000, food: true, sharing: "double", gender: "boys", amen: [...W, "ac", "geyser", "laundry"], rating: 4.3, reviews: ["Walk to IIT main gate", "Good food"], avail: 1 },
  { a: "powai", dist: 1200, brg: 170, name: "Hiranandani Co-Living", street: "Hiranandani Gardens, Powai", rent: 12000, deposit: 24000, food: false, sharing: "single", gender: "any", amen: [...W, "ac", "geyser", "laundry", "gym", "housekeeping"], rating: 4.7, reviews: ["Luxury living", "Very expensive for students"], avail: 2 },
  { a: "powai", dist: 900, brg: 230, name: "Tirandaz Students Home", street: "Tirandaz Village, Powai", rent: 6500, deposit: 6500, food: false, sharing: "double", gender: "any", amen: [...W, "geyser"], rating: 3.9, reviews: ["Basic but cheap for Powai", "Village area, a bit congested"], avail: 0 },
  { a: "powai", dist: 1700, brg: 140, name: "Lake View Girls PG", street: "Powai Lake Road", rent: 7800, deposit: 10000, food: true, sharing: "double", gender: "girls", amen: [...W, "ac", "geyser", "cctv"], rating: 4.5, reviews: ["Lake view from terrace!", "Safe and clean"], avail: 2 },
  { a: "powai", dist: 1900, brg: 260, name: "Saki Vihar Budget PG", street: "Saki Vihar Road", rent: 5500, deposit: 5000, food: false, sharing: "triple", gender: "boys", amen: [...W], rating: 3.2, reviews: ["Cheap", "Traffic noise all night"], avail: 1 },
  { a: "powai", dist: 400, brg: 300, name: "Panchkutir PG", street: "Panchkutir, Powai", rent: 8000, deposit: 8000, food: true, sharing: "double", gender: "boys", amen: [...W, "geyser", "laundry"], rating: 4.0, reviews: ["Close to IIT Y-point", "Decent food"], avail: 4, elec: 700, note: "exact 8k but electricity extra" },
  { a: "powai", dist: 2600, brg: 190, name: "Chandivali Residency", street: "Chandivali Farm Road", rent: 6000, deposit: 12000, food: false, sharing: "double", gender: "any", amen: [...W, "geyser", "ac"], rating: 4.1, reviews: ["Good rooms", "Need a bus to IIT"], avail: 0 },
  { a: "powai", dist: 1500, brg: 40, name: "Vikhroli Edge PG", street: "LBS Marg, Vikhroli West", rent: 5000, deposit: 25000, food: false, sharing: "triple", gender: "boys", amen: [...W], rating: 2.8, reviews: ["Owner keeps changing rules", "Deposit refund problems"], avail: 0 },

  // ───────────── Dadar ─────────────
  { a: "dadar", dist: 500, brg: 300, name: "Shivaji Park Boys PG", street: "Keluskar Road, Dadar West", rent: 7000, deposit: 14000, food: true, sharing: "double", gender: "boys", amen: [...W, "geyser", "laundry"], rating: 4.4, reviews: ["Near Shivaji Park, great locality", "Maharashtrian thali every night"], avail: 1 },
  { a: "dadar", dist: 350, brg: 90, name: "Dadar TT Ladies Hostel", street: "Dr Ambedkar Road, Dadar East", rent: 6500, deposit: 6500, food: true, sharing: "triple", gender: "girls", amen: [...W, "geyser", "cctv"], rating: 4.0, reviews: ["Very well connected", "Rooms are old"], avail: 0 },
  { a: "dadar", dist: 1200, brg: 200, name: "Prabhadevi Co-Stay", street: "Prabhadevi", rent: 9500, deposit: 20000, food: false, sharing: "single", gender: "any", amen: [...W, "ac", "geyser", "laundry", "housekeeping"], rating: 4.5, reviews: ["Premium", "Close to offices"], avail: 3 },
  { a: "dadar", dist: 800, brg: 20, name: "Matunga Students Lodge", street: "Matunga West", rent: 5500, deposit: 5000, food: false, sharing: "triple", gender: "boys", amen: [...W, "geyser"], rating: 3.7, reviews: ["Near Ruia & Podar colleges", "South Indian food nearby"], avail: 2 },
  { a: "dadar", dist: 1600, brg: 330, name: "Mahim Bay PG", street: "LJ Road, Mahim", rent: 4500, deposit: 4500, food: false, sharing: "triple", gender: "any", amen: ["geyser"], rating: 2.5, reviews: ["Leaking roof in monsoon", "Cheap though"], avail: 0 },
  { a: "dadar", dist: 600, brg: 160, name: "Kohinoor Girls Residency", street: "Gokhale Road, Dadar West", rent: 8000, deposit: 10000, food: true, sharing: "double", gender: "girls", amen: [...W, "ac", "geyser", "laundry", "cctv"], rating: 4.6, reviews: ["Excellent security", "Worth it"], avail: 8 },

  // ───────────── Thane ─────────────
  { a: "thane", dist: 400, brg: 250, name: "Thane Station Boys PG", street: "Gokhale Road, Thane West", rent: 4500, deposit: 5000, food: false, sharing: "triple", gender: "boys", amen: [...W, "geyser"], rating: 3.8, reviews: ["Very close to station", "Basic facilities"], avail: 0 },
  { a: "thane", dist: 1200, brg: 300, name: "Naupada Ladies PG", street: "Naupada, Thane West", rent: 5000, deposit: 5000, food: true, sharing: "double", gender: "girls", amen: [...W, "geyser", "laundry", "cctv"], rating: 4.3, reviews: ["Homely food", "Safe area"], avail: 1 },
  { a: "thane", dist: 2500, brg: 330, name: "Vartak Nagar Student Home", street: "Vartak Nagar", rent: 3800, deposit: 4000, food: false, sharing: "triple", gender: "any", amen: [...W], rating: 3.5, reviews: ["Cheapest decent option in Thane", "Need bus to station"], avail: 2 },
  { a: "thane", dist: 3800, brg: 280, name: "Majiwada Budget Stay", street: "Majiwada, Thane West", rent: 3200, deposit: 3000, food: false, sharing: "triple", gender: "boys", amen: ["geyser"], rating: 3.1, reviews: ["Very cheap", "Far from everything"], avail: 0 },
  { a: "thane", dist: 1800, brg: 200, name: "Panchpakhadi Co-Living", street: "Panchpakhadi", rent: 7500, deposit: 15000, food: false, sharing: "single", gender: "any", amen: [...W, "ac", "geyser", "laundry", "gym"], rating: 4.5, reviews: ["Modern rooms", "Pricey"], avail: 1 },
  { a: "thane", dist: 4500, brg: 320, name: "Ghodbunder Road PG", street: "Ghodbunder Road, Manpada", rent: 3000, deposit: 20000, food: false, sharing: "triple", gender: "any", amen: [...W], rating: 3.0, reviews: ["Rent is low but deposit is huge", "Long commute"], avail: 3, elec: 900, note: "cheapest rent but hidden deposit & electricity" },
  { a: "thane", dist: 700, brg: 100, name: "Kopri Girls Hostel", street: "Kopri, Thane East", rent: 5500, deposit: 5500, food: true, sharing: "triple", gender: "girls", amen: [...W, "geyser", "cctv"], rating: 4.0, reviews: ["Right across the station bridge", "Food is okay"], avail: 0 },
  { a: "thane", dist: 6000, brg: 20, name: "Mulund Check Naka PG", street: "Mulund West", rent: 4000, deposit: 4000, food: false, sharing: "double", gender: "boys", amen: [...W, "geyser"], rating: 3.9, reviews: ["Good value", "Outside Thane, 6 km"], avail: 0 },
  { a: "thane", dist: 3000, brg: 150, name: "Kalwa Bridge Stay", street: "Kalwa", rent: 3500, deposit: 3500, food: false, sharing: "triple", gender: "boys", amen: ["geyser"], rating: 2.4, reviews: ["Rooms are damp", "Owner rarely picks up the phone"], avail: 0 },
];

const listings = specs.map((s, i) => {
  const anchor = ANCHORS[s.a];
  const { lat, lng } = offset(anchor.lat, anchor.lng, s.dist, s.brg);
  const id = `PG${String(i + 1).padStart(3, "0")}`;
  return {
    id,
    name: s.name,
    address: `${s.street}, ${anchor.area}, ${anchor.city} ${anchor.pin}`,
    area: anchor.area,
    lat,
    lng,
    monthly_rent: s.rent,
    deposit: s.deposit,
    food_included: s.food,
    sharing_type: s.sharing,
    gender: s.gender,
    amenities: s.amen,
    rating: s.rating,
    review_snippets: s.reviews,
    available_from: dateIn(s.avail),
    extra_charges: { electricity: s.elec ?? 0, maintenance: s.maint ?? 0 },
    owner_name: ["Mr. Patil", "Mrs. Shah", "Mr. Iyer", "Mrs. Desai", "Mr. Khan", "Mrs. Fernandes", "Mr. Joshi"][i % 7],
    owner_phone: `+9190000${String(10000 + i * 137).slice(-5)}`, // fake numbers
    photos: [`/rooms/room${(i % 4) + 1}.jpg`],
    is_sample: true,
  };
});

const out = path.join(process.cwd(), "data", "listings.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify({ _note: "SAMPLE DATA: fictional listings for demo purposes only.", generated_at: new Date().toISOString(), listings }, null, 2),
);
console.log(`Seeded ${listings.length} SAMPLE listings -> ${path.relative(process.cwd(), out)}`);
