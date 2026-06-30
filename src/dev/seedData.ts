// Dev-only PI empire randomizer.
//
// Generates a *plausible, internally-valid* multi-character operation from the
// real schematic graph (src/data/schematics.ts), so every derived view — the
// production chain, suggestions, and especially the Haul Plan — sees genuine
// data. The randomness is constrained by the actual rules of EVE Planetary
// Industry:
//
//   • A character can run at most 6 planets (Interplanetary Consolidation V).
//   • Each planet produces exactly one commodity.
//   • An extractor's P1 output is only possible on a planet type whose P0
//     resources include the required raw material (PLANET_RESOURCES).
//   • Every factory's inputs are taken from the real P1→P2→P3→P4 recipes.
//
// Crank the P4-chain count up and you get the "ultimate test": 6–9 maxed
// characters collectively producing several P4 commodities, with cross-character
// feeders, split deliveries, and a full spread of extractor urgencies.
//
// Gated behind `import.meta.env.DEV` at the call site, so it is tree-shaken out
// of production builds.

import {
  PRODUCT_BY_NAME, PRODUCT_BY_TYPE_ID, SCHEMATIC_INPUTS_BY_NAME,
  SCHEMATIC_BY_OUTPUT, P0_TO_P1_SCHEMATICS, PLANET_RESOURCES, P4_PRODUCTS,
} from '../data/schematics'
import { type StoredCharacter, type Planet, type PISkillLevels } from '../types/api'

const STORAGE_KEY = 'evepi.store'
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

// EVE caps a character at 6 planets (Interplanetary Consolidation V: 1 + 5).
// The dev "scale" slider runs from 1 planet up to the theoretical ceiling a
// heavy multiboxer could reach — ~50 accounts × ~3 toons = ~150 toons × 6 = 900
// planets. That's the graceful-degradation ceiling, NOT the design target
// (~140 planets / ~24 toons stays genuinely usable — see roadmap memory).
export const MAX_PLANETS_PER_ALT = 6
export const MAX_ALTS = 150
export const MAX_PLANETS = MAX_ALTS * MAX_PLANETS_PER_ALT // 900
// Default local-testing empire: ~8 maxed alts / 48 planets — the documented
// "real pain case" (≈ the user's screenshot) the readability rework targets.
// Auto-seeded on a fresh dev store; the scale slider adjusts up/down from here.
export const DEFAULT_DEV_PLANETS = 48
// Fixed seed for the slider so empire(N) is a stable prefix-superset of
// empire(N+1) — dragging grows ONE empire, and refactors verify against
// reproducible data.
const SLIDER_SEED = 0xc0ffee

const NAMES = [
  'Mira Voss', 'Kael Thorne', 'Sera Lux', 'Dex Korrin', 'Vanya Hale', 'Orin Crask',
  'Lyra Venn', 'Tovan Reig', 'Nyx Dovar', 'Hadley Pryce', 'Iska Bryn', 'Corvan Tael',
]
// Fictional wormhole systems — never real player homes.
const SYSTEMS = [
  'J164710', 'J100204', 'J215503', 'J055920', 'J133845', 'J170122',
  'J194471', 'J009388', 'J231607', 'J052741', 'J188390', 'J144025',
]

// ── real PI constraints ─────────────────────────────────────────────────────

// P1 product name → the P0 raw material it requires.
const P0_BY_P1 = new Map<string, number>()
for (const s of P0_TO_P1_SCHEMATICS) {
  const out = PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name
  if (out) P0_BY_P1.set(out, s.inputs[0].typeId)
}
// P0 typeId → planet types that can extract it.
const TYPES_BY_P0 = new Map<number, string[]>()
for (const [type, ids] of Object.entries(PLANET_RESOURCES))
  for (const id of ids) {
    if (!TYPES_BY_P0.has(id)) TYPES_BY_P0.set(id, [])
    TYPES_BY_P0.get(id)!.push(type)
  }
function planetTypesForP1(name: string): string[] {
  const p0 = P0_BY_P1.get(name)
  return (p0 != null ? TYPES_BY_P0.get(p0) : undefined) ?? ['barren']
}

// ── randomness helpers ──────────────────────────────────────────────────────

// Swappable RNG: defaults to Math.random for the "Randomize" buttons; the
// slider swaps in a seeded mulberry32 (set in generateEmpireByPlanets) so its
// output is deterministic and monotonic.
let _rng: () => number = Math.random
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = (n: number) => Math.floor(_rng() * n)
const pick = <T,>(a: readonly T[]): T => a[rand(a.length)]
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Minutes-from-now offsets, one per urgency band, so colors/timers are varied.
const EXPIRY_BANDS = [-15, 45, 240, 720, 1500]
const FACTORY_TYPES = ['barren', 'temperate', 'lava', 'gas', 'storm', 'plasma', 'ice', 'oceanic']

