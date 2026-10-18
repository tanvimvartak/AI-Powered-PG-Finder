# PG Finder Agent 🎓🏠

> An AI-native, agentic web application that helps students find PG (paying guest) accommodation in India from **one sentence of text or voice**. No filter forms.

---

## 1. Overview & Core Experience

Traditional rental portals force students through complex filter forms (city dropdowns, locality checkboxes, price sliders, deposit limits, amenity filters).

**PG Finder Agent** replaces that entire process with **one sentence**:
> *"Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days"*
>
> *(or Hinglish: "Mithibai ke paas 5000 mein PG chahiye")*

From this single natural language input, an autonomous AI agent running on the server:
1. **Understands & extracts** the intent, landmark, radius (with sensible defaults like "walking distance" = 1000m), budget, deadline, gender, sharing, food, and amenities.
2. **Geocodes** the landmark via OpenStreetMap Nominatim (with a fast curated fallback table for top student landmarks).
3. **Searches listings** in the local database using the spherical Haversine formula, plus queries OpenStreetMap Overpass API for supplementary hostels/guest houses.
4. **Relaxes constraints step-by-step** if no strict match exists (radius first ×1.5, then budget +15%), letting the student accept or reject.
5. **Ranks listings** with an explainable multi-factor scoring model that accounts for hidden charges (high security deposits, electricity & maintenance surcharges), meal value (~Rs 2,500/month credit for included food), review sentiment, and move-in deadline availability.
6. **Reaches out to owners** via simulated WhatsApp role-play to confirm pricing, move-in availability, and visit slots, while generating real one-click `wa.me` links.
7. **Schedules visits** with instant downloadable `.ics` calendar files and one-click Google Calendar add-event links without OAuth.

---

## 2. Architecture & Agent Loop Diagram

```
                                  +------------------------------------------------------+
                                  |                     Browser UI                       |
                                  |  - One natural-language input (Web Speech / Text)    |
                                  |  - Live activity timeline (SSE stream)               |
                                  |  - Leaflet + OSM dark-tile map (auto-fit radius)     |
                                  |  - Interactive parameter chips (tweak & re-run)      |
                                  |  - Ranked result cards with "Why" & Red Flags        |
                                  |  - Visit scheduling (.ics download / Google Cal)     |
                                  +---------------------------+--------------------------+
                                                              | POST /api/agent (SSE)
                                                              v
+--------------------------------------------------------------------------------------------------------------------+
|                                             Server Agent Loop (/api/agent)                                         |
|                                                                                                                    |
|   1. Initialize session & System Prompt (src/lib/agent/systemPrompt.ts)                                            |
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
|        |  * parse_request(text)      -> Extracts landmark, radius, budget, deadline, preferences           |       |
|        |  * geocode(place, city)     -> Nominatim / curated fallback (lat, lng)                            |       |
|        |  * search_listings(...)     -> Haversine local DB + Overpass OSM hostels supplement               |       |
|        |  * [Constraint Relaxation]  -> Radius x1.5 -> Budget +15% if 0 strict matches                     |       |
|        |  * rank_listings(...)       -> Weighted scoring: price, walk time, reviews, hidden costs          |       |
|        |  * contact_owner(...)       -> Simulated WhatsApp roleplay + visit slots + real wa.me link        |       |
|        |  * schedule_visit(...)      -> Downloadable .ics + Google Calendar template URL                   |       |
|        +--------------------------------------------------+------------------------------------------------+       |
|                                                           | Stream progress event to UI via SSE                    |
|                                                           | Feeds functionResponse back to Gemini                  |
|                                                           v                                                        |
|   3. Gemini outputs final recommendation text & terminates loop.                                                   |
+--------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Technology Stack & Hard Constraints

- **100% Free**: No paid APIs, no credit card required.
- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS.
- **Styling**: Tailored dark glassmorphic design system (`globals.css`) with responsive split layout, pulsating voice mic animations, and dark-inverted OpenStreetMap tiles.
- **Maps**: Leaflet.js (`react-leaflet`) with OpenStreetMap tiles (no Google Maps API).
- **LLM**: Google Gemini REST API (server-side only in route handlers). Config-driven model (`GEMINI_MODEL=gemini-flash-latest`) with automatic model fallback chain (`gemini-3.5-flash`, `gemini-flash-lite-latest`, `gemini-3.1-flash-lite`) to survive free-tier per-model daily limits.
- **Voice**: Browser Web Speech API (`SpeechRecognition` configured for `en-IN`), with real-time transcript streaming and graceful fallback to text input.
- **Data**: Seeded local dataset (`data/listings.json`) with 42 realistic student PG listings across Mumbai (Vile Parle West, Andheri, Powai, Dadar, Thane).

---

## 4. Setup & Running Locally

### Prerequisites
- Node.js 18+ (tested on Node v24)
- npm 9+
- A free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (no billing required)

### Step 1: Clone and install dependencies
```bash
git clone <repo-url>
cd pg-finder-agent
npm install
```

### Step 2: Configure Environment Variables
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Edit `.env` and paste your Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite
GEMINI_LIGHT_MODELS=gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash
GEMINI_THINKING_LEVEL=low
OSM_USER_AGENT=PGFinderAgent/0.1 (+https://github.com/your-name/pg-finder-agent)
ENABLE_OVERPASS=true
```

### Step 3: Seed the Database
```bash
npm run seed
```
*(This generates 42 realistic listings in `data/listings.json` with fresh dates relative to today).*

### Step 4: Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Verification & Test Suite

The test suite validates all 6 mandatory user query scenarios:

```bash
npx tsx scripts/test_queries.ts
```

