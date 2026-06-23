# 🪐 EVE PI Helper

A free web tool for planning **Planetary Industry** across your EVE Online characters.

**▶ Live: https://eve-pi-helper.vercel.app**

## What it does

- **Production chain** — see your whole P0→P4 setup as a graph, color-coded per character
- **Suggestions** — finds missing inputs first, then suggests profitable new products
- **Haul plan** — what to move where, across characters, in order
- **Template search** — find and copy any PI template to paste in-game
- **Skill editor** — set PI skills, plan ahead with overrides

Log in with EVE SSO and your colonies load automatically.

## Tech

Vite + React + TypeScript, with Vercel serverless functions for EVE SSO.
Your ESI tokens stay server-side in an encrypted, httpOnly cookie — never exposed to the browser. Your planet data lives only in your own browser.

## Run locally

```bash
npm install
npm i -g vercel        # first time only
vercel dev             # http://localhost:3000
```

Needs `EVE_CLIENT_ID` and `SESSION_SECRET` env vars (see `.env.example`).

---

*Not affiliated with CCP Games. EVE Online is a trademark of CCP hf.*
