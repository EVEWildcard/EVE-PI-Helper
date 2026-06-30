# 🪐 EVE PI Helper

A web tool for planning **Planetary Industry** across a whole stable of EVE Online
characters — the production chain, the profit, and the hauling — in one place.

This README is a look at *what it is and how it's built*, written for anyone
curious about the project rather than as a setup guide.

## The problem it solves

Planetary Industry in EVE is deceptively deep. One character with six planets is
manageable in your head. Twenty-four characters feeding each other across a
P0→P1→P2→P3→P4 web, each extractor on its own timer, materials split between
multiple consumers — that's a spreadsheet most people never build, so most of the
value sits on the table.

EVE PI Helper turns that whole operation into something you can *see*, *reason
about*, and *execute* without a spreadsheet.

## What it does

- **Production chain graph** — your entire empire as a tiered P0→P4 graph. Arrows
  show what feeds what; balance problems (bottlenecks, overproduction) surface as
  styled issue arrows you can hover to locate. Hover any planet to light up its
  whole chain; click an alt in the legend to pin its sub-chain.
- **Profit-ranked suggestions** — finds broken chains (a missing input earning you
  zero) first, then suggests new products worth adding, ranked by ISK/hr impact
  relative to your current income so the list stays signal, not noise.
- **Guided haul plan** — a per-character, one-login-at-a-time walkthrough of
  exactly what to reset, collect, drop into the shared container, pick up, and
  deliver — in an order that respects cross-character dependencies, including
  return visits when an alt's input is produced by a *later* alt. Materials
  feeding several consumers are split by real demand, and each receiving alt is
  reminded to grab only its share.
- **Template search** — find any PI template and copy it to paste in-game.
- **Skill editor** — set PI skills (or plan ahead with overrides) and watch the
  numbers change.

Log in with EVE SSO and your colonies load automatically from ESI.

## Design approach

A few principles shaped most of the decisions:

- **Degrade gracefully with scale.** The same views have to read well at two
  planets and at a 150-character multibox empire. Past a handful of alts the
  per-alt rainbow becomes noise, so the graph switches to coloring by product
  tier and trades the legend for an empire stat line — while still revealing a
  single chain's alts on hover.
- **Teach only when there's room.** Explanatory copy and legends appear when the
  view is sparse enough to have space for them, and quietly step aside when it's
  dense. The interface explains itself to newcomers without nagging experts.
- **Stable while you work.** The haul plan freezes its login order for the
  duration of a run, so resetting an extractor in-game doesn't reshuffle the plan
  underneath you. Completed steps stay completed; ESI-verified resets are sticky.
- **Model the real rules.** Planet-type resource constraints, per-tier recipes,
  facility throughput and cycle times are all modelled from the real schematic
  graph, so the numbers and the suggestions mean something.
- **Privacy first.** See below.

## How it's built

- **Vite + React + TypeScript** single-page app.
- **Vercel serverless functions** handle EVE SSO and the ESI import. Your access
  and refresh tokens stay server-side in an encrypted, httpOnly cookie — they're
  never exposed to browser JavaScript.
- **Your planet data lives only in your own browser** (localStorage). There's no
  database of player empires sitting on a server somewhere.
- **Pure, testable core.** The chain model, layout math, and haul-plan derivation
  are pure functions, kept separate from the React components that render them.
- **A deterministic dev empire generator** builds plausible, internally-valid
  multi-character operations straight from the real schematic graph — sized from
  one planet up to the multibox ceiling — so every view can be exercised against
  genuine data at any scale, reproducibly.

## A note on process

This project is built collaboratively with **Claude** (Anthropic) in the loop —
feature work, refactors, and bug hunts alike. The emphasis throughout has been on
readable code, honest models of the game's rules, and UI that scales from a casual
single-character setup to a serious industrial operation.

---

**Go try it here:** https://eve-pi-helper.vercel.app

*Not affiliated with CCP Games. EVE Online is a trademark of CCP hf.*