// ── chain expansion ─────────────────────────────────────────────────────────

// All manufactured products (P1..P4) in a target's dependency tree. Stops at P1
// (the extractor leaf — its P0 input is pulled from the planet, not hauled).
// De-duplicated within the chain, so a P1 feeding two factories yields ONE
// extractor with a split delivery rather than two.
function chainProducts(target: string): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  const visit = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    const prod = PRODUCT_BY_NAME.get(name)
    if (prod && prod.tier !== 'P1') {
      for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []) {
        const ip = PRODUCT_BY_NAME.get(inp)
        if (ip && ip.tier !== 'P0') visit(inp)
      }
    }
    order.push(name)
  }
  visit(target)
  return order
}

interface RawPlanet { product: string; tier: string; type: string; expiryMin?: number; extractorCount?: number; factoryCount?: number }

// All RNG-driven per-planet attributes are drawn HERE, during the (monotonic)
// raws-building pass, so that planet N is identical no matter how big the empire
// is — buildCharactersFromBuckets below makes zero further random draws. The
// `factoryCount` is NOT random: it's the rate-balanced count computed per chain
// (see facilityCounts), so a typical seeded empire runs mostly-healthy chains.
function makeRawPlanet(product: string, factoryCount: number): RawPlanet {
  const prod = PRODUCT_BY_NAME.get(product)!
  if (prod.tier === 'P1') {
    // A P1 planet runs an extractor (P0) AND basic-industry facilities (P0→P1);
    // factoryCount is what the chain model uses to scale P1 supply to demand.
    return {
      product, tier: prod.tier,
      type: pick(planetTypesForP1(product)),
      expiryMin: pick(EXPIRY_BANDS) + rand(30),
      extractorCount: 6 + rand(5),
      factoryCount,
    }
  }
  return { product, tier: prod.tier, type: pick(FACTORY_TYPES), factoryCount }
}

// ── rate-balancing ───────────────────────────────────────────────────────────
//
// The structural reason a naive 1-facility-per-planet empire looks all-broken:
// upstream tiers are nominally under-supplied (a P2 makes 5/cyc but a P3 eats
// 10/cyc of it, etc.). We fix it in the SEED (not the rate model) by sizing each
// product's factoryCount to its in-chain demand, so most chains run healthy.

const TIER_NUM: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }
// Realistic-ish ceiling on facilities per planet; clamps the rare heavily-shared
// feeder (clamping just yields a mild bottleneck, which is fine demo fuel).
const FACTORY_CAP = 14

// units/hr a single facility makes of `name` (output qty × cycles/hr).
function ratePerFacility(name: string): number {
  const prod = PRODUCT_BY_NAME.get(name)
  const sch = prod && SCHEMATIC_BY_OUTPUT.get(prod.typeId)
  return sch ? sch.output.quantity * (3600 / sch.cycleTime) : 1
}

// Deterministic string hash (FNV-1a) — used to sprinkle a few bottlenecks
// WITHOUT drawing from the monotonic main RNG stream.
function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

// A small, FIXED minority of P3 product TYPES that we deliberately under-build
// everywhere. Keyed on the product (not the chain instance) because the chain
// model POOLS all same-type production into one terminal row: keying on the
// instance would, at large empires, drag every pooled terminal below 1 (the
// "everything's broken" feeling we're killing). Keying on the type bottlenecks
// only the few terminals that consume these P3s — stable at every scale.
// hashStr % 7 === 0 selects ~3 of the 21 P3s.
function isStarvedFeeder(name: string): boolean {
  return PRODUCT_BY_NAME.get(name)?.tier === 'P3' && hashStr(name) % 7 === 0
}

