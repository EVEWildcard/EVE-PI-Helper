import { describe, it, expect } from 'vitest'
import type { Planet, StoredCharacter } from '../../types/api'
import { DEFAULT_PI_SKILLS } from '../../types/api'
import { PRODUCT_BY_NAME } from '../../data/schematics'
import { computeSteps, deriveLoginOrder } from './HaulPlan'
import { validateDeliveryUsage } from './validateDeliveryUsage'

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
function char(characterName: string, planets: Planet[]): StoredCharacter {
  return { characterId: cid++, characterName, piSkills: { ...DEFAULT_PI_SKILLS }, planets }
}
const NOW = Date.UTC(2026, 5, 30)

describe('computeSteps — self-sufficient alt', () => {
  it('delivers its own inputs and deposits nothing when no one else consumes them', () => {
    const solo = char('Solo', [
      planet('Esi', ['Silicon']),
      planet('Ech', ['Chiral Structures']),
      planet('Fac', ['Miniature Electronics']),
    ])
    const steps = computeSteps([solo], NOW)

    expect(steps).toHaveLength(1)
    const s = steps[0]
    expect(s.deposits).toEqual([])

    const facStop = s.stops.find(st => st.planet.name === 'Fac')!
    expect(new Set(facStop.inputs.map(i => i.material))).toEqual(
      new Set(['Silicon', 'Chiral Structures']),
    )
    expect(facStop.inputs.every(i => i.self && i.ready)).toBe(true)
    expect(validateDeliveryUsage(steps)).toEqual([])
  })
})

describe('computeSteps — split deposit between consumers', () => {
  it('splits a shared P1 deposit proportionally across the two factories that need it', () => {
    const provider = char('Provider', [planet('Eox', ['Oxygen'])])
    const maker1 = char('Maker1', [planet('Fox', ['Oxides'])]) // Oxides ← Oxygen + Oxidizing
    const maker2 = char('Maker2', [planet('Fsp', ['Supertensile Plastics'])]) // ← Biomass + Oxygen

    const steps = computeSteps([provider, maker1, maker2], NOW)

    const providerStep = steps.find(s => s.char.characterName === 'Provider')!
    const oxygen = providerStep.deposits.find(d => d.material === 'Oxygen')!
    expect(new Set(oxygen.toNames)).toEqual(new Set(['Maker1', 'Maker2']))
    expect(oxygen.splits).toBeDefined()
    expect(oxygen.splits).toHaveLength(2)
    const total = oxygen.splits!.reduce((s, x) => s + x.share, 0)
    expect(total).toBeCloseTo(1, 5)
    // Even demand (both factories use 40 Oxygen/cycle) ⇒ 50/50.
    for (const sp of oxygen.splits!) expect(sp.share).toBeCloseTo(0.5, 5)

    expect(validateDeliveryUsage(steps)).toEqual([])
  })
})

describe('computeSteps — consumer that produces the material itself', () => {
  it('does not deposit a material for an alt that sources it from its own extractor', () => {
    // Both alts extract Oxygen; Maker also consumes it (Oxides ← Oxygen + Oxidizing).
    // Maker's delivery row is `self` ("from your own extractor"), so Provider must
    // NOT be told to leave Oxygen for Maker — it would sit unclaimed.
    const provider = char('Provider', [planet('Eox', ['Oxygen'])])
    const maker = char('Maker', [
      planet('Eox2', ['Oxygen']),
      planet('Fox', ['Oxides']),
    ])

    const steps = computeSteps([provider, maker], NOW)

    const providerStep = steps.find(s => s.char.characterName === 'Provider')!
    expect(providerStep.deposits).toEqual([])

    const makerStep = steps.find(s => s.char.characterName === 'Maker' && !s.isReturn)!
    const oxygen = makerStep.stops.flatMap(st => st.inputs).find(i => i.material === 'Oxygen')!
    expect(oxygen.self).toBe(true)

    expect(validateDeliveryUsage(steps)).toEqual([])
  })
})

describe('computeSteps — return visit for a deferred delivery', () => {
  it('schedules a return visit when an input is produced by a later (higher-tier) alt', () => {
    // Early makes Coolant (P2) ← Water (self) + Electrolytes. Late extracts the
    // Electrolytes but logs in later (it also makes a P3, so it sorts after Early),
    // so Early must come back once Late has dropped the Electrolytes.
    const early = char('Early', [
      planet('Ewa', ['Water']),
      planet('Fco', ['Coolant']),
    ])
    const late = char('Late', [
      planet('Eel', ['Electrolytes']),
      planet('Fro', ['Robotics']), // P3 ⇒ Late sorts after Early
    ])

    const steps = computeSteps([early, late], NOW)

    // Login order: Early (max P2) before Late (max P3).
    expect(deriveLoginOrder([early, late], NOW)).toEqual([early.characterId, late.characterId])

    // A return visit exists for Early.
    const ret = steps.find(s => s.isReturn && s.char.characterName === 'Early')
    expect(ret).toBeDefined()
    expect(ret!.id).toBe(`${early.characterId}:return`)

    // The deferred Electrolytes shows up on the return visit as a ready pickup from Late.
    const retInput = ret!.stops.flatMap(st => st.inputs).find(i => i.material === 'Electrolytes')!
    expect(retInput.ready).toBe(true)
    expect(retInput.fromName).toBe('Late')

    // ...and it is NOT on Early's primary visit (only the self-sourced Water is).
    const primary = steps.find(s => s.char.characterName === 'Early' && !s.isReturn)!
    const primaryInputs = primary.stops.flatMap(st => st.inputs.map(i => i.material))
    expect(primaryInputs).toContain('Water')
    expect(primaryInputs).not.toContain('Electrolytes')

    // The return visit slots in right after Late.
    const order = steps.map(s => s.char.characterName + (s.isReturn ? ':return' : ''))
    expect(order).toEqual(['Early', 'Late', 'Early:return'])

    expect(validateDeliveryUsage(steps)).toEqual([])
  })
})

describe('computeSteps — frozen order', () => {
  it('honors a supplied login order instead of re-deriving it', () => {
    const beta = char('Beta', [planet('Eb', ['Silicon'])])
    const alpha = char('Alpha', [planet('Ea', ['Chiral Structures'])])

    // Natural order is alphabetical (both are P1 extractors, same urgency).
    expect(deriveLoginOrder([beta, alpha], NOW)).toEqual([alpha.characterId, beta.characterId])

    // A frozen order pins Beta first, overriding the natural sort.
    const frozen = [beta.characterId, alpha.characterId]
    const steps = computeSteps([beta, alpha], NOW, frozen)
    expect(steps.map(s => s.char.characterName)).toEqual(['Beta', 'Alpha'])
  })
})
