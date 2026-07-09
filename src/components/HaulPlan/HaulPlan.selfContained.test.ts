import { describe, it, expect } from 'vitest'
import type { StoredCharacter } from '../../types/api'
import { computeSteps } from './HaulPlan'

// Regression for issue #80: self-contained P2 planets were (1) omitted from the
// reset list and (2) told to import a P1 they already extract on-planet.

const skills = {
  commandCenterUpgrades: 5, interplanetaryConsolidation: 5,
  remoteSensing: 4, planetology: 5, advancedPlanetology: 3,
}

const characters: StoredCharacter[] = [
  {
    characterId: 1, characterName: 'Alt 1', piSkills: skills,
    planets: [{
      planetId: 1, type: 'barren', name: 'P1',
      outputs: [3689], outputNames: ['Mechanical Parts'], outputTiers: ['P2'],
      extractorCount: 2, factoryCount: 9, extractionRates: { 2267: 14002, 2270: 16672 },
      expiryTime: '2999-01-01T00:00:00Z',
    }],
  },
  {
    characterId: 2, characterName: 'Alt 2', piSkills: skills,
    planets: [{
      planetId: 9, type: 'barren', name: 'P9',
      outputs: [2399], outputNames: ['Precious Metals'], outputTiers: ['P1'],
      extractorCount: 2, factoryCount: 8, extractionRates: { 2270: 38650 },
      expiryTime: '2999-01-01T00:00:00Z',
    }],
  },
]

describe('computeSteps — self-contained P2 chains (issue #80)', () => {
  const steps = computeSteps(characters, Date.parse('2026-07-08T00:00:00Z'))
  const alt1 = steps.find(s => s.char.characterId === 1 && !s.isReturn)!

  it('lists the self-contained P2 planet as an extractor to reset', () => {
    expect(alt1.resets.some(r => r.planet.planetId === 1)).toBe(true)
    const reset = alt1.resets.find(r => r.planet.planetId === 1)!
    expect(reset.products).toEqual([{ name: 'Mechanical Parts', tier: 'P2' }])
  })

  it('does not tell the self-contained planet to import Precious Metals', () => {
    const stop = alt1.stops.find(s => s.planet.planetId === 1)
    const materials = stop?.inputs.map(i => i.material) ?? []
    expect(materials).not.toContain('Precious Metals')
    // Nothing needs hauling into a fully self-contained planet.
    expect(alt1.stops.some(s => s.planet.planetId === 1)).toBe(false)
  })
})
