// Self-contained production chains.
//
// A planet whose extractors pull the P0 that feeds its own P2 (extract → P1 →
// P2, all on one planet) needs NO hauled inputs — the intermediate P1s are made
// locally. The app stores only a planet's FINAL output (single-output model), so
// the only surviving evidence of the internal P1 step is `extractionRates` (the
// P0 typeIds the planet extracts). Every consumer that reasons about imports,
// deliveries or bottlenecks must consult it, or it mistakes a closed-loop planet
// for a factory that imports its P1s.
//
// The rule is per-input, not per-planet: an output's P1 input is self-supplied
// iff EVERY P0 feeding that P1 is extracted on this planet. That also handles the
// mixed case (extract one P1, import the other) correctly — only the extracted
// side is treated as local.

import type { Planet } from './types/api'
import { PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT } from './data/schematics'

/**
 * Type IDs of this planet's outputs' P1 inputs that the planet extracts and
 * refines itself (so they need no hauling / aren't imports). Empty when the
 * planet has no measured extraction (a pure factory that imports everything).
 */
export function selfSuppliedInputTypeIds(planet: Planet): Set<number> {
  const result = new Set<number>()
  const extraction = planet.extractionRates
  if (!extraction) return result
  const extractedP0 = new Set(Object.keys(extraction).map(Number))

  for (const outTid of planet.outputs ?? []) {
    const sch = SCHEMATIC_BY_OUTPUT.get(outTid)
    if (!sch) continue
    for (const inp of sch.inputs) {
      const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
      if (!ip || ip.tier === 'P0') continue
      // The input is self-made here iff every P0 in its own recipe is extracted
      // on this planet.
      const inSch = SCHEMATIC_BY_OUTPUT.get(inp.typeId)
      if (!inSch) continue
      const p0Inputs = inSch.inputs.filter(i => PRODUCT_BY_TYPE_ID.get(i.typeId)?.tier === 'P0')
      if (p0Inputs.length > 0 && p0Inputs.every(i => extractedP0.has(i.typeId))) {
        result.add(inp.typeId)
      }
    }
  }
  return result
}

/** Same as {@link selfSuppliedInputTypeIds} but keyed by product NAME. */
export function selfSuppliedInputNames(planet: Planet): Set<string> {
  const names = new Set<string>()
  for (const tid of selfSuppliedInputTypeIds(planet)) {
    const p = PRODUCT_BY_TYPE_ID.get(tid)
    if (p) names.add(p.name)
  }
  return names
}

/** Does this planet run any extractor programs (needs periodic resets)? True for
    a self-contained P2 planet even though its output tier is P2, not P1. */
export function hasExtractors(planet: Planet): boolean {
  return (planet.extractorCount ?? 0) > 0 ||
    (!!planet.extractionRates && Object.keys(planet.extractionRates).length > 0)
}
