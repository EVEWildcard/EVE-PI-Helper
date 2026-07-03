import { describe, it, expect, vi, afterEach } from 'vitest'
import { findNearbyFreePlanet } from './esi'

// ── fake universe served through a fetch stub ────────────────────────────────
// esi.ts caches responses per-path for 24h in a module-level map, so every test
// uses its own id range (base) to stay out of the others' cache entries.

const BARREN = 2016
const ICE = 12

interface FakeUniverse {
  systems: Record<number, { name: string; stargates?: number[]; planets?: { planet_id: number }[] }>
  stargates: Record<number, { destination: { system_id: number } }>
  planets: Record<number, { planet_id: number; type_id: number; name: string }>
}

function installFetch(u: FakeUniverse) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const m = /\/universe\/(systems|stargates|planets)\/(\d+)\//.exec(String(url))
    const table = m && u[m[1] as keyof FakeUniverse] as Record<number, unknown>
    const body = table ? table[Number(m![2])] : undefined
    if (!body) return { ok: false, status: 404, statusText: 'Not Found' } as Response
    return { ok: true, json: async () => body } as Response
  }))
}

afterEach(() => vi.unstubAllGlobals())

// Builds: origin(base) ↔ neighbor(base+1) ↔ far(base+2), one planet each.
// Gate ids are base+10x; planet ids base+100x.
function chainUniverse(base: number, neighborType: number, farType: number): FakeUniverse {
  return {
    systems: {
      [base]: { name: 'Origin', stargates: [base + 10], planets: [{ planet_id: base + 100 }] },
      [base + 1]: { name: 'Neighbor', stargates: [base + 11, base + 12], planets: [{ planet_id: base + 101 }] },
      [base + 2]: { name: 'Far', stargates: [base + 13], planets: [{ planet_id: base + 102 }] },
    },
    stargates: {
      [base + 10]: { destination: { system_id: base + 1 } },   // origin → neighbor
      [base + 11]: { destination: { system_id: base } },        // neighbor → origin (back-edge)
      [base + 12]: { destination: { system_id: base + 2 } },   // neighbor → far
      [base + 13]: { destination: { system_id: base + 1 } },   // far → neighbor
    },
    planets: {
      [base + 100]: { planet_id: base + 100, type_id: BARREN, name: 'Origin I' },
      [base + 101]: { planet_id: base + 101, type_id: neighborType, name: 'Neighbor I' },
      [base + 102]: { planet_id: base + 102, type_id: farType, name: 'Far I' },
    },
  }
}

describe('findNearbyFreePlanet', () => {
  it('finds a free matching planet one jump out', async () => {
    installFetch(chainUniverse(10_000, BARREN, BARREN))
    const hit = await findNearbyFreePlanet(10_000, 'barren', new Set())
    expect(hit).toEqual({ systemId: 10_001, systemName: 'Neighbor', jumps: 1, freeCount: 1 })
  })

  it('skips colonized planets and reports the deeper system instead', async () => {
    const base = 20_000
    installFetch(chainUniverse(base, BARREN, BARREN))
    const hit = await findNearbyFreePlanet(base, 'barren', new Set([base + 101]))
    expect(hit).toEqual({ systemId: base + 2, systemName: 'Far', jumps: 2, freeCount: 1 })
  })

  it('respects the category filter across layers', async () => {
    const base = 30_000
    installFetch(chainUniverse(base, ICE, BARREN))
    const hit = await findNearbyFreePlanet(base, 'barren', new Set())
    expect(hit).toEqual({ systemId: base + 2, systemName: 'Far', jumps: 2, freeCount: 1 })
  })

  it('matches any category when category is undefined', async () => {
    const base = 40_000
    installFetch(chainUniverse(base, ICE, BARREN))
    const hit = await findNearbyFreePlanet(base, undefined, new Set())
    expect(hit).toEqual({ systemId: base + 1, systemName: 'Neighbor', jumps: 1, freeCount: 1 })
  })

  it('returns null when the origin has no stargates (wormhole)', async () => {
    const base = 50_000
    installFetch({
      systems: { [base]: { name: 'J164710', planets: [{ planet_id: base + 100 }] } },
      stargates: {},
      planets: { [base + 100]: { planet_id: base + 100, type_id: BARREN, name: 'J164710 I' } },
    })
    expect(await findNearbyFreePlanet(base, 'barren', new Set())).toBeNull()
  })

  it('returns null when nothing matches within maxJumps', async () => {
    const base = 60_000
    installFetch(chainUniverse(base, ICE, ICE))
    expect(await findNearbyFreePlanet(base, 'barren', new Set())).toBeNull()
  })

  it('prefers the same-layer system with the most free planets', async () => {
    const base = 70_000
    installFetch({
      systems: {
        [base]: { name: 'Origin', stargates: [base + 10, base + 11] },
        [base + 1]: { name: 'OneFree', planets: [{ planet_id: base + 101 }] },
        [base + 2]: { name: 'TwoFree', planets: [{ planet_id: base + 102 }, { planet_id: base + 103 }] },
      },
      stargates: {
        [base + 10]: { destination: { system_id: base + 1 } },
        [base + 11]: { destination: { system_id: base + 2 } },
      },
      planets: {
        [base + 101]: { planet_id: base + 101, type_id: BARREN, name: 'OneFree I' },
        [base + 102]: { planet_id: base + 102, type_id: BARREN, name: 'TwoFree I' },
        [base + 103]: { planet_id: base + 103, type_id: BARREN, name: 'TwoFree II' },
      },
    })
    const hit = await findNearbyFreePlanet(base, 'barren', new Set())
    expect(hit).toEqual({ systemId: base + 2, systemName: 'TwoFree', jumps: 1, freeCount: 2 })
  })
})
