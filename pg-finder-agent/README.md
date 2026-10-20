# PG Finder Agent 🎓🏠

> An AI-native, agentic web application that helps students find **real PG (paying guest) accommodation, hostels, and student housing** across India from **one sentence of text or voice**. No filter forms. No paid APIs. 100% real live public data by default.

---

## 1. Overview & Core Experience

Traditional rental portals force students through complex filter forms (city dropdowns, locality checkboxes, price sliders, deposit limits, amenity filters). Furthermore, portals often feature outdated listings, hidden brokerage charges, or fabricated pricing.

**PG Finder Agent** replaces that entire process with **one natural language sentence**:
> *"Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days"*
>
> *(or Hinglish: "Mithibai ke paas 5000 mein PG chahiye")*

From this single natural language input, an autonomous AI agent running on the server:
1. **Understands & extracts** the intent, landmark, radius (with sensible defaults like "walking distance" = 1000m), budget, deadline, gender, sharing, food, and amenities.
2. **Geocodes** the landmark via OpenStreetMap Nominatim with throttled, cached requests and accurate coordinate resolution.
3. **Discovers real listings live in parallel** across multiple open public sources (OpenStreetMap Overpass, Geoapify Places, and Gemini Live Web Discovery).
4. **Merges & deduplicates** listings spatially (50m radius) and by normalized name similarity, preserving all source citations.
5. **Ranks listings honestly**: separates listings with verified budget matches (`top_match`) from unlisted-price discoveries (`worth_asking`). It never fabricates prices, ratings, reviews, or owner identities.
6. **Drafts student outreach**: writes a personalized enquiry for WhatsApp (`wa.me` links), phone (`tel:` links), or web source links, letting the student inspect and send it directly ("Agent drafted it. You send it.").
7. **Schedules proposed visits** with downloadable `.ics` calendar files and Google Calendar links, marked clearly as "proposed, not confirmed by owner".

---

## 2. Real-Data Architecture & Multi-Source Pipeline

The system operates with **100% free open sources** and strictly zero fake listings in default mode (`DEMO_MODE=false`).

