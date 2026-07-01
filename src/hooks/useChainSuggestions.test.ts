import { describe, it, expect } from 'vitest'
import type { Planet, StoredCharacter } from '../types/api'
import { DEFAULT_PI_SKILLS } from '../types/api'
import { PRODUCT_BY_NAME } from '../data/schematics'
import type { SystemPlanetsMap } from './useSystemPlanets'
import { computeChainSuggestions, computeBalanceHints, buildShortfallSuggestion } from './useChainSuggestions'

// ── fixture helpers ─────────────────────────────────────────────────────────
let pid = 1
function planet(name: string, outputs: string[]): Planet {
  return {
    planetId: pid++,
    type: 'barren',
    name,
    outputs: outputs.map(o => PRODUCT_BY_NAME.get(o)!.typeId),
    outputNames: outputs,
    outputTiers: outputs.map(o => PRODUCT_BY_NAME.get(o)!.tier),
  }
}
let cid = 1
function char(characterName: string, planets: Planet[], ic = 5): StoredCharacter {
  return {
    characterId: cid++,
    characterName,
    piSkills: { ...DEFAULT_PI_SKILLS, interplanetaryConsolidation: ic },
    planets,
  }
}
const NO_SYSTEMS: SystemPlanetsMap = new Map()

describe('computeChainSuggestions — guards', () => {
  it('returns nothing without characters', () => {
    expect(computeChainSuggestions([], { 1: 10 }, false, NO_SYSTEMS)).toEqual([])
  })
  it('returns nothing without prices', () => {
    const c = char('A', [planet('E', ['Silicon'])])
    expect(computeChainSuggestions([c], {}, false, NO_SYSTEMS)).toEqual([])
  })
})

describe('computeChainSuggestions — completion mode', () => {
  it('suggests the missing feeder for an incomplete high-tier chain', () => {
    // The alt makes Miniature Electronics (P2) and extracts Silicon, but nobody
    // produces the other required input (Chiral Structures) ⇒ the chain is
    // incomplete and the engine should surface Chiral as the prerequisite.
    const mini = PRODUCT_BY_NAME.get('Miniature Electronics')!
    const c = char('Maker', [
      planet('Ext', ['Silicon']),
      planet('Fac', ['Miniature Electronics']),
    ])
    const prices = { [mini.typeId]: 5000 }

    const out = computeChainSuggestions([c], prices, false, NO_SYSTEMS)

    expect(out.length).toBeGreaterThan(0)
    const s = out[0]
    expect(s.key.startsWith('complete:')).toBe(true)
    expect(s.prereqFor?.name).toBe('Miniature Electronics')
    expect(s.product.name).toBe('Chiral Structures')
    expect(s.chainSteps.some(st => st.produces === 'Chiral Structures')).toBe(true)
  })

  it('emits no completion suggestion once the chain is fully fed', () => {
    const mini = PRODUCT_BY_NAME.get('Miniature Electronics')!
    const c = char('Maker', [
      planet('Ext', ['Silicon', 'Chiral Structures']),
      planet('Fac', ['Miniature Electronics']),
    ])
    const out = computeChainSuggestions([c], { [mini.typeId]: 5000 }, false, NO_SYSTEMS)
    // No incomplete chain ⇒ no `complete:` suggestions (any output is a new-add).
    expect(out.every(s => !s.key.startsWith('complete:'))).toBe(true)
  })
})

