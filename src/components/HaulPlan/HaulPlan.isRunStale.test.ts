import { describe, it, expect } from 'vitest'
import type { Planet, StoredCharacter } from '../../types/api'
import { DEFAULT_PI_SKILLS } from '../../types/api'
import { PRODUCT_BY_NAME } from '../../data/schematics'
import { isRunStale, resetKey } from './HaulPlan'

// ── fixture helpers ─────────────────────────────────────────────────────────
let pid = 1
function planet(name: string, outputs: string[], expiryTime?: string): Planet {
  return {
    planetId: pid++,
    type: 'barren',
    name,
    outputs: outputs.map(o => PRODUCT_BY_NAME.get(o)!.typeId),
    outputNames: outputs,
    outputTiers: outputs.map(o => PRODUCT_BY_NAME.get(o)!.tier),
    expiryTime,
  }
}
let cid = 1
function char(characterName: string, planets: Planet[]): StoredCharacter {
  return { characterId: cid++, characterName, piSkills: { ...DEFAULT_PI_SKILLS }, planets }
}

const NOW = Date.UTC(2026, 5, 30)
const HOUR = 3600_000

describe('isRunStale', () => {
  it('is never stale without saved progress', () => {
    const chars = [char('A', [planet('Ext', ['Water'], new Date(NOW - HOUR).toISOString())])]
    expect(isRunStale(new Set(), 0, NOW - 48 * HOUR, chars, NOW)).toBe(false)
  })

  it('is not stale without an activity timestamp (pre-feature saves get seeded, not wiped)', () => {
    const chars = [char('A', [planet('Ext', ['Water'], new Date(NOW - HOUR).toISOString())])]
    expect(isRunStale(new Set(['deliver|1|Water']), 2, null, chars, NOW)).toBe(false)
  })

  it('goes stale after long inactivity, even with no extractor signal', () => {
    const chars = [char('A', [planet('Fac', ['Coolant'])])]
    expect(isRunStale(new Set(['deliver|1|Water']), 0, NOW - 13 * HOUR, chars, NOW)).toBe(true)
    expect(isRunStale(new Set(['deliver|1|Water']), 0, NOW - 11 * HOUR, chars, NOW)).toBe(false)
  })

  it('a viewed step alone (no checks) counts as progress to reset', () => {
    const chars = [char('A', [planet('Fac', ['Coolant'])])]
    expect(isRunStale(new Set(), 3, NOW - 13 * HOUR, chars, NOW)).toBe(true)
  })

  it('goes stale when a ticked extractor has expired again (new cycle), after the idle guard', () => {
    const ext = planet('Ext', ['Water'], new Date(NOW - HOUR).toISOString()) // expired again
    const chars = [char('A', [ext])]
    const checked = new Set([resetKey(ext)])
    expect(isRunStale(checked, 0, NOW - 2 * HOUR, chars, NOW)).toBe(true)
  })

  it('the cycle signal is ignored while the run is recently active (ESI lag protection)', () => {
    const ext = planet('Ext', ['Water'], new Date(NOW - HOUR).toISOString())
    const chars = [char('A', [ext])]
    const checked = new Set([resetKey(ext)])
    expect(isRunStale(checked, 0, NOW - 0.5 * HOUR, chars, NOW)).toBe(false)
  })

  it('a ticked extractor still running does not trigger the cycle signal', () => {
    const ext = planet('Ext', ['Water'], new Date(NOW + 20 * HOUR).toISOString()) // running
    const chars = [char('A', [ext])]
    const checked = new Set([resetKey(ext)])
    expect(isRunStale(checked, 0, NOW - 2 * HOUR, chars, NOW)).toBe(false)
  })

  it('a ticked non-extractor (factory) planet never triggers the cycle signal', () => {
    const fac = planet('Fac', ['Coolant'], new Date(NOW - HOUR).toISOString())
    const chars = [char('A', [fac])]
    const checked = new Set([resetKey(fac)])
    expect(isRunStale(checked, 0, NOW - 2 * HOUR, chars, NOW)).toBe(false)
  })
})