```
                                  +------------------------------------------------------+
                                  |                     Browser UI                       |
                                  |  - One natural-language input (Web Speech / Text)    |
                                  |  - Live activity timeline (SSE stream)               |
                                  |  - Leaflet + OSM dark-tile map (pin color by budget) |
                                  |  - Data source chips & source badges on cards        |
                                  |  - Top Matches vs "Worth Asking About" split         |
                                  |  - Pre-drafted WhatsApp & phone outreach             |
                                  +---------------------------+--------------------------+
                                                              | POST /api/agent (SSE)
                                                              v
+--------------------------------------------------------------------------------------------------------------------+
|                                             Server Agent Loop (/api/agent)                                         |
|                                                                                                                    |
|   1. Initialize session & System Prompt (cites sources, reports live pipeline counts, zero fake data)              |
|   2. Loop (capped at 10 iterations):                                                                               |
|                                                                                                                    |
|        +---------------------------------------------------------------------------------------------------+       |
|        |                                    Google Gemini (Flash API)                                      |       |
|        |  Evaluates conversation history + tool definitions (src/lib/agent/tools.ts)                       |       |
|        +--------------------------------------------------+------------------------------------------------+       |
|                                                           | Returns functionCall(s) or final text                  |
|                                                           v                                                        |
|        +---------------------------------------------------------------------------------------------------+       |
|        |                                 Tool Execution (src/lib/agent/executor.ts)                        |       |
|        |                                                                                                   |       |
|        |  * parse_request(text)          -> Landmark, radius, budget, deadline, preferences                |       |
|        |  * geocode(place, city)         -> OpenStreetMap Nominatim (lat, lng)                             |       |
|        |  * search_listings(...)         -> Parallel Multi-Source Real Data Pipeline:                      |       |
|        |       ├── Source A: OpenStreetMap Overpass API (hostels, guest houses, student dorms)            |       |
|        |       ├── Source B: Geoapify Places API (free tier accommodation points, optional)                |       |
|        |       └── Source C: Gemini Live Web Discovery (Google Search grounding & web real-time listings)  |       |
|        |       └── Deduplication & Merge (spatial 50m cluster + name normalization)                        |       |
|        |  * rank_listings(...)           -> Honest partitioning: Top Matches vs Worth Asking About         |       |
|        |  * draft_enquiry(listing_id)    -> Real WhatsApp (wa.me), tel: links, copy-to-clipboard           |       |
|        |  * schedule_visit(...)          -> Proposed .ics file & Google Calendar link                      |       |
|        +--------------------------------------------------+------------------------------------------------+       |
|                                                           | Streams real-time timeline event to UI                 |
|                                                           | Feeds functionResponse back to Gemini                  |
|                                                           v                                                        |
|   3. Gemini outputs final recommendation text citing exact sources and count breakdowns.                           |
+--------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Data Sources & Free-Tier Specifications

All sources are 100% free with **no credit card required**:

| Source | Role | Filters / Criteria | Free-Tier Limits & Caching |
|---|---|---|---|
| **OpenStreetMap Overpass API** | Discovers mapped hostels, guest houses, student dormitories, and PG nodes. | `tourism=hostel`, `tourism=guest_house`, `tourism=apartment`, `amenity=student_accommodation`, `building=dormitory`, regex matching `/\b(PG\|paying guest\|hostel\|dorm\|stay)\b/i`. Captures OSM URLs, phone, website. | 100% free, community-operated. Multi-mirror fallback (`overpass-api.de`, `kumi.systems`, `mail.ru`, `open-osm.com`) with circuit-breaker protection and persistent disk cache in `data/cache/overpass/`. |
| **Geoapify Places API** (Optional) | Supplements local points of interest for hostels, apartments, and guest houses. | `accommodation.hostel`, `accommodation.guest_house`, `accommodation.apartment`, filtered with `circle:lng,lat,radius`. | Free tier: 3,000 requests/day, no credit card. If `GEOAPIFY_API_KEY` is omitted, this source skips silently without interrupting the pipeline. |
| **Live Web Discovery** (Gemini + Grounding) | Discovers active live advertisements, student PG posts, and verified listings from portals (Zolostays, Stanza Living, Justdial, Sulekha). | Prompt with strict JSON schema: extracts name, address, rent (null if not explicitly stated), sharing, phone, and source URL. Geocoded via Nominatim. | Free tier via Google AI Studio (15 RPM). Automatic fallback when Google Search Grounding quota (`429 RESOURCE_EXHAUSTED`) is reached. 24-hour persistent disk caching in `data/cache/web_discovery.json`. |
| **OpenStreetMap Nominatim** | Geocodes student landmarks, metro stations, and institutions to `(lat, lng)`. | Structured queries with country code `in`, throttled (1 request/sec limit compliant), descriptive user-agent header. | 100% free with local disk cache in `data/cache/nominatim/`. |

---

## 4. Honest Data Model & "Unverified" Semantics

### What "Unverified" Means
In India, paying guest (PG) accommodations operate in a decentralized, informal rental market. There is no official municipal register or single MLS for student hostels. Consequently:
- **Every listing is marked `verification: "unverified"`** by default.
- Information found on OpenStreetMap or web directories may reflect previous academic terms, varying room occupancies (single, double, triple sharing), or recent owner updates.
- **Prices are never fabricated**: If a price is not explicitly published, it is assigned `price_status: "unknown"` with the label `"Price not listed. Ask owner"`.
- Listings with unknown prices are **never excluded** when filtering by budget. Instead, they are placed in a dedicated **"Worth asking about"** section so students do not miss viable nearby options.

### Map Pin Color Semantics
- 🟢 **Green**: Listed price is strictly within budget.
- 🟡 **Amber**: Listed price is slightly above budget (near-match).
- ⚪ **Grey**: Price is unlisted/unknown. Worth contacting the owner directly.
- 🔴 **Red**: Listed price is over budget.

### Honest Outreach
Simulated landlord chat bots and fake owner names have been removed. Instead, the agent executes `draft_enquiry`:
- Generates a personalized message with student details (budget, move-in date, sharing preference, gender).
- Provides a direct **WhatsApp click-to-chat** link (`https://wa.me/<phone>?text=...`) if a phone number was found in public records.
- Provides a direct **Phone call** link (`tel:<phone>`) and a **Copy Message** button.
- If no contact number is publicly indexed, it links directly to the source page.
- Clear label: **"Agent drafted it. You send it."**