describe('computeBalanceHints', () => {
  it('returns nothing for an empty empire', () => {
    expect(computeBalanceHints([])).toEqual([])
  })

  it('flags a P1 input as a bottleneck when consumers outnumber producers', () => {
    // One Silicon + one Chiral extractor feed TWO Miniature Electronics factories.
    const c = char('A', [
      planet('Esi', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('F1', ['Miniature Electronics']),
      planet('F2', ['Miniature Electronics']),
    ])
    const hints = computeBalanceHints([c])
    const silicon = hints.find(h => h.productName === 'Silicon')
    expect(silicon).toBeDefined()
    expect(silicon!.type).toBe('bottleneck')
    expect(silicon!.producers).toBe(1)
    expect(silicon!.consumers).toBe(2)
  })

  it('flags an over-produced input as excess', () => {
    // Two Silicon extractors, one consumer ⇒ Silicon is in excess.
    const c = char('A', [
      planet('Esi1', ['Silicon']),
      planet('Esi2', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('F1', ['Miniature Electronics']),
    ])
    const hints = computeBalanceHints([c])
    const silicon = hints.find(h => h.productName === 'Silicon')!
    expect(silicon.type).toBe('excess')
    expect(silicon.producers).toBe(2)
    expect(silicon.consumers).toBe(1)
  })

  it('ignores end products that nothing consumes', () => {
    const c = char('A', [
      planet('Esi', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('F1', ['Miniature Electronics']),
    ])
    const hints = computeBalanceHints([c])
    // Miniature Electronics is sold directly — not an imbalance.
    expect(hints.some(h => h.productName === 'Miniature Electronics')).toBe(false)
  })
})

describe('buildShortfallSuggestion', () => {
  it('builds a one-step extractor plan for a P1 shortfall', () => {
    // One Silicon extractor feeding two Miniature Electronics factories.
    const c = char('A', [
      planet('Esi', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('F1', ['Miniature Electronics']),
      planet('F2', ['Miniature Electronics']),
    ])
    const hint = computeBalanceHints([c]).find(h => h.productName === 'Silicon')!
    const s = buildShortfallSuggestion(hint, [c], {}, false, NO_SYSTEMS)

    expect(s).not.toBeNull()
    expect(s!.key).toBe(`shortfall:${PRODUCT_BY_NAME.get('Silicon')!.typeId}`)
    expect(s!.chainSteps).toHaveLength(1)
    expect(s!.chainSteps[0].role).toBe('extractor')
    expect(s!.chainSteps[0].produces).toBe('Silicon')
    expect(s!.shortfallOf).toEqual({ name: 'Silicon', currentProducers: 1, consumers: 2 })
  })

  it('builds a single factory step for a P2 shortfall whose inputs are all produced', () => {
    const c = char('A', [
      planet('Esi', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('Fme', ['Miniature Electronics']),
    ])
    const hint = { type: 'bottleneck' as const, productName: 'Miniature Electronics', producers: 1, consumers: 2 }
    const s = buildShortfallSuggestion(hint, [c], {}, false, NO_SYSTEMS)

    expect(s).not.toBeNull()
    expect(s!.chainSteps).toHaveLength(1)
    expect(s!.chainSteps[0].role).toBe('factory')
    expect(s!.chainSteps[0].produces).toBe('Miniature Electronics')
    expect(s!.chainSteps[0].factoryInputs).toEqual(expect.arrayContaining(['Silicon', 'Chiral Structures']))
  })

  it('also emits steps for genuinely missing sub-inputs of the short product', () => {
    // Miniature Electronics shortfall, but nobody extracts Chiral Structures.
    const c = char('A', [
      planet('Esi', ['Silicon']),
      planet('Fme', ['Miniature Electronics']),
    ])
    const hint = { type: 'bottleneck' as const, productName: 'Miniature Electronics', producers: 1, consumers: 2 }
    const s = buildShortfallSuggestion(hint, [c], {}, false, NO_SYSTEMS)

    expect(s).not.toBeNull()
    const produces = s!.chainSteps.map(st => st.produces)
    expect(produces).toContain('Chiral Structures')
    expect(produces).toContain('Miniature Electronics')
  })

  it('marks the plan blocked when no character has a free planet slot', () => {
    const c = char('A', [planet('Esi', ['Silicon'])], 0)  // IC 0 → max 1 planet, already used
    const hint = { type: 'bottleneck' as const, productName: 'Silicon', producers: 1, consumers: 2 }
    const s = buildShortfallSuggestion(hint, [c], {}, false, NO_SYSTEMS)

    expect(s).not.toBeNull()
    expect(s!.blocked).toBeDefined()
    expect(s!.blocked!.extraSlotsNeeded).toBe(1)
  })

  it('returns null for an unknown product', () => {
    const c = char('A', [planet('Esi', ['Silicon'])])
    const hint = { type: 'bottleneck' as const, productName: 'Not A Product', producers: 1, consumers: 2 }
    expect(buildShortfallSuggestion(hint, [c], {}, false, NO_SYSTEMS)).toBeNull()
  })
})
