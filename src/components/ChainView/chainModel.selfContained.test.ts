import { describe, it, expect } from 'vitest'
import type { StoredCharacter } from '../../types/api'
import { buildChainModel, computeBalanceHints } from './chainModel'

// Regression for issue #80: self-contained P2 planets (extract → P1 → P2 on one
// planet) were treated as factories importing their P1s.

const skills = {
  commandCenterUpgrades: 5, interplanetaryConsolidation: 5,
  remoteSensing: 4, planetology: 5, advancedPlanetology: 3,
}

// Alt1: Mechanical Parts (P2), self-extracting Base Metals (2267) + Noble Metals (2270).
// Alt2: a standalone Precious Metals (P1) producer + a pure factory planet.
const characters: StoredCharacter[] = [
  {
    characterId: 1, characterName: 'Alt 1', piSkills: skills,
    planets: [{
      planetId: 1, type: 'barren', name: 'P1',
      outputs: [3689], outputNames: ['Mechanical Parts'], outputTiers: ['P2'],
      extractorCount: 2, factoryCount: 9, extractionRates: { 2267: 14002, 2270: 16672 },
    }],
  },
  {
    characterId: 2, characterName: 'Alt 2', piSkills: skills,
    planets: [
      {
        planetId: 9, type: 'barren', name: 'P9',
        outputs: [2399], outputNames: ['Precious Metals'], outputTiers: ['P1'],
        extractorCount: 2, factoryCount: 8, extractionRates: { 2270: 38650 },
      },
    ],
  },
]

describe('buildChainModel — self-contained P2 chains (issue #80)', () => {
  const model = buildChainModel(characters, {})

  it('does not label the self-made P1 inputs as imports', () => {
    expect(model.importedNames.has('Reactive Metals')).toBe(false)
    expect(model.importedNames.has('Precious Metals')).toBe(false)
  })

  it('Mechanical Parts is a clean terminal with no imported/missing inputs', () => {
    const mech = model.terminals.find(t => t.product.name === 'Mechanical Parts')
    expect(mech).toBeDefined()
    expect(mech!.importedInputs).toEqual([])
    expect(mech!.missingInputs).toEqual([])
    expect(mech!.broken).toBe(false)
    // Only its own planet — no phantom upstream P1 planets pulled in.
    expect(mech!.chainPlanetCount).toBe(1)
  })

  it('Reactive Metals (self-made only) produces no flow node at all', () => {
    expect(model.flows.has(2398)).toBe(false)
  })

  it('does not raise a false Precious Metals bottleneck', () => {
    // Demand from the self-contained planet must not count against Alt2's
    // standalone Precious Metals supply.
    const hints = computeBalanceHints(model)
    expect(hints.some(h => h.productName === 'Precious Metals' && h.type === 'bottleneck')).toBe(false)
  })
})