---

## 5. Setup & Running Locally

### Prerequisites
- Node.js 18+ (tested on Node v20/v22/v24)
- npm 9+
- A free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (no billing required)

### Step 1: Clone and install dependencies
```bash
git clone <repo-url>
cd pg-finder-agent
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env`:
```env
# Required: Free Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite
GEMINI_LIGHT_MODELS=gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash
GEMINI_THINKING_LEVEL=low

# Real Mode vs Demo Mode
# false (default) = 100% REAL live open sources (OSM Overpass + Geoapify + Gemini Web)
# true = Offline fallback using data/listings.json with visible "SAMPLE DATA" badges
DEMO_MODE=false

# Optional: Free Geoapify Places API key (geoapify.com, no credit card)
GEOAPIFY_API_KEY=

# OpenStreetMap User Agent (RFC 2616 compliant)
OSM_USER_AGENT=StudentPGFinderProjectApp/2.0 (student.pg.finder.app@gmail.com)
ENABLE_OVERPASS=true
```

### Step 3: Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. Real-World Test Suite & Verification

Run the real-world validation suite against the live Next.js server:
```bash
npx tsx scripts/test_queries.ts
```

### Test Query Scenarios & Results

All queries run in real mode (`DEMO_MODE=false`) and verify **exactly 0 seed listings**:

| # | Test Query | Target Location | Sources Used | Real Listings Found | Resulting Top Pick & Source |
|---|---|---|---|---|---|
| **Q1** | *"PG near Mithibai College within 1 km, budget 5000, need in 5 days"* | Vile Parle West, Mumbai | Overpass + Web Discovery | 1 merged | **Sai Krupa Paying Guest** (Justdial URL citation, 0 seed listings) |
| **Q2** | *"Girls PG near Andheri station, walking distance, under 6k"* | Andheri, Mumbai | Overpass + Web Discovery | 1 merged | **Zolo Andheri** (Zolostays URL citation, 0 seed listings) |
| **Q3** | *"PG near Fergusson College in Pune within 2 km"* | FC Road, Pune *(Non-seed city)* | Overpass + Web Discovery | 1 merged | **Stanza Living Pune (FC Road Area)** (Stanza Living URL citation, proved non-Mumbai nationwide discovery) |
| **Q4** | *"Hostel or PG near St. Xavier's College Mumbai within 1.5 km"* | Fort, Mumbai *(Unlisted price handling)* | Overpass + Web Discovery | 1 merged | Categorized into **"Worth asking about"** with grey map pin and "Price not listed. Ask owner" label |

*Detailed test logs and source metrics are written to `real_test_summary.json`.*

---

## 7. Limitations & Honest Disclosure

1. **No Free Official Central PG API in India**:
   - There is no unified, public, free API for student accommodation in India. Commercial property portals (MagicBricks, 99acres, Housing.com) protect their data behind proprietary paywalls or anti-bot protections.
   - PG Finder Agent solves this by orchestrating open geospatial data (OpenStreetMap Overpass, Geoapify) and AI-guided real-time web discovery.
2. **Prices & Availability Must Be Confirmed with Owners**:
   - Web listings and map entries may reflect older academic cycles or baseline pricing for 3-sharing rooms rather than private rooms.
   - The application does not falsely claim a room is guaranteed; students must use the pre-drafted WhatsApp/phone buttons to confirm current vacancies.
3. **OpenStreetMap Coverage Varies by City**:
   - Major metropolitan university clusters (e.g. South Mumbai, North Campus Delhi, Kothrud/Shivajinagar Pune, Koramangala Bengaluru) have stronger community OSM tagging than tier-2 or tier-3 student hubs. Gemini Live Web Discovery helps bridge this gap.
4. **Rate Limits on Free Tiers**:
   - OpenStreetMap Overpass public servers occasionally throttle during peak hours. The built-in multi-mirror circuit breaker and local disk caching safeguard against downtimes.

---

## 8. License

MIT License. Designed and engineered for the WildCatter Ventures Project Assignment.