### Test Results Summary

| # | Test Query | Key Validations | Top Pick Result |
|---|---|---|---|
| **Q1** | *"Please find me a PG accommodation near Mithibai college within 1 km radius. My budget is Rs 5,000 and I need the accommodation in 5 days"* | Extracts 1 km, budget 5k, 5-day deadline. Detects food value credit (~Rs 2,500) making a Rs 5,200 PG effectively cheaper than Rs 4,900 without food. | **Annapurna Ladies & Gents PG** (600m, food included, owner agrees to Rs 5k) |
| **Q2** | *"PG near Powai IIT within 2 km, budget 8,000, need it in 3 days"* | Geocodes IIT Bombay Powai, filters within 2 km, checks move-in availability within 3 days. | **IIT Gate PG** (600m walk to IIT, Rs 7,500/mo, food included) |
| **Q3** | *"Girls PG near Andheri station, walking distance, under 6k"* | Translates "walking distance" -> 1000m, filters `gender === 'girls'`, under 6k. | **Lokhandwala Girls Nest** (400m from station, Rs 5,800, food included) |
| **Q4** | *"Cheapest PG within 5 km of Thane station, by Monday"* | Scales commute weight for 5 km radius, calculates deadline for Monday, sorts by value. | **Naupada Ladies PG** (Rs 5,000/mo, 1.2 km) |
| **Q5** | *"Mithibai ke paas 5000 mein PG chahiye"* | Hinglish parsing ("ke paas" -> near, "5000 mein" -> max budget 5,000, defaults radius to 1 km). | **Annapurna Ladies & Gents PG** (600m, food included) |
| **Q6** | *"PG near Dadar station within 500 m under Rs 2,500, need it tomorrow"* | **Constraint Relaxation**: Iteratively expands radius 500m -> 750m -> 1.1km -> raises budget to Rs 2,900. Honestly reports that market prices start at Rs 5,500. | Honest explanation of relaxed constraints & market rates |

---

## 6. Project Structure

```
pg-finder-agent/
├── data/
│   ├── listings.json            # 42 realistic student sample listings (generated)
│   └── cache/                   # Persistent caches for Nominatim & Overpass
├── public/
│   └── rooms/                   # Generated photorealistic room images
├── scripts/
│   ├── seed.ts                  # Seed script generating sample data with tricky cases
│   └── test_queries.ts          # Automated test runner for Section 7 test queries
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent/route.ts   # Server-Sent Events (SSE) agent loop endpoint
│   │   │   ├── contact/route.ts # On-demand simulated owner role-play
│   │   │   ├── parse/route.ts   # Request parsing debug endpoint
│   │   │   └── visit/route.ts   # .ics download & Google Calendar link generator
│   │   ├── globals.css          # Design system: tokens, glassmorphism, animations
│   │   ├── layout.tsx           # Root layout with Outfit font & Leaflet CSS
│   │   └── page.tsx             # Home page + Agent split view with timeline & map
│   ├── components/
│   │   ├── MapView.tsx          # Leaflet map with auto-fit radius circle & live pins
│   │   ├── ParamChips.tsx       # Editable parsed parameters (tweak and re-run)
│   │   ├── ResultCard.tsx       # Ranked card with Why, Red Flags, Chat & Visit
│   │   ├── Timeline.tsx         # Live step-by-step activity timeline with raw I/O
│   │   └── useVoice.ts          # Web Speech API hook (en-IN)
│   └── lib/
│       ├── agent/
│       │   ├── executor.ts      # Tool implementations & simulated owner role-play
│       │   ├── loop.ts          # Agent loop with fallback resilience
│       │   ├── parser.ts        # Gemini structured parser + heuristic fallback
│       │   ├── systemPrompt.ts  # Isolated system prompts for easy tuning
│       │   └── tools.ts         # Gemini function calling declarations
│       ├── gemini.ts            # Server-only Gemini REST client (retries, fallback chain)
│       ├── geo.ts               # Haversine, Nominatim geocoder & Overpass lookup
│       ├── ics.ts               # RFC 5545 iCalendar (.ics) and Google Calendar generator
│       ├── listings.ts          # In-memory listings query & near-miss matcher
│       ├── price.ts             # Price color helper
│       ├── rank.ts              # Multi-factor scoring model
│       └── types.ts             # TypeScript definitions
├── .env.example
├── package.json
└── README.md
```

---

## 7. Limitations & Future Work

While this MVP demonstrates a complete, autonomous agentic workflow, a production-grade deployment would extend it in the following areas:

1. **Real Listing Integrations & Aggregation**:
   - In production, partner with student housing providers (e.g. stanza living, zolo, yourspace) or scrape verified listing APIs with webhooks.
   - Implement real-time vacancy checking via property management system (PMS) integrations.
2. **Real WhatsApp Outreach**:
   - Replace the simulated owner LLM role-play with official WhatsApp Business Cloud API (`messages` endpoint) or Twilio.
   - Manage inbound webhooks when owners reply, summarizing their answers in the live session timeline.
3. **Identity Verification & Security**:
   - Student KYC / College ID verification via DigiLocker.
   - Landlord property verification (utility bill matching, physical geo-verification) to eliminate student rental scams.
4. **Tokenization & Payments**:
   - In-app token deposit escrow (UPI / Razorpay) held safely until the student inspects the accommodation and signs the rental agreement.
5. **Multi-Modal Street View & Virtual Tours**:
   - 360-degree room tours and neighbourhood safety scores (proximity to street lighting, metro, night transit).

---

## 8. License

MIT License. Designed and engineered for the WildCatter Ventures Project Assignment.
