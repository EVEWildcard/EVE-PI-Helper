// Chain-terminal model for the Production Chain (design v2, ISK-driven).
//
// Step 2 of the readability rework: a pure, testable model that — given the
// characters + market prices — enumerates each CHAIN TERMINAL (an end product
// nothing else you make consumes; usually P4s, but any PX you stop at and sell)
// and scores it in ISK terms. This is the data behind the future ISK-ranked
// chain-terminal LIST; no React, no DOM here.
//
// ── How the numbers work ────────────────────────────────────────────────────
// Per produced product we compute SUPPLY (units/hr made) and DEMAND (units/hr
// consumed by other things you produce). Supply is schematic rate × facilities,
// CAPPED by the planet's measured extractor yield when the ESI import provides
// it (planet.extractionRates) — a P1 line can't run faster than its extractors
// feed it, so the cap is what makes P1 supply real instead of nameplate.
// Demand stays nameplate: it's what the downstream factories WOULD consume at
// full duty, i.e. the ceiling supply is measured against.
//
// GOTCHA 0 (supply < demand is NORMAL): live PI is buffer-fed — factory planets
// are built to the max facilities that fit CPU/power and burn through hauled-in
// stockpiles, idling for free in between. So under-coverage isn't a fault per
// se; it's a throughput ceiling. The model reports it as a percentage and only
// flags it as an Issue below COVERAGE_ISSUE_THRESHOLD. Supply also only comes
// in whole planets, so fixes are quantized to "+1 planet of X".
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
  PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT, ALL_SCHEMATICS,
  type PITier, type PIProduct,
} from '../../data/schematics'

const TIER_RANK: Record<PITier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

// 'constrained' — ROOT CAUSE: this product's own supply doesn't cover demand and
//                 nothing upstream throttles it further. The only real fix is
//                 +1 producer planet; everything downstream inherits the limit.
// 'limited'    — throttled from upstream: this product could cover its demand
//                 (or at least its shortfall isn't its own fault first) — the
//                 binding constraint is `limitedBy`, somewhere below it.
// 'missing'  — a genuine gap: you build some of this input's own feeders but not
//              the input itself (a dangling, half-built sub-chain) ⇒ chain BROKEN.
// 'imported' — you produce none of this input's sub-chain ⇒ you buy/haul it in by
//              design (the classic factory-only setup). Assumed always available.
export type ProductStatus = 'terminal' | 'ok' | 'excess' | 'constrained' | 'limited' | 'missing' | 'imported'

export interface ProductFlow {
  typeId: number
  name: string
  tier: PITier
  supply: number            // units/hr produced across all your planets (extraction-capped where measured)
  demand: number            // nameplate units/hr consumed by other things you produce
  ratio: number             // availability = min(1, supply/demand); 1 when nothing consumes it
  realizedFraction: number  // rFrac — fraction of nameplate actually achievable given upstream
  status: ProductStatus
  producerKeys: string[]    // 'charId:planetId' of planets making this
  consumerCount: number     // planets that consume this as a direct input
  limitedBy?: string        // deepest upstream product capping rFrac (when rFrac < 1)
  missingInputs: string[]   // direct inputs that are a genuine gap (broken)
  importedInputs: string[]  // direct inputs you buy/haul in by design (not broken)
}

export interface TerminalChain {
  product: PIProduct
  price: number
  iskHrIntended: number        // ranking basis: nameplate capacity × price
  iskHrNow: number             // intended × realizedFraction ("0 now" when broken)
  realizedFraction: number
  broken: boolean              // a required input somewhere upstream is a genuine gap
  missingInputs: string[]      // product names that are a genuine gap (broken)
  importedInputs: string[]     // product names you source externally (buy/haul) by design
  bottleneck?: { name: string; ratio: number }  // scarcest produced input limiting throughput
  upstreamProducts: string[]   // produced product names feeding this terminal (excl. itself)
  producerKeys: string[]       // planets producing the terminal product
  chainPlanetCount: number     // distinct planets across the whole chain (terminal + all upstream)
  // "Just sell the inputs instead of producing this" — when the direct inputs are
  // worth more per hour at market than the finished product. deltaIskHr > 0.
  sellInstead?: { deltaIskHr: number; toSell: string[] }
  // "You could lengthen this chain to a higher PX" — a valid recipe consumes this
  // product and you have spare planet slots. Opportunity, not a full plan.
  canExtend?: { toProduct: string; toTier: PITier }
}

