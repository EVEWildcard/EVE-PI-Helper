import { describe, it, expect } from 'vitest'
import type { Planet } from './types/api'
import { selfSuppliedInputTypeIds, selfSuppliedInputNames, hasExtractors } from './selfContained'

// From issue #80's anonymized snapshot.

// Planet 1: Mechanical Parts (3689) ← Precious Metals (2399) + Reactive Metals (2398).
// Extracts Base Metals (2267 → Reactive Metals) + Noble Metals (2270 → Precious Metals).
const mechParts: Planet = {
  planetId: 1, type: 'barren', name: 'Planet 1',
  outputs: [3689], outputNames: ['Mechanical Parts'], outputTiers: ['P2'],
  extractorCount: 2, factoryCount: 9,
  extractionRates: { 2267: 14002, 2270: 16672 },
}

// Planet 15: Miniature Electronics (9842) ← Silicon (9828) + Chiral Structures (2401).
// Extracts Non-CS Crystals (2306 → Chiral Structures) + Felsic Magma (2307 → Silicon).
const miniElectronics: Planet = {
  planetId: 15, type: 'lava', name: 'Planet 3',
  outputs: [9842], outputNames: ['Miniature Electronics'], outputTiers: ['P2'],
  extractorCount: 2, factoryCount: 9,
  extractionRates: { 2306: 18700, 2307: 11500 },
}

// Planet 11: pure factory (Biocells/Superconductors/Oxides), zero extractors — imports its P1s.
const pureFactory: Planet = {
  planetId: 11, type: 'barren', name: 'Planet 5',
  outputs: [2329, 9838, 2317], outputNames: ['Biocells', 'Superconductors', 'Oxides'],
  outputTiers: ['P2', 'P2', 'P2'], extractorCount: 0, factoryCount: 24,
}

// Planet 7: a P1 extractor planet (Biofuels).
const p1Extractor: Planet = {
  planetId: 7, type: 'barren', name: 'Planet 1',
  outputs: [2396], outputNames: ['Biofuels'], outputTiers: ['P1'],
  extractorCount: 1, factoryCount: 8, extractionRates: { 2288: 35090 },
}

describe('selfSuppliedInputTypeIds', () => {
  it('marks both P1 inputs of a self-contained P2 planet as locally made', () => {
    expect(selfSuppliedInputTypeIds(mechParts)).toEqual(new Set([2399, 2398]))
    expect(selfSuppliedInputNames(mechParts)).toEqual(new Set(['Precious Metals', 'Reactive Metals']))
  })

  it('handles a second self-contained P2 (Miniature Electronics)', () => {
    expect(selfSuppliedInputNames(miniElectronics)).toEqual(new Set(['Silicon', 'Chiral Structures']))
  })

  it('returns nothing for a pure factory planet (no extractionRates)', () => {
    expect(selfSuppliedInputTypeIds(pureFactory).size).toBe(0)
  })

  it('returns nothing for a P1 extractor (its output has no P1 inputs to self-supply)', () => {
    expect(selfSuppliedInputTypeIds(p1Extractor).size).toBe(0)
  })

  it('marks only the extracted side when a P2 extracts one P1 and imports the other', () => {
    // Mechanical Parts but extracting only Base Metals (2267 → Reactive Metals);
    // Precious Metals (needs Noble Metals 2270) must be imported.
    const partial: Planet = { ...mechParts, extractionRates: { 2267: 14002 } }
    expect(selfSuppliedInputNames(partial)).toEqual(new Set(['Reactive Metals']))
  })
})

describe('hasExtractors', () => {
  it('is true for a self-contained P2 planet', () => {
    expect(hasExtractors(mechParts)).toBe(true)
  })
  it('is true for a P1 extractor', () => {
    expect(hasExtractors(p1Extractor)).toBe(true)
  })
  it('is false for a pure factory', () => {
    expect(hasExtractors(pureFactory)).toBe(false)
  })
})
