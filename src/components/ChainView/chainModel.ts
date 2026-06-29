// Chain-terminal model for the Production Chain (design v2, ISK-driven).
//
// Step 2 of the readability rework: a pure, testable model that — given the
// characters + market prices — enumerates each CHAIN TERMINAL (an end product
// nothing else you make consumes; usually P4s, but any PX you stop at and sell)
// and scores it in ISK terms. This is the data behind the future ISK-ranked
// chain-terminal LIST; no React, no DOM here.
//
// ── How the numbers work ────────────────────────────────────────────────────
// Per produced product we compute nameplate SUPPLY (units/hr made) and DEMAND
// (units/hr consumed by other things you produce), using the same per-planet
// rate estimate as SetupView (schematic rate × facilities; P1 extractors → 1).
//
// GOTCHA 1 (shared inputs = DAG): a P1 can feed two terminals, so naive summing
// double-counts. The fix is to split a shared producer's output among consumers
// proportionally to demand (the v1.6.0 deposit-split rule). That split reduces
// algebraically to a single per-product availability = min(1, supply/demand):
// every consumer of a scarce input can run at that same fraction, which is
// exactly "fair share by demand". We then propagate a REALIZED FRACTION bottom
// up (P1→P4): rFrac(P) = min over its produced inputs of availability(input) ×
// rFrac(input). A strictly missing input ⇒ rFrac 0 (the chain is BROKEN).
//
// RANKING RULE: rank by INTENDED ISK/hr (terminal nameplate capacity × price) —
// honest even for a broken-but-fixable chain, since fixing the gap would let the
// installed terminal capacity run. `iskHrNow` (= intended × rFrac) shows the
// "0 now" reality alongside it. Strategic alternatives (sell-instead) are step 3
// deltas, never a re-rank.
//
// NOTE (single-pass approximation): we do NOT iterate the equilibrium where a
// throttled consumer frees up a shared input for its siblings. For ranking +
// broken/bottleneck flagging this is honest and stable; revisit if step 3 needs
// exact steady-state flow.

import type { StoredCharacter, Planet } from '../../types/api'
import {
  PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT,
  type PITier, type PIProduct,
} from '../../data/schematics'

const TIER_RANK: Record<PITier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

export type ProductStatus = 'terminal' | 'ok' | 'excess' | 'bottleneck' | 'missing'

export interface ProductFlow {
  typeId: number
  name: string
  tier: PITier
  supply: number            // nameplate units/hr produced across all your planets
  demand: number            // nameplate units/hr consumed by other things you produce
  ratio: number             // availability = min(1, supply/demand); 1 when nothing consumes it
  realizedFraction: number  // rFrac — fraction of nameplate actually achievable given upstream
  status: ProductStatus
  producerKeys: string[]    // 'charId:planetId' of planets making this
  missingInputs: string[]   // direct inputs this needs but you don't produce (non-P0)
}

export interface TerminalChain {
  product: PIProduct
  price: number
  iskHrIntended: number        // ranking basis: nameplate capacity × price
  iskHrNow: number             // intended × realizedFraction ("0 now" when broken)
  realizedFraction: number
  broken: boolean              // a required input somewhere upstream isn't produced
  missingInputs: string[]      // product names required upstream but not produced
  bottleneck?: { name: string; ratio: number }  // scarcest produced input limiting throughput
  upstreamProducts: string[]   // produced product names feeding this terminal (excl. itself)
  producerKeys: string[]       // planets producing the terminal product
}

export interface ChainModel {
  terminals: TerminalChain[]        // ranked by iskHrIntended desc
  flows: Map<number, ProductFlow>   // every produced/required product, keyed by typeId
}

/** Stable node key shared with the layout graph ('charId:planetId'). */
export function planetKey(characterId: number, planetId: number): string {
  return `${characterId}:${planetId}`
}

/** Facilities assumed for one of a planet's outputs — mirrors SetupView's estimate. */
function facilitiesFor(planet: Planet): number {
  const nOut = Math.max(1, (planet.outputs ?? []).length)
  return Math.max(1, Math.floor((planet.factoryCount ?? 1) / nOut))
}

