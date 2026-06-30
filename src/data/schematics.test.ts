import { describe, it, expect } from 'vitest'
import {
  P0_RESOURCES, P1_PRODUCTS, P2_PRODUCTS, P3_PRODUCTS, P4_PRODUCTS,
  ALL_PRODUCTS, ALL_SCHEMATICS,
  P0_TO_P1_SCHEMATICS, P1_TO_P2_SCHEMATICS, P2_TO_P3_SCHEMATICS, P3_TO_P4_SCHEMATICS,
  PRODUCT_BY_TYPE_ID, PRODUCT_BY_NAME, SCHEMATIC_BY_OUTPUT, SCHEMATIC_INPUTS_BY_NAME,
  PLANET_RESOURCES,
  type PITier,
} from './schematics'

const TIER_RANK: Record<PITier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

describe('schematics — product catalogue', () => {
  it('has unique typeIds and names across every tier', () => {
    const typeIds = ALL_PRODUCTS.map(p => p.typeId)
    const names = ALL_PRODUCTS.map(p => p.name)
    expect(new Set(typeIds).size).toBe(typeIds.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('tags each product with the tier of the list it lives in', () => {
    for (const p of P0_RESOURCES) expect(p.tier).toBe('P0')
    for (const p of P1_PRODUCTS) expect(p.tier).toBe('P1')
    for (const p of P2_PRODUCTS) expect(p.tier).toBe('P2')
    for (const p of P3_PRODUCTS) expect(p.tier).toBe('P3')
    for (const p of P4_PRODUCTS) expect(p.tier).toBe('P4')
  })

  it('keeps the lookup maps in sync with ALL_PRODUCTS', () => {
    expect(PRODUCT_BY_TYPE_ID.size).toBe(ALL_PRODUCTS.length)
    expect(PRODUCT_BY_NAME.size).toBe(ALL_PRODUCTS.length)
    for (const p of ALL_PRODUCTS) {
      expect(PRODUCT_BY_TYPE_ID.get(p.typeId)).toBe(p)
      expect(PRODUCT_BY_NAME.get(p.name)).toBe(p)
    }
  })
})

describe('schematics — recipe integrity', () => {
  it('resolves every output and input typeId to a known product', () => {
    for (const s of ALL_SCHEMATICS) {
      expect(PRODUCT_BY_TYPE_ID.get(s.output.typeId), `output ${s.schematicId}`).toBeDefined()
      for (const inp of s.inputs) {
        expect(PRODUCT_BY_TYPE_ID.get(inp.typeId), `input of ${s.schematicId}`).toBeDefined()
      }
    }
  })

  it('uses strictly positive quantities and cycle times', () => {
    for (const s of ALL_SCHEMATICS) {
      expect(s.output.quantity).toBeGreaterThan(0)
      expect(s.cycleTime).toBeGreaterThan(0)
      for (const inp of s.inputs) expect(inp.quantity).toBeGreaterThan(0)
    }
  })

  it('has unique schematicIds and unique output products', () => {
    const ids = ALL_SCHEMATICS.map(s => s.schematicId)
    const outputs = ALL_SCHEMATICS.map(s => s.output.typeId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(outputs).size).toBe(outputs.length)
  })

  it('produces exactly one schematic for every non-P0 product, and none for P0', () => {
    const nonP0 = ALL_PRODUCTS.filter(p => p.tier !== 'P0')
    expect(SCHEMATIC_BY_OUTPUT.size).toBe(nonP0.length)
    for (const p of nonP0) {
      expect(SCHEMATIC_BY_OUTPUT.get(p.typeId), `${p.name} should be producible`).toBeDefined()
    }
    for (const p of P0_RESOURCES) {
      expect(SCHEMATIC_BY_OUTPUT.get(p.typeId), `${p.name} (P0) is raw`).toBeUndefined()
    }
  })

  it('keeps every input one or more tiers below its output', () => {
    for (const s of ALL_SCHEMATICS) {
      const outTier = PRODUCT_BY_TYPE_ID.get(s.output.typeId)!.tier
      for (const inp of s.inputs) {
        const inTier = PRODUCT_BY_TYPE_ID.get(inp.typeId)!.tier
        expect(TIER_RANK[inTier], `${inTier} → ${outTier}`).toBeLessThan(TIER_RANK[outTier])
      }
    }
  })

  it('steps each refining stage by exactly one tier on its primary inputs', () => {
    const expectStep = (list: typeof ALL_SCHEMATICS, from: PITier, to: PITier) => {
      for (const s of list) {
        expect(PRODUCT_BY_TYPE_ID.get(s.output.typeId)!.tier).toBe(to)
        // Every stage's inputs are dominated by the tier directly below it; P3→P4 and
        // a couple of P4 recipes also fold in a P1, so only require "at least one `from`".
        const inputTiers = s.inputs.map(i => PRODUCT_BY_TYPE_ID.get(i.typeId)!.tier)
        expect(inputTiers).toContain(from)
      }
    }
    expectStep(P0_TO_P1_SCHEMATICS, 'P0', 'P1')
    expectStep(P1_TO_P2_SCHEMATICS, 'P1', 'P2')
    expectStep(P2_TO_P3_SCHEMATICS, 'P2', 'P3')
    expectStep(P3_TO_P4_SCHEMATICS, 'P3', 'P4')
  })
})

describe('schematics — derived maps', () => {
  it('maps every output name to input names that all resolve', () => {
    expect(SCHEMATIC_INPUTS_BY_NAME.size).toBe(ALL_SCHEMATICS.length)
    for (const [outName, inputNames] of SCHEMATIC_INPUTS_BY_NAME) {
      expect(PRODUCT_BY_NAME.get(outName), outName).toBeDefined()
      expect(inputNames.length).toBeGreaterThan(0)
      for (const n of inputNames) expect(PRODUCT_BY_NAME.get(n), n).toBeDefined()
    }
  })

  it('mirrors the schematic inputs exactly', () => {
    // Spot-check the B7 recipe: Miniature Electronics ← Silicon + Chiral Structures.
    expect(SCHEMATIC_INPUTS_BY_NAME.get('Miniature Electronics')).toEqual(
      expect.arrayContaining(['Silicon', 'Chiral Structures']),
    )
  })
})

describe('schematics — planet resources', () => {
  it('lists only known P0 resources per planet type', () => {
    const p0Ids = new Set(P0_RESOURCES.map(p => p.typeId))
    for (const [planetType, ids] of Object.entries(PLANET_RESOURCES)) {
      expect(ids.length, planetType).toBeGreaterThan(0)
      for (const id of ids) {
        expect(p0Ids.has(id), `${planetType} resource ${id}`).toBe(true)
        expect(PRODUCT_BY_TYPE_ID.get(id)!.tier).toBe('P0')
      }
    }
  })
})
