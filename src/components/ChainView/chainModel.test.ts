import { describe, it, expect } from 'vitest'
import type { Planet, StoredCharacter } from '../../types/api'
import { DEFAULT_PI_SKILLS } from '../../types/api'
import { PRODUCT_BY_NAME, SCHEMATIC_BY_OUTPUT } from '../../data/schematics'
import { buildChainModel, computeBalanceHints, planetKey } from './chainModel'
import { filterToChain } from './chainFocus'

// ── fixture helpers ─────────────────────────────────────────────────────────
// buildChainModel reads numeric `outputs` (typeIds) + `factoryCount`, so resolve
// names to typeIds here for readable test setups.
function tid(name: string): number {
  const p = PRODUCT_BY_NAME.get(name)
  if (!p) throw new Error(`unknown product ${name}`)
  return p.typeId
}

let pid = 1
function planet(name: string, outputs: string[], factoryCount = 1, extractionRates?: Record<number, number>): Planet {
  return {
    planetId: pid++, type: 'barren', name, outputs: outputs.map(tid), factoryCount,
    ...(extractionRates ? { extractionRates } : {}),
  }
}

let cid = 1
function char(characterName: string, planets: Planet[], ic = 0): StoredCharacter {
  return {
    characterId: cid++,
    characterName,
    piSkills: { ...DEFAULT_PI_SKILLS, interplanetaryConsolidation: ic },
    planets,
  }
}

// Price table by product name → keyed by typeId for buildChainModel.
function prices(table: Record<string, number>): Record<number, number> {
  const out: Record<number, number> = {}
  for (const [name, p] of Object.entries(table)) out[tid(name)] = p
  return out
}

describe('buildChainModel — terminals', () => {
  it('flags the end product as the only terminal of a healthy P1→P2 chain', () => {
    const ext = char('Ext', [planet('E', ['Silicon', 'Chiral Structures'])])
    const fac = char('Fac', [planet('F', ['Miniature Electronics'])])

    const model = buildChainModel([ext, fac], prices({ 'Miniature Electronics': 1000 }))

    expect(model.terminals.map(t => t.product.name)).toEqual(['Miniature Electronics'])
    const t = model.terminals[0]
    expect(t.broken).toBe(false)
    expect(t.realizedFraction).toBeCloseTo(1, 5)
    expect(t.missingInputs).toEqual([])
    // Silicon + Chiral are consumed, so they're upstream — not terminals.
    expect(t.upstreamProducts).toEqual(
      expect.arrayContaining(['Silicon', 'Chiral Structures']),
    )
    // intended = nameplate supply × price; running at 100% ⇒ now == intended.
    expect(t.iskHrIntended).toBeGreaterThan(0)
    expect(t.iskHrNow).toBeCloseTo(t.iskHrIntended, 5)
  })

  it('exposes producer keys as charId:planetId for the terminal', () => {
    const fac = char('Solo', [
      planet('E', ['Silicon', 'Chiral Structures']),
      planet('F', ['Miniature Electronics']),
    ])
    const model = buildChainModel([fac], prices({ 'Miniature Electronics': 10 }))
    const t = model.terminals[0]
    const fPlanet = fac.planets.find(p => p.name === 'F')!
    expect(t.producerKeys).toEqual([planetKey(fac.characterId, fPlanet.planetId)])
  })

  it('ranks terminals by intended ISK/hr, descending', () => {
    // Two independent terminals; Mini Electronics priced far above Coolant.
    const a = char('A', [
      planet('Ea', ['Silicon', 'Chiral Structures']),
      planet('Fa', ['Miniature Electronics']),
    ])
    const b = char('B', [
      planet('Eb', ['Water', 'Electrolytes']),
      planet('Fb', ['Coolant']),
    ])
    const model = buildChainModel([a, b], prices({ 'Miniature Electronics': 1000, Coolant: 1 }))
    expect(model.terminals.map(t => t.product.name)).toEqual(['Miniature Electronics', 'Coolant'])
    expect(model.terminals[0].iskHrIntended).toBeGreaterThan(model.terminals[1].iskHrIntended)
  })
})

