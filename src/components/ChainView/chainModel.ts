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
  PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT, ALL_SCHEMATICS,
  type PITier, type PIProduct,
} from '../../data/schematics'

const TIER_RANK: Record<PITier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

// 'missing'  — a genuine gap: you build some of this input's own feeders but not
//              the input itself (a dangling, half-built sub-chain) ⇒ chain BROKEN.
// 'imported' — you produce none of this input's sub-chain ⇒ you buy/haul it in by
//              design (the classic factory-only setup). Assumed always available.
export type ProductStatus = 'terminal' | 'ok' | 'excess' | 'bottleneck' | 'missing' | 'imported'

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
          else { frac = 0; missing.push(ip.name) }
          continue
        }
        const inFlow = flows.get(inp.typeId)!
        frac = Math.min(frac, inFlow.ratio * (rFrac.get(inp.typeId) ?? 1))
      }
    }
    rFrac.set(tid, frac)
    const f = flows.get(tid)
    if (f) { f.realizedFraction = frac; f.missingInputs = missing; f.importedInputs = imported }
  }

  // Classify every flow.
  for (const f of flows.values()) {
    if (!producedTypeIds.has(f.typeId)) { f.status = isImported(f.typeId) ? 'imported' : 'missing'; continue }
    if (f.demand === 0) { f.status = 'terminal'; continue }
    if (f.supply < f.demand * 0.999) f.status = 'bottleneck'
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