export function buildChainModel(characters: StoredCharacter[], prices: Record<number, number>): ChainModel {
  const supply = new Map<number, number>()        // typeId → units/hr produced
  const demand = new Map<number, number>()        // typeId → units/hr consumed (non-P0 inputs)
  const producerKeys = new Map<number, string[]>()
  const producedTypeIds = new Set<number>()

  for (const char of characters) {
    for (const planet of char.planets) {
      for (const tid of planet.outputs ?? []) producedTypeIds.add(tid)
    }
  }

  // One pass: accumulate supply (from each output) and demand (on each input).
  for (const char of characters) {
    for (const planet of char.planets) {
      const factories = facilitiesFor(planet)
      for (const tid of planet.outputs ?? []) {
        const sch = SCHEMATIC_BY_OUTPUT.get(tid)
        if (!sch) continue
        const perHr = 3600 / sch.cycleTime
        supply.set(tid, (supply.get(tid) ?? 0) + sch.output.quantity * perHr * factories)
        const keys = producerKeys.get(tid) ?? []
        keys.push(planetKey(char.characterId, planet.planetId))
        producerKeys.set(tid, keys)
        for (const inp of sch.inputs) {
          const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
          if (!ip || ip.tier === 'P0') continue  // P0 is self-extracted, never hauled/missing
          demand.set(inp.typeId, (demand.get(inp.typeId) ?? 0) + inp.quantity * perHr * factories)
        }
      }
    }
  }

  // Build a flow record for every product that's either produced or required.
  const flows = new Map<number, ProductFlow>()
  for (const tid of new Set<number>([...supply.keys(), ...demand.keys()])) {
    const prod = PRODUCT_BY_TYPE_ID.get(tid)
    if (!prod || prod.tier === 'P0') continue
    const s = supply.get(tid) ?? 0
    const d = demand.get(tid) ?? 0
    flows.set(tid, {
      typeId: tid, name: prod.name, tier: prod.tier,
      supply: s, demand: d,
      ratio: d > 0 ? Math.min(1, s / d) : 1,
      realizedFraction: 0,
      status: 'ok',
      producerKeys: producerKeys.get(tid) ?? [],
      missingInputs: [],
    })
  }

  // Realized fraction, bottom-up (P1 → P4). A produced product runs at the min,
  // across its produced inputs, of availability(input) × rFrac(input); a missing
  // non-P0 input forces 0 (broken).
  const rFrac = new Map<number, number>()
  const producedNonP0 = [...producedTypeIds]
    .filter(t => { const p = PRODUCT_BY_TYPE_ID.get(t); return p && p.tier !== 'P0' })
    .sort((a, b) => TIER_RANK[PRODUCT_BY_TYPE_ID.get(a)!.tier] - TIER_RANK[PRODUCT_BY_TYPE_ID.get(b)!.tier])

  for (const tid of producedNonP0) {
    const sch = SCHEMATIC_BY_OUTPUT.get(tid)
    let frac = 1
    const missing: string[] = []
    if (sch) {
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue
        if (!producedTypeIds.has(inp.typeId)) { frac = 0; missing.push(ip.name); continue }
        const inFlow = flows.get(inp.typeId)!
        frac = Math.min(frac, inFlow.ratio * (rFrac.get(inp.typeId) ?? 1))
      }
    }
    rFrac.set(tid, frac)
    const f = flows.get(tid)
    if (f) { f.realizedFraction = frac; f.missingInputs = missing }
  }

  // Classify every flow.
  for (const f of flows.values()) {
    if (!producedTypeIds.has(f.typeId)) { f.status = 'missing'; continue }
    if (f.demand === 0) { f.status = 'terminal'; continue }
    if (f.supply < f.demand * 0.999) f.status = 'bottleneck'
    else if (f.supply > f.demand * 1.001) f.status = 'excess'
    else f.status = 'ok'
  }

  // Terminals = produced products nothing else you produce consumes.
  const terminals: TerminalChain[] = []
  for (const tid of producedTypeIds) {
    const prod = PRODUCT_BY_TYPE_ID.get(tid)
    if (!prod || prod.tier === 'P0') continue
    if ((demand.get(tid) ?? 0) > 0) continue

    const upstream = new Set<number>()
    const missing = new Set<string>()
    let bottleneck: { name: string; ratio: number } | undefined

    const visit = (t: number) => {
      const sch = SCHEMATIC_BY_OUTPUT.get(t)
      if (!sch) return
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue
        if (!producedTypeIds.has(inp.typeId)) { missing.add(ip.name); continue }
        if (upstream.has(inp.typeId)) continue
        upstream.add(inp.typeId)
        const fl = flows.get(inp.typeId)
        if (fl && fl.ratio < 1 && (!bottleneck || fl.ratio < bottleneck.ratio)) {
          bottleneck = { name: fl.name, ratio: fl.ratio }
        }
        visit(inp.typeId)
      }
    }
    visit(tid)

    const price = prices[tid] ?? 0
    const s = supply.get(tid) ?? 0
    const frac = rFrac.get(tid) ?? 1
    terminals.push({
      product: prod,
      price,
      iskHrIntended: s * price,
      iskHrNow: s * frac * price,
      realizedFraction: frac,
      broken: frac === 0,
      missingInputs: [...missing],
      bottleneck,
      upstreamProducts: [...upstream].map(t => PRODUCT_BY_TYPE_ID.get(t)!.name),
      producerKeys: producerKeys.get(tid) ?? [],
    })
  }

  terminals.sort((a, b) => b.iskHrIntended - a.iskHrIntended || a.product.name.localeCompare(b.product.name))

  return { terminals, flows }
}