describe('buildChainModel — broken & bottleneck', () => {
  it('treats a never-produced P1 input as imported, not broken (you buy it in)', () => {
    // Factory wants Silicon + Chiral; only Silicon is extracted. A P1 has no
    // sub-chain to half-build, so the missing one is assumed bought/hauled in.
    const ext = char('Ext', [planet('E', ['Silicon'])])
    const fac = char('Fac', [planet('F', ['Miniature Electronics'])])

    const model = buildChainModel([ext, fac], prices({ 'Miniature Electronics': 1000 }))
    const t = model.terminals.find(t => t.product.name === 'Miniature Electronics')!

    expect(t.broken).toBe(false)
    expect(t.missingInputs).toEqual([])
    expect(t.importedInputs).toContain('Chiral Structures')
    expect(t.realizedFraction).toBeCloseTo(1, 5)
    expect(t.iskHrNow).toBeCloseTo(t.iskHrIntended, 5)
    expect(model.importedNames.has('Chiral Structures')).toBe(true)
  })

  it('treats a factory-only empire (no extractors) as fully import-fed, never broken', () => {
    // The classic case: only a P2 factory, no P1 extraction anywhere. Both inputs are
    // imports, so nothing is broken and the chain runs at full intended ISK/hr.
    const fac = char('Fac', [planet('F', ['Miniature Electronics'])])
    const model = buildChainModel([fac], prices({ 'Miniature Electronics': 1000 }))
    const t = model.terminals[0]

    expect(t.broken).toBe(false)
    expect(t.importedInputs).toEqual(expect.arrayContaining(['Silicon', 'Chiral Structures']))
    expect(t.missingInputs).toEqual([])
    expect(t.iskHrNow).toBeCloseTo(t.iskHrIntended, 5)
  })

  it('marks a chain broken only at a genuine gap: a P2 you half-build but never finish', () => {
    // You extract Silicon + Chiral (Miniature Electronics' feeders) but never build the
    // Miniature Electronics factory, while running a Smartfab Units (P3) terminal that
    // needs it. That missing P2 is a real gap ⇒ broken. Construction Blocks — whose own
    // feeders you don't make — is an import, not a gap.
    const ext = char('Ext', [planet('E', ['Silicon', 'Chiral Structures'])])
    const fac = char('Fac', [planet('F', ['Smartfab Units'])])

    const model = buildChainModel([ext, fac], prices({ 'Smartfab Units': 5000 }))
    const t = model.terminals.find(t => t.product.name === 'Smartfab Units')!

    expect(t.broken).toBe(true)
    expect(t.missingInputs).toContain('Miniature Electronics')
    expect(t.importedInputs).toContain('Construction Blocks')
    expect(t.realizedFraction).toBe(0)
    expect(t.iskHrNow).toBe(0)
    expect(t.iskHrIntended).toBeGreaterThan(0) // intended is honest even while broken
  })

  it('detects a starved input as the bottleneck and throttles realized output', () => {
    // One Silicon extractor feeds two Miniature Electronics factories (2× demand),
    // so Silicon availability ≈ 0.5 and caps the terminal's realized fraction.
    const ext = char('Ext', [planet('Esi', ['Silicon']), planet('Ech', ['Chiral Structures'])])
    const fac = char('Fac', [planet('F', ['Miniature Electronics'], 2)])

    const model = buildChainModel([ext, fac], prices({ 'Miniature Electronics': 1000 }))
    const t = model.terminals[0]

    expect(t.broken).toBe(false)
    expect(t.realizedFraction).toBeCloseTo(0.5, 5)
    expect(t.bottleneck?.name).toBe('Silicon')
    expect(t.bottleneck!.ratio).toBeCloseTo(0.5, 5)
    expect(t.iskHrNow).toBeCloseTo(t.iskHrIntended * 0.5, 5)
  })
})

