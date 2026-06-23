# 🪐 EVE PI Planner

A web app for visualizing and planning **Planetary Industry** across multiple EVE Online characters and accounts. See your full P0→P4 production chain at a glance, get smart suggestions for what to build next, catch expired extractors before they cost you, and know exactly what needs to be hauled where.

Built with **Vite + React + TypeScript** on a static front-end, with **Vercel serverless functions** for EVE SSO. Pulls live data from the [EVE ESI API](https://developers.eveonline.com/docs/services/esi/overview/) via EVE SSO OAuth (PKCE). Tokens stay server-side in an encrypted httpOnly cookie — never exposed to the browser.

---

## 🔭 Production Chain View

Planet nodes arranged by tier (P1 → P4, left to right). Color-coded bezier arrows show what flows from which planet to which factory. Each **character gets their own color** — borders, arrows, and the P1 cluster cards all share the same hue so you can instantly see who owns what.

**P1 extractor nodes** are grouped into cluster cards — one per P2 consumer — with sub-sections per character inside each card. This keeps the graph clean even with many extractors feeding the same factory.

- Hold **Alt** to reveal all arrow labels at once (collision-resolved so they don't overlap)
- Hover any node to highlight just its connections and labels
- A **character color legend** in the bottom-left identifies who is who

---

## ✦ Chain Suggestions

When your production chains are **incomplete**, the app suggests exactly what's missing — every leaf input that needs a new extractor or factory, deduplicated so you're never shown the same action twice.

When all chains are **complete**, it switches to suggesting new high-value products you could add given your available planet slots and skills.

Each suggestion shows:
- ISK/hr estimate
- Full step-by-step plan (buy command centers → set up extractors → set up factories)
- One-click copy of [DalShooth's PI templates](https://github.com/DalShooth/EVE_PI_Templates) directly to clipboard — paste in-game
- **Verify with ESI** button that refreshes all characters and confirms the planets are live, then auto-closes with a success animation

**Balance hints** (bottleneck / overproduction warnings) are always visible in the toolbar so you never miss an imbalance even with suggestions off.

---

## 📋 Template Search

A floating search button in the bottom-right corner of the chain view. Type any product name to instantly find and copy the factory or extractor template for it — no need to open a suggestion plan first.

---

## 🗂️ Haul Plan

Lists exactly which commodities need to move from which planet to which character to keep the chain running. Cross-character dependencies are resolved automatically.

---

## ⚡ PI Skill Editor

Set your PI skill levels with a visual 5-pip bar — no extra ESI scopes needed. Supports per-character **skill overrides** (plan ahead without committing) and shows active training queues with time-remaining countdowns.

| Skill | Effect |
|---|---|
| Command Center Upgrades | Upgrade level and pin count per command center |
| Interplanetary Consolidation | +1 planet per level (base 1, max 6 at L5) |
| Remote Sensing | Scan planets from farther away |
| Planetology | Improves resource survey accuracy |
| Advanced Planetology | Further improves survey accuracy |

---

## ✨ Feature Summary

- **Multi-character, multi-account** — add as many characters as you like via EVE SSO
- **Live ESI data** — colonies, extractors, factories, and schematics from CCP's API
- **Production chain graph** — P1→P4 nodes with SVG bezier arrows, per-character color coding
- **P1 cluster cards** — extractors grouped by P2 consumer and sub-grouped by character
- **Chain suggestions** — complete missing inputs first, then suggest new high-value additions
- **Template search** — find and copy any PI template in seconds
- **Balance hints** — bottleneck and overproduction warnings always visible
- **Haul plan** — cross-character commodity routing
- **Manual skill input** — visual pip bars, overrides, and training queue display
- **ESI verify** — confirm a suggestion is live with one click; success animation on completion
- **Arrow label collision avoidance** — labels stack instead of overlapping
- **Alt-hold** — reveal all arrow labels at once
- **Offline-friendly caching** — ESI responses cached locally with sensible TTLs

---

## 🚀 Getting Started

A web app: a static React front-end (Vite) plus a handful of Vercel serverless
functions that handle EVE SSO. Tokens never reach the browser — they live
encrypted in an httpOnly session cookie.

### 1. Register your app with CCP

Go to [developers.eveonline.com](https://developers.eveonline.com/) and create a new application:

- **Connection type:** Authentication & API Access (public / PKCE client — no secret)
- **Callback URLs:**
  - `http://localhost:3000/api/auth/callback` (local dev)
  - `https://YOUR-DOMAIN.vercel.app/api/auth/callback` (production)
- **Scopes:** `esi-planets.manage_planets.v1`, `esi-planets.read_customs_offices.v1`, `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1`

Copy the **Client ID**.

### 2. Set environment variables

Create `.env` (see `.env.example`):

```
EVE_CLIENT_ID=your_client_id_here
SESSION_SECRET=a_long_random_string_min_32_chars
```

Generate a secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Run locally

```bash
npm install
npm i -g vercel        # first time only
vercel dev             # serves the app + /api functions on http://localhost:3000
```

Open `http://localhost:3000`, click **Import from EVE**, log in via EVE SSO, and
your planets load automatically. (`npm run dev` runs only the Vite front-end on
:5173 with `/api` proxied to `vercel dev` — handy for pure-UI work.)

### 4. Deploy

```bash
vercel            # preview deploy
vercel --prod     # production
```

Set `EVE_CLIENT_ID` and `SESSION_SECRET` in the Vercel project's Environment
Variables, and make sure your production callback URL is registered with CCP.

---

## 🏗️ Project Structure

```
eve-pi/
├── api/                     # Vercel serverless functions (Node)
│   ├── _lib/
│   │   ├── session.ts       # iron-session: refresh tokens in httpOnly cookie
│   │   ├── oauth.ts         # EVE SSO PKCE helpers (public client)
│   │   └── esiImport.ts     # authenticated ESI import (skills, colonies)
│   ├── auth/
│   │   ├── login.ts         # PKCE start → redirect to CCP
│   │   ├── callback.ts      # code exchange → store token by characterId
│   │   └── logout.ts        # drop one character / clear session
│   └── esi/
│       └── refresh.ts       # refresh all tokens, re-import, return characters
├── src/
│   ├── api/                 # browser data layer (replaces the old IPC bridge)
│   │   ├── store.ts         # localStorage store + ESI merge logic
│   │   ├── esi.ts           # public ESI calls (direct browser fetch)
│   │   └── index.ts         # installs window.api; auth → /api/auth/*
│   ├── components/
│   │   ├── ChainView/       # 🪐 Production chain graph + suggestions
│   │   ├── SuggestionPlan/  # ✦ Step-by-step plan panel + ESI verify
│   │   ├── TemplateSearch/  # 📋 Floating template search widget
│   │   ├── HaulPlan/        # 📦 Cross-character hauling recommendations
│   │   ├── SetupView/       # 🗂️ Character + planet setup
│   │   └── SkillEditor/     # ⚡ PI skill level editor
│   ├── data/
│   │   ├── schematics.ts    # P0→P4 schematic graph + product map
│   │   └── planetResources.ts
│   ├── hooks/
│   │   ├── useCharacters.ts
│   │   ├── useChainSuggestions.ts
│   │   ├── useMarketPrices.ts
│   │   └── useSystemPlanets.ts
│   └── types/
│       └── api.ts           # shared types + window.api interface
├── vercel.json              # CSP + security headers, build config
└── docs/
```

---

## 🔑 ESI Scopes

| Scope | Used for |
|---|---|
| `esi-planets.manage_planets.v1` | Colony layouts, extractors, factories, routes |

Tokens are stored locally in `electron-store` and refreshed automatically — you only log in once per character.

---

## 🛠️ Development

```bash
npm run dev        # Launch in Electron with hot-reload
npm run build      # Production build → out/
npm run typecheck  # TypeScript check without building
```

---

## ⚠️ ESI Data Freshness

Colony data in ESI only updates **when you view the colony in the EVE client**. Expiry times are calculated from the last client snapshot — if you haven't opened a planet in-game recently, the times shown may be stale. This is a CCP API limitation, not a bug in the app.

---

*Not affiliated with CCP Games. EVE Online and all related assets are property of CCP hf.*