// Rate-balance facility counts across ONE chain: the terminal runs at a single
// facility (sets the chain's base rate) and every upstream product gets just
// enough facilities to feed its in-chain consumers (supply ≈ demand ⇒ ratio 1
// ⇒ no bottleneck) — so a typical seeded empire runs mostly-healthy chains.
// The few starved-feeder P3 TYPES (isStarvedFeeder) are built to ~70% so the
// terminals consuming them show a genuine, non-broken bottleneck for the
// red-arrow styling. Pure function of the chain ⇒ deterministic + monotonic.
function facilityCounts(order: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  // Size highest tier first, so each consumer's count is known before we size
  // the products it consumes. Same-tier products never feed each other.
  const byTierDesc = [...order].sort((a, b) =>
    (TIER_NUM[PRODUCT_BY_NAME.get(b)?.tier ?? 'P1'] ?? 0) -
    (TIER_NUM[PRODUCT_BY_NAME.get(a)?.tier ?? 'P1'] ?? 0))

  for (const name of byTierDesc) {
    const prod = PRODUCT_BY_NAME.get(name)!
    // Demand on `name` = Σ over in-chain consumers of (input qty × their cycles/hr × their count).
    let demand = 0
    for (const consumer of order) {
      const csch = SCHEMATIC_BY_OUTPUT.get(PRODUCT_BY_NAME.get(consumer)!.typeId)
      const cf = counts.get(consumer) ?? 0
      if (!csch || cf === 0) continue
      for (const inp of csch.inputs) {
        if (inp.typeId === prod.typeId) demand += inp.quantity * (3600 / csch.cycleTime) * cf
      }
    }
    let f: number
    if (demand === 0) {
      f = 1 // terminal (nothing in-chain consumes it): one facility = base rate
    } else {
      const need = demand / ratePerFacility(name)
      f = isStarvedFeeder(name)
        ? Math.max(1, Math.floor(need * 0.7))  // ~70% ⇒ bottleneck on consuming terminals
        : Math.max(1, Math.ceil(need))
    }
    counts.set(name, Math.min(FACTORY_CAP, f))
  }
  return counts
}

// ── empire generation ───────────────────────────────────────────────────────

export interface EmpireStats { characters: number; planets: number; p4Products: string[] }

/**
 * Build a random empire sized to roughly `targetChars` maxed characters.
 * Adds whole P4 chains until that many characters' worth of planets exist,
 * distributes them across characters (mixing tiers so most run both extractors
 * and factories), then tops every character up to 6 planets with redundant
 * extractors. Returns the roster plus a few stats for the caller to surface.
 */
// Varied-but-realistic PI skills for alt #ci. Drawn from a PER-ALT seeded RNG
// (independent of the main raws stream) so an alt's skills are deterministic and
// stable as the empire grows. NOT all maxed: a producing alt is usually IC 4-5 /
// CCU 4-5, occasionally lower. IC drives the planet cap (1 + IC).
function skillsForAlt(ci: number): PISkillLevels {
  const r = mulberry32((SLIDER_SEED ^ ((ci + 1) * 0x9e3779b1)) >>> 0)
  const p = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  return {
    interplanetaryConsolidation: p([2, 3, 3, 4, 4, 4, 5, 5, 5, 5]),
    commandCenterUpgrades:       p([2, 3, 3, 4, 4, 5, 5]),
    remoteSensing:               p([0, 1, 2, 3, 4, 5]),
    planetology:                 p([1, 2, 3, 3, 4, 5]),
    advancedPlanetology:         p([0, 0, 1, 2, 3, 4]),
  }
}
const altCapacity = (ci: number) => 1 + skillsForAlt(ci).interplanetaryConsolidation

// Turn distributed buckets of raw planets into characters. Per-alt skills come
// from skillsForAlt(ci) (deterministic); no draws from the main RNG stream, so
// an empire of N planets stays a stable prefix of an empire of N+1.
function buildCharactersFromBuckets(buckets: RawPlanet[][]): { characters: StoredCharacter[]; planetTotal: number } {
  let pid = 1
  const characters = buckets.map((bucket, ci) => {
    const sys = SYSTEMS[ci % SYSTEMS.length]
    const planets: Planet[] = bucket.map((r, i) => {
      const prod = PRODUCT_BY_NAME.get(r.product)!
      return {
        planetId: pid++,
        systemId: 31000000 + ci,
        type: r.type,
        name: `${sys} ${ROMAN[(i % 8) + 1]}`,
        outputs: [prod.typeId],
        outputNames: [prod.name],
        outputTiers: [prod.tier],
        ccu: r.tier === 'P1' ? 19_600 : 17_900,
        extractorCount: r.extractorCount,
        factoryCount: r.factoryCount,
        expiryTime: r.expiryMin != null
          ? new Date(Date.now() + r.expiryMin * 60_000).toISOString()
          : undefined,
      }
    })
    return {
      characterId: 98_000_000 + ci * 13,
      characterName: NAMES[ci % NAMES.length],
      piSkills: skillsForAlt(ci),
      planets,
    }
  })
  return { characters, planetTotal: pid - 1 }
}