describe('buildChainModel — extraction-capped supply', () => {
  it('caps a P1 planet at its measured extractor yield', () => {
    // 8 basic facilities nameplate far exceeds what the extractors actually pull;
    // supply must be the extraction-limited rate, not the facility nameplate.
    const sch = SCHEMATIC_BY_OUTPUT.get(tid('Silicon'))!
    const p0 = sch.inputs[0]
    const nameplate = sch.output.quantity * (3600 / sch.cycleTime) * 8
    const p0PerHr = 24_000
    const capped = p0PerHr * (sch.output.quantity / p0.quantity)
    expect(capped).toBeLessThan(nameplate) // fixture sanity: the cap actually binds

    const ext = char('Ext', [planet('E', ['Silicon'], 8, { [p0.typeId]: p0PerHr })])
    const model = buildChainModel([ext], prices({ Silicon: 100 }))
    expect(model.flows.get(tid('Silicon'))!.supply).toBeCloseTo(capped, 5)
  })

  it('stays at facility nameplate when extraction outpaces the factories', () => {
    const sch = SCHEMATIC_BY_OUTPUT.get(tid('Silicon'))!
    const p0 = sch.inputs[0]
    const nameplate = sch.output.quantity * (3600 / sch.cycleTime) * 2
    const ext = char('Ext', [planet('E', ['Silicon'], 2, { [p0.typeId]: 1_000_000 })])
    const model = buildChainModel([ext], prices({ Silicon: 100 }))
    expect(model.flows.get(tid('Silicon'))!.supply).toBeCloseTo(nameplate, 5)
  })
})

describe('buildChainModel — root cause vs downstream limit', () => {
  // Scarce Silicon (1 facility) feeds a double-size Miniature Electronics line,
  // which in turn feeds a Smartfab Units terminal. Only Silicon is the root
  // ('constrained'); Mini is a symptom ('limited', pointing at Silicon).
  const fixture = () => {
    const ext = char('Ext', [planet('Esi', ['Silicon']), planet('Ech', ['Chiral Structures'], 2)])
    const fac = char('Fac', [planet('Fme', ['Miniature Electronics'], 2), planet('Fsm', ['Smartfab Units'])])
    return buildChainModel([ext, fac], prices({ 'Smartfab Units': 5000 }))
  }

  it("marks the scarce P1 'constrained' with no upstream blame", () => {
    const si = fixture().flows.get(tid('Silicon'))!
    expect(si.status).toBe('constrained')
    expect(si.limitedBy).toBeUndefined()
    expect(si.ratio).toBeCloseTo(0.5, 5)
  })

  it("marks the throttled consumer 'limited' and points it at the root", () => {
    const mini = fixture().flows.get(tid('Miniature Electronics'))!
    expect(mini.status).toBe('limited')
    expect(mini.limitedBy).toBe('Silicon')
    expect(mini.realizedFraction).toBeCloseTo(0.5, 5)
  })

  it('carries the root cause through to the terminal', () => {
    const model = fixture()
    const smart = model.flows.get(tid('Smartfab Units'))!
    expect(smart.status).toBe('terminal')
    expect(smart.limitedBy).toBe('Silicon')
    expect(smart.realizedFraction).toBeCloseTo(0.5, 5)
    const t = model.terminals.find(t => t.product.name === 'Smartfab Units')!
    expect(t.bottleneck?.name).toBe('Silicon')
  })

  it('counts consumer planets per input', () => {
    const si = fixture().flows.get(tid('Silicon'))!
    expect(si.consumerCount).toBe(1) // one Mini planet consumes it (double-sized, but ONE planet)
  })
})

describe('computeBalanceHints', () => {
  it('flags only the root supply limit, quantized to whole planets', () => {
    const ext = char('Ext', [planet('Esi', ['Silicon']), planet('Ech', ['Chiral Structures'], 2)])
    const fac = char('Fac', [planet('Fme', ['Miniature Electronics'], 2), planet('Fsm', ['Smartfab Units'])])
    const hints = computeBalanceHints(buildChainModel([ext, fac], prices({ 'Smartfab Units': 5000 })))

    const si = hints.find(h => h.productName === 'Silicon')!
    expect(si.type).toBe('bottleneck')
    expect(si.coverage).toBeCloseTo(0.5, 5)
    expect(si.afterAdd).toBeCloseTo(1.0, 5) // +1 planet of the same size ⇒ full coverage
    // Mini is throttled BY Silicon — flagging it too would just repeat the root.
    expect(hints.some(h => h.productName === 'Miniature Electronics')).toBe(false)
  })

  it('stays quiet about mild under-coverage (normal buffer-fed PI)', () => {
    // 5 Silicon facilities feed a 6-facility Mini line: 83% coverage — a real
    // ceiling, but exactly the slack every template empire runs with.
    const ext = char('Ext', [planet('Esi', ['Silicon'], 5), planet('Ech', ['Chiral Structures'], 6)])
    const fac = char('Fac', [planet('Fme', ['Miniature Electronics'], 6)])
    const hints = computeBalanceHints(buildChainModel([ext, fac], prices({ 'Miniature Electronics': 100 })))
    expect(hints.filter(h => h.type === 'bottleneck')).toEqual([])
  })
})

