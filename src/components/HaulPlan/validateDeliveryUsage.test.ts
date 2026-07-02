import { describe, it, expect } from 'vitest'
import type { Planet, StoredCharacter } from '../../types/api'
import { DEFAULT_PI_SKILLS } from '../../types/api'
import { computeSteps, type AltStep } from './HaulPlan'
import { validateDeliveryUsage } from './validateDeliveryUsage'
import { generateEmpireByAccounts, DEFAULT_DEV_ACCOUNTS, MAX_ACCOUNTS } from '../../dev/seedData'

// ── fixture helpers ─────────────────────────────────────────────────────────
let pid = 1
function planet(name: string, type: string, outputs: { name: string; tier: string }[]): Planet {
  return {
    planetId: pid++,
    type,
    name,
    outputs: [],
    outputNames: outputs.map(o => o.name),
    outputTiers: outputs.map(o => o.tier),
  }
}
let cid = 1
function char(characterName: string, planets: Planet[]): StoredCharacter {
  return { characterId: cid++, characterName, piSkills: { ...DEFAULT_PI_SKILLS }, planets }
}

const NOW = Date.UTC(2026, 5, 30)

describe('validateDeliveryUsage', () => {
  // The exact B7 case: a producer must leave BOTH inputs of a P2 recipe, and the
  // maker must consume both. Miniature Electronics ← Silicon + Chiral Structures.
  it('passes when every deposited material is consumed by the receiving alt', () => {
    const provider = char('Provider', [
      planet('Extractor I', 'plasma', [
        { name: 'Silicon', tier: 'P1' },
        { name: 'Chiral Structures', tier: 'P1' },
      ]),
    ])
    const maker = char('Maker', [
      planet('Factory I', 'barren', [{ name: 'Miniature Electronics', tier: 'P2' }]),
    ])

    const steps = computeSteps([provider, maker], NOW)

    // Provider is told to leave BOTH inputs...
    const providerStep = steps.find(s => s.char.characterName === 'Provider')!
    const deposited = providerStep.deposits.flatMap(d => d.toNames.map(() => d.material))
    expect(new Set(deposited)).toEqual(new Set(['Silicon', 'Chiral Structures']))

    // ...and the Maker consumes BOTH (this is what the original bug got wrong).
    const makerStep = steps.find(s => s.char.characterName === 'Maker' && !s.isReturn)!
    const consumed = new Set(makerStep.stops.flatMap(st => st.inputs.map(i => i.material)))
    expect(consumed).toEqual(new Set(['Silicon', 'Chiral Structures']))

    expect(validateDeliveryUsage(steps)).toEqual([])
  })

  it('flags a delivery that the receiving alt never consumes', () => {
    // Hand-built mismatch: Provider is told to leave Silicon + Chiral Structures for
    // Maker, but Maker only ever lists Silicon as a factory input.
    const provider = char('Provider', [])
    const maker = char('Maker', [])
    const steps: AltStep[] = [
      {
        id: 'p', char: provider, verbs: [], resets: [], stops: [],
        deposits: [
          { material: 'Silicon', tier: 'P1', toNames: ['Maker'] },
          { material: 'Chiral Structures', tier: 'P1', toNames: ['Maker'] },
        ],
        taskKeys: [],
      },
      {
        id: 'm', char: maker, verbs: [], resets: [],
        stops: [{
          planet: maker.planets[0] ?? ({ planetId: 99, type: 'barren', name: 'F', outputs: [] } as Planet),
          outputs: [{ name: 'Miniature Electronics', tier: 'P2' }],
          inputs: [{ material: 'Silicon', tier: 'P1', ready: true, self: false, fromName: 'Provider', urgency: 'idle' }],
        }],
        deposits: [], taskKeys: [],
      },
    ]

    const violations = validateDeliveryUsage(steps)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      kind: 'unconsumed-delivery',
      material: 'Chiral Structures',
      producer: 'Provider',
      consumer: 'Maker',
    })
  })

  it('flags an input that no alt is told to deposit', () => {
    const maker = char('Maker', [])
    const steps: AltStep[] = [
      {
        id: 'm', char: maker, verbs: [], resets: [],
        stops: [{
          planet: { planetId: 99, type: 'barren', name: 'F', outputs: [] } as Planet,
          outputs: [{ name: 'Miniature Electronics', tier: 'P2' }],
          inputs: [{ material: 'Silicon', tier: 'P1', ready: false, self: false, urgency: 'idle' }],
        }],
        deposits: [], taskKeys: [],
      },
    ]

    const violations = validateDeliveryUsage(steps)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      kind: 'unsourced-consumption',
      material: 'Silicon',
      consumer: 'Maker',
    })
  })

  it('keeps a real two-tier, return-visit empire consistent', () => {
    // Provider extracts; Maker turns those P1s into a P2 that it also feeds back is
    // not needed — instead Maker also produces a P1 that Provider consumes, forcing a
    // deferred ("waiting on a later alt") delivery + return visit. Both directions
    // must still balance.
    const provider = char('Provider', [
      planet('Ext I', 'plasma', [
        { name: 'Silicon', tier: 'P1' },
        { name: 'Chiral Structures', tier: 'P1' },
      ]),
      // Provider also makes Coolant ← Water + Electrolytes, needing Maker's output.
      planet('Fac I', 'barren', [{ name: 'Coolant', tier: 'P2' }]),
    ])
    const maker = char('Maker', [
      planet('Ext II', 'storm', [
        { name: 'Water', tier: 'P1' },
        { name: 'Electrolytes', tier: 'P1' },
      ]),
      planet('Fac II', 'barren', [{ name: 'Miniature Electronics', tier: 'P2' }]),
    ])

    const steps = computeSteps([provider, maker], NOW)
    expect(validateDeliveryUsage(steps)).toEqual([])
  })

  // The seeded dev empire cycles duplicate P4 chains across alts, so many
  // materials have several producers that also consume them — exactly the shape
  // that exposed the deposit/self asymmetry. The dev guard in HaulPlan must stay
  // quiet on it at every scale.
  it.each([1, DEFAULT_DEV_ACCOUNTS, MAX_ACCOUNTS])(
    'is quiet on the seeded dev empire (%i accounts)',
    accounts => {
      const { characters } = generateEmpireByAccounts(accounts)
      const steps = computeSteps(characters, Date.now())
      expect(validateDeliveryUsage(steps)).toEqual([])
    },
  )
})