// Build a deterministic raw-planet list by adding whole P4 chains (cycling the
// shuffled pool, so heavy multiboxers' duplicate chains appear) until we reach
// the requested count, then trim to it. Trimming can clip the last chain — that
// leaves a realistically "broken" terminal, which is good readability-test fuel.
function buildRawsForPlanetCount(planetCount: number): RawPlanet[] {
  const pool = shuffle(P4_PRODUCTS.map(p => p.name))
  const raws: RawPlanet[] = []
  let i = 0
  while (raws.length < planetCount && i <= planetCount + pool.length) {
    const order = chainProducts(pool[i % pool.length])
    const counts = facilityCounts(order)
    for (const product of order) raws.push(makeRawPlanet(product, counts.get(product) ?? 1))
    i++
  }
  return raws.slice(0, planetCount)
}

// Fill alt 0 to its cap, then alt 1, … (auto alt count). Monotonic: each alt's
// cap is stable, so growing the planet count extends the last alt or adds one.
function sequentialBuckets(raws: RawPlanet[]): RawPlanet[][] {
  const buckets: RawPlanet[][] = []
  let idx = 0, ci = 0
  while (idx < raws.length) {
    const cap = altCapacity(ci)
    buckets.push(raws.slice(idx, idx + cap))
    idx += cap
    ci++
  }
  return buckets
}

// Spread raws as evenly as possible across a FIXED number of alts, never
// exceeding any alt's cap. Used when the user pins both alt + planet counts.
function roundRobinBuckets(raws: RawPlanet[], altCount: number): RawPlanet[][] {
  const buckets: RawPlanet[][] = Array.from({ length: altCount }, () => [])
  let ci = 0
  for (const r of raws) {
    let tries = 0
    while (buckets[ci % altCount].length >= altCapacity(ci % altCount) && tries < altCount) { ci++; tries++ }
    if (tries >= altCount) break // every alt is at capacity
    buckets[ci % altCount].push(r)
    ci++
  }
  return buckets
}

function statsFor(characters: StoredCharacter[], raws: RawPlanet[], planetTotal: number): EmpireStats {
  return {
    characters: characters.length,
    planets: planetTotal,
    p4Products: [...new Set(raws.slice(0, planetTotal).filter(r => r.tier === 'P4').map(r => r.product))],
  }
}

/**
 * Empire of (up to) `planetCount` planets across as many alts as needed, each
 * alt filled to its randomized capacity (1 + IC). Seeded ⇒ reproducible and
 * empire(N) is a prefix-superset of empire(N+1) — the dev slider grows ONE
 * stable empire.
 */
export function generateEmpireByPlanets(planetCount: number, seed = SLIDER_SEED): { characters: StoredCharacter[]; stats: EmpireStats } {
  const n = Math.max(1, Math.min(MAX_PLANETS, Math.floor(planetCount)))
  _rng = mulberry32(seed)
  const raws = buildRawsForPlanetCount(n)
  const { characters, planetTotal } = buildCharactersFromBuckets(sequentialBuckets(raws))
  return { characters, stats: statsFor(characters, raws, planetTotal) }
}

/**
 * Empire pinned to `altCount` alts and `planetCount` planets (each clamped to
 * range; planets also clamped to the alts' total randomized capacity). Planets
 * are spread evenly across the alts. Seeded ⇒ reproducible.
 */
export function generateEmpireByCounts(altCount: number, planetCount: number, seed = SLIDER_SEED): { characters: StoredCharacter[]; stats: EmpireStats } {
  const a = Math.max(1, Math.min(MAX_ALTS, Math.floor(altCount)))
  let capacity = 0
  for (let ci = 0; ci < a; ci++) capacity += altCapacity(ci)
  const p = Math.max(1, Math.min(MAX_PLANETS, capacity, Math.floor(planetCount)))
  _rng = mulberry32(seed)
  const raws = buildRawsForPlanetCount(p)
  const { characters, planetTotal } = buildCharactersFromBuckets(roundRobinBuckets(raws, a))
  return { characters, stats: statsFor(characters, raws, planetTotal) }
}

function writeStore(characters: StoredCharacter[]): void {
  const maxPid = Math.max(0, ...characters.flatMap(c => c.planets.map(p => p.planetId)))
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    characters,
    nextCharId: 98_001_000,
    nextPlanetId: maxPid + 1,
  }))
}

/** Seed an empire of (up to) `planetCount` planets and write it. Caller reloads. */
export function seedEmpireByPlanets(planetCount: number): EmpireStats {
  const { characters, stats } = generateEmpireByPlanets(planetCount)
  writeStore(characters)
  return stats
}

/** Seed an empire pinned to `altCount` alts + `planetCount` planets. Caller reloads. */
export function seedEmpireByCounts(altCount: number, planetCount: number): EmpireStats {
  const { characters, stats } = generateEmpireByCounts(altCount, planetCount)
  writeStore(characters)
  return stats
}

/** Wipe the store back to empty. Caller should reload the page. */
export function clearTestData(): void {
  localStorage.removeItem(STORAGE_KEY)
}