describe('buildChainModel — flows', () => {
  it('balances supply and demand on a fully-fed P1 input', () => {
    const ext = char('Ext', [planet('E', ['Silicon', 'Chiral Structures'])])
    const fac = char('Fac', [planet('F', ['Miniature Electronics'])])
    const model = buildChainModel([ext, fac], prices({ 'Miniature Electronics': 1 }))

    const silicon = model.flows.get(tid('Silicon'))!
    expect(silicon.supply).toBeCloseTo(silicon.demand, 5)
    expect(silicon.ratio).toBeCloseTo(1, 5)
    expect(silicon.status).toBe('ok')

    const mini = model.flows.get(tid('Miniature Electronics'))!
    expect(mini.demand).toBe(0)
    expect(mini.status).toBe('terminal')
  })
})

describe('buildChainModel — opportunities', () => {
  it('suggests extending a P2 terminal to a higher tier when slots are free', () => {
    // Solo alt with IC 5 (→ 6 planet cap) using only 2 planets ⇒ 4 spare slots.
    const solo = char('Solo', [
      planet('E', ['Silicon', 'Chiral Structures']),
      planet('F', ['Miniature Electronics']),
    ], 5)
    // Price a P3 that consumes Miniature Electronics (Planetary Vehicles / Smartfab).
    const model = buildChainModel([solo], prices({
      'Miniature Electronics': 100,
      'Smartfab Units': 5000,
      'Planetary Vehicles': 1000,
    }))
    const t = model.terminals.find(t => t.product.name === 'Miniature Electronics')!
    expect(t.canExtend).toBeDefined()
    expect(t.canExtend!.toTier).toBe('P3')
    // Picks the higher-priced consumer.
    expect(t.canExtend!.toProduct).toBe('Smartfab Units')
  })

  it('does not offer to extend when there are no spare planet slots', () => {
    // IC 0 ⇒ 1 planet cap, 1 planet used ⇒ 0 spare. (Demand-free P1 is its own terminal.)
    const solo = char('Solo', [planet('E', ['Silicon'])], 0)
    const model = buildChainModel([solo], prices({ Silicon: 100, 'Miniature Electronics': 5000 }))
    const t = model.terminals.find(t => t.product.name === 'Silicon')
    expect(t?.canExtend).toBeUndefined()
  })
})

describe('filterToChain — single-chain focus', () => {
  it('drops planets from other chains and trims a shared planet to the focused outputs', () => {
    // 'Both' makes two disjoint terminals (Miniature Electronics + Coolant) from a
    // shared factory; ExtA feeds only Mini, ExtB feeds only Coolant, CoolOnly makes
    // only Coolant. Focusing Miniature Electronics must strip the Coolant chain out
    // entirely AND trim 'Both' to just its Miniature Electronics output — otherwise
    // the focused view would surface Coolant's inputs as phantom gaps.
    const emp = char('Emp', [
      planet('Both', ['Miniature Electronics', 'Coolant']),
      planet('ExtA', ['Silicon', 'Chiral Structures']),
      planet('ExtB', ['Water', 'Electrolytes']),
      planet('CoolOnly', ['Coolant']),
    ])
    const model = buildChainModel([emp], prices({ 'Miniature Electronics': 1000, Coolant: 1 }))

    const focused = filterToChain([emp], model, tid('Miniature Electronics'))
    const kept = focused[0].planets.map(p => p.name).sort()
    expect(kept).toEqual(['Both', 'ExtA'])

    const both = focused[0].planets.find(p => p.name === 'Both')!
    expect(both.outputs).toEqual([tid('Miniature Electronics')])
  })

  it('leaves a single-output planet untouched (same reference)', () => {
    const emp = char('Emp', [
      planet('E', ['Silicon', 'Chiral Structures']),
      planet('F', ['Miniature Electronics']),
    ])
    const model = buildChainModel([emp], prices({ 'Miniature Electronics': 10 }))

    const focused = filterToChain([emp], model, tid('Miniature Electronics'))
    const f = focused[0].planets.find(p => p.name === 'F')!
    const orig = emp.planets.find(p => p.name === 'F')!
    expect(f).toBe(orig) // untrimmed planets pass through by reference
  })
})