export interface ChainModel {
  terminals: TerminalChain[]        // ranked by iskHrIntended desc
  flows: Map<number, ProductFlow>   // every produced/required product, keyed by typeId
  importedNames: Set<string>        // products sourced externally by design (not gaps)
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

/**
 * Units/hr this planet makes of output `tid`: schematic rate × facilities,
 * capped by the measured extractor yield when the ESI import provides it — the
 * factories of a P1 planet can't run faster than its extractors pull P0.
 * (Shared with SetupView's ISK/hr estimate so both views tell the same story.)
 */
export function planetOutputRate(planet: Planet, tid: number): number {
  const sch = SCHEMATIC_BY_OUTPUT.get(tid)
  if (!sch) return 0
  const perHr = 3600 / sch.cycleTime
  let rate = sch.output.quantity * perHr * facilitiesFor(planet)
  const extraction = planet.extractionRates
  if (extraction) {
    for (const inp of sch.inputs) {
      const p0PerHr = extraction[inp.typeId]
      if (p0PerHr == null) continue
      const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
      if (!ip || ip.tier !== 'P0') continue
      // p0PerHr raw units feed input.quantity → output.quantity per cycle.
      rate = Math.min(rate, p0PerHr * (sch.output.quantity / inp.quantity))
    }
  }
  return rate
}

export function buildChainModel(characters: StoredCharacter[], prices: Record<number, number>): ChainModel {
  const supply = new Map<number, number>()        // typeId → units/hr produced
  const demand = new Map<number, number>()        // typeId → units/hr consumed (non-P0 inputs)
  const producerKeys = new Map<number, string[]>()
  const consumerKeys = new Map<number, Set<string>>()
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
      const pKey = planetKey(char.characterId, planet.planetId)
      for (const tid of planet.outputs ?? []) {
        const sch = SCHEMATIC_BY_OUTPUT.get(tid)
        if (!sch) continue
        const perHr = 3600 / sch.cycleTime
        supply.set(tid, (supply.get(tid) ?? 0) + planetOutputRate(planet, tid))
        const keys = producerKeys.get(tid) ?? []
        keys.push(pKey)
        producerKeys.set(tid, keys)
        for (const inp of sch.inputs) {
          const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
          if (!ip || ip.tier === 'P0') continue  // P0 is self-extracted, never hauled/missing
          demand.set(inp.typeId, (demand.get(inp.typeId) ?? 0) + inp.quantity * perHr * factories)
          const cons = consumerKeys.get(inp.typeId) ?? new Set<string>()
          cons.add(pKey)
          consumerKeys.set(inp.typeId, cons)
        }
      }
    }
  }

  // Is a non-produced input a genuine gap, or an intentional import?
  //
  // The signal of intent is whether you're building that input's supply yourself.
  // `producesAnyUpstream(X)` = you produce at least one product somewhere in X's
  // recipe sub-tree. If so, a missing X is a half-built chain you stopped short on
  // ⇒ BROKEN. If you produce none of X's sub-tree, you're not building X at all and
  // must be buying/hauling it in ⇒ IMPORTED (the factory-only setup). P0 inputs are
  // self-extracted and never count, so a missing P1 (sub-tree is only P0) is always
  // an import — there's no such thing as a "half-built" P1; you extract it or you buy it.
  const upstreamCache = new Map<number, boolean>()
  function producesAnyUpstream(tid: number): boolean {
    const cached = upstreamCache.get(tid)
    if (cached !== undefined) return cached
    upstreamCache.set(tid, false)  // guard against recipe cycles
    let result = false
    const sch = SCHEMATIC_BY_OUTPUT.get(tid)
    if (sch) {
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue
        if (producedTypeIds.has(inp.typeId) || producesAnyUpstream(inp.typeId)) { result = true; break }
      }
    }
    upstreamCache.set(tid, result)
    return result
  }
  /** A required-but-not-produced input: 'imported' (by design) vs 'missing' (broken gap). */
  const isImported = (tid: number) => !producesAnyUpstream(tid)
  const importedNames = new Set<string>()

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
      consumerCount: consumerKeys.get(tid)?.size ?? 0,
      missingInputs: [],
      importedInputs: [],
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
    // Deepest root cause of the binding constraint: a scarce input's own
    // limitedBy (already resolved — inputs run first in tier order) or, when the
    // input IS the root, its name. Fixes start there, so that's what we point at.
    let limitedBy: string | undefined
    const missing: string[] = []
    const imported: string[] = []
    if (sch) {
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue
        if (!producedTypeIds.has(inp.typeId)) {
          // Imported inputs are assumed available (bought/hauled) — they don't break
          // or throttle the chain; only a genuine gap forces realized fraction to 0.
          if (isImported(inp.typeId)) { imported.push(ip.name); importedNames.add(ip.name) }
          else if (frac > 0) { frac = 0; missing.push(ip.name); limitedBy = ip.name }
          else missing.push(ip.name)
          continue
        }
        const inFlow = flows.get(inp.typeId)!
        const avail = inFlow.ratio * (rFrac.get(inp.typeId) ?? 1)
        if (avail < frac) { frac = avail; limitedBy = inFlow.limitedBy ?? inFlow.name }
      }
    }
    rFrac.set(tid, frac)
    const f = flows.get(tid)
    if (f) {
      f.realizedFraction = frac
      f.missingInputs = missing
      f.importedInputs = imported
      if (frac < 0.999 && limitedBy) f.limitedBy = limitedBy
    }
  }

  // Classify every flow. Upstream throttling ('limited') wins over the flow's own
  // supply/demand balance: the first fix is always at the root, not here.
  for (const f of flows.values()) {
    if (!producedTypeIds.has(f.typeId)) { f.status = isImported(f.typeId) ? 'imported' : 'missing'; continue }
    if (f.demand === 0) { f.status = 'terminal'; continue }
    if (f.realizedFraction < 0.999 && f.limitedBy) f.status = 'limited'
    else if (f.supply < f.demand * 0.999) f.status = 'constrained'
    else if (f.supply > f.demand * 1.001) f.status = 'excess'
    else f.status = 'ok'
  }

  // For "can-extend": which products consume each product as a direct input.
  const consumersByInput = new Map<number, number[]>()
  for (const sch of ALL_SCHEMATICS) {
    for (const inp of sch.inputs) {
      const arr = consumersByInput.get(inp.typeId) ?? []
      arr.push(sch.output.typeId)
      consumersByInput.set(inp.typeId, arr)
    }
  }
  // Spare planet capacity across the empire (free slots + colonized-but-empty planets).
  let totalSpareSlots = 0
  for (const char of characters) {
    const maxPlanets = 1 + (char.piSkills?.interplanetaryConsolidation ?? 0)
    const empty = char.planets.filter(p => (p.outputs?.length ?? 0) === 0).length
    totalSpareSlots += Math.max(0, maxPlanets - char.planets.length) + empty
  }

  // Terminals = produced products nothing else you produce consumes.
  const terminals: TerminalChain[] = []
  for (const tid of producedTypeIds) {
    const prod = PRODUCT_BY_TYPE_ID.get(tid)
    if (!prod || prod.tier === 'P0') continue
    if ((demand.get(tid) ?? 0) > 0) continue

    const upstream = new Set<number>()
    const missing = new Set<string>()
    const imported = new Set<string>()
    let bottleneck: { name: string; ratio: number } | undefined

    const visit = (t: number) => {
      const sch = SCHEMATIC_BY_OUTPUT.get(t)
      if (!sch) return
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue
        if (!producedTypeIds.has(inp.typeId)) {
          // Stop at this sourcing leaf: an imported product is bought finished, so its
          // own sub-inputs aren't ours to track.
          if (isImported(inp.typeId)) imported.add(ip.name)
          else missing.add(ip.name)
          continue
        }
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
    const sch = SCHEMATIC_BY_OUTPUT.get(tid)

    // Sell-instead: would the direct inputs fetch more per hour than the output?
    let sellInstead: TerminalChain['sellInstead']
    if (sch && price > 0) {
      const runsHr = sch.output.quantity > 0 ? s / sch.output.quantity : 0
      let inputsValueHr = 0
      let allPriced = true
      const toSell: string[] = []
      for (const inp of sch.inputs) {
        const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
        if (!ip || ip.tier === 'P0') continue  // P0 has no relevant market sell value here
        const ipPrice = prices[inp.typeId] ?? 0
        if (!ipPrice) { allPriced = false; break }
        inputsValueHr += inp.quantity * runsHr * ipPrice
        toSell.push(ip.name)
      }
      const outputValueHr = s * price
      if (allPriced && inputsValueHr > outputValueHr) {
        sellInstead = { deltaIskHr: inputsValueHr - outputValueHr, toSell }
      }
    }

    // Can-extend: a higher-tier recipe consumes this product and you have spare slots.
    let canExtend: TerminalChain['canExtend']
    if (prod.tier !== 'P4' && totalSpareSlots > 0) {
      const candidate = (consumersByInput.get(tid) ?? [])
        .map(outTid => PRODUCT_BY_TYPE_ID.get(outTid))
        .filter((p): p is PIProduct => !!p && TIER_RANK[p.tier] > TIER_RANK[prod.tier])
        .sort((a, b) => (prices[b.typeId] ?? 0) - (prices[a.typeId] ?? 0))[0]
      if (candidate) canExtend = { toProduct: candidate.name, toTier: candidate.tier }
    }

    terminals.push({
      product: prod,
      price,
      iskHrIntended: s * price,
      iskHrNow: s * frac * price,
      realizedFraction: frac,
      broken: frac === 0,
      missingInputs: [...missing],
      importedInputs: [...imported],
      bottleneck,
      upstreamProducts: [...upstream].map(t => PRODUCT_BY_TYPE_ID.get(t)!.name),
      producerKeys: producerKeys.get(tid) ?? [],
      chainPlanetCount: (() => {
        const keys = new Set(producerKeys.get(tid) ?? [])
        for (const utid of upstream) for (const k of producerKeys.get(utid) ?? []) keys.add(k)
        return keys.size
      })(),
      ...(sellInstead ? { sellInstead } : {}),
      ...(canExtend ? { canExtend } : {}),
    })
  }

  terminals.sort((a, b) => b.iskHrIntended - a.iskHrIntended || a.product.name.localeCompare(b.product.name))

  return { terminals, flows, importedNames }
}

// ── Balance hints (the "Issues" panel) ──────────────────────────────────────
// Derived from the flow model, not planet counts: an Issue is a ROOT supply
// limit ('constrained' — fixing anything downstream of it is pointless) whose
// coverage is low enough to matter. Coverage between the threshold and 100% is
// the normal state of buffer-fed PI (factory planets are deliberately oversized
// and idle for free between hauls), so it stays off the Issues list — the node's
// own percentage already tells the story.

export interface BalanceHint {
  type: 'bottleneck' | 'excess'
  productName: string
  producers: number     // planets producing this
  consumers: number     // planets consuming this as input
  coverage?: number     // supply / demand (bottlenecks only)
  afterAdd?: number     // coverage with one more producer planet of the same avg size
}

/** Below this coverage a supply limit becomes an Issue; above it, it's just PI. */
export const COVERAGE_ISSUE_THRESHOLD = 0.8

export function computeBalanceHints(model: ChainModel): BalanceHint[] {
  const hints: BalanceHint[] = []
  for (const f of model.flows.values()) {
    if (f.status === 'constrained') {
      const coverage = f.supply / f.demand
      if (coverage >= COVERAGE_ISSUE_THRESHOLD) continue
      const producers = f.producerKeys.length
      hints.push({
        type: 'bottleneck', productName: f.name,
        producers, consumers: f.consumerCount,
        coverage,
        // Supply comes in whole planets — the only real move is +1 producer.
        ...(producers > 0 ? { afterAdd: coverage * (producers + 1) / producers } : {}),
      })
    } else if (f.status === 'excess') {
      hints.push({ type: 'excess', productName: f.name, producers: f.producerKeys.length, consumers: f.consumerCount })
    }
  }
  // Bottlenecks first (they cap your output), scarcest first; excess is the
  // lesser evil (surplus sells), most oversupplied first.
  return hints.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'bottleneck' ? -1 : 1
    if (a.type === 'bottleneck') return (a.coverage ?? 1) - (b.coverage ?? 1)
    return b.producers - b.consumers - (a.producers - a.consumers)
  })
}
