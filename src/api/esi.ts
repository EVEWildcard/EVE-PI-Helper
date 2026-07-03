// Browser public-ESI layer. ESI's public (unauthenticated) endpoints send
// permissive CORS headers, so these can be called directly from the browser.
// Authenticated endpoints (skills, colonies) are NOT here — those run in the
// serverless /api/esi/* functions where the token lives.

const ESI = 'https://esi.evetech.net/latest'

export interface EsiSchematic {
  cycle_time: number
  schematic_name: string
  pins: { type_id: number; quantity: number; is_input: boolean }[]
}

export interface EsiPlanetInfoPublic {
  name: string
  planet_id: number
  system_id: number
  type_id: number
}

export interface SystemPlanet {
  planetId: number
  category: string
  name?: string           // "J164710 V" — lets plans point at a specific planet
}

// ── localStorage-backed cache for public data (long TTL, rarely changes) ──

interface CacheEntry { data: unknown; ts: number }
const memCache = new Map<string, CacheEntry>()

function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = memCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { memCache.delete(key); return null }
  return entry.data as T
}

function setCache(key: string, data: unknown): void {
  memCache.set(key, { data, ts: Date.now() })
}

async function pub<T>(path: string, ttlMs = 24 * 60 * 60 * 1000): Promise<T> {
  const key = `pub:${path}`
  const hit = getCached<T>(key, ttlMs)
  if (hit) return hit
  const resp = await fetch(`${ESI}${path}`)
  if (!resp.ok) throw new Error(`ESI ${path}: ${resp.status} ${resp.statusText}`)
  const data = await resp.json() as T
  setCache(key, data)
  return data
}

// ── Public fetchers ───────────────────────────────────────────────────────────

export function fetchSchematic(schematicId: number): Promise<EsiSchematic> {
  return pub<EsiSchematic>(`/universe/schematics/${schematicId}/`)
}

export async function fetchSchematics(ids: number[]): Promise<Record<string, EsiSchematic>> {
  const results: Record<string, EsiSchematic> = {}
  await Promise.all(ids.map(async id => {
    try { results[String(id)] = await fetchSchematic(id) } catch { /* skip */ }
  }))
  return results
}

export function fetchPlanetInfo(planetId: number): Promise<EsiPlanetInfoPublic> {
  return pub<EsiPlanetInfoPublic>(`/universe/planets/${planetId}/`)
}

const PLANET_BODY_TYPE_CATEGORY: Record<number, string> = {
  11: 'temperate', 12: 'ice', 13: 'gas',
  2014: 'oceanic', 2015: 'lava', 2016: 'barren',
  2017: 'storm', 2063: 'plasma',
}

function inferCategoryFromName(name: string): string {
  const lower = name.toLowerCase()
  for (const cat of ['temperate', 'ice', 'gas', 'oceanic', 'lava', 'barren', 'storm', 'plasma']) {
    if (lower.includes(cat)) return cat
  }
  return 'unknown'
}

export async function fetchSystemPlanetTypes(systemId: number): Promise<SystemPlanet[]> {
  const system = await pub<{ planets?: { planet_id: number }[] }>(`/universe/systems/${systemId}/`)
  const planetIds = (system.planets ?? []).map(p => p.planet_id)

  const results = await Promise.all(
    planetIds.map(async (pid): Promise<SystemPlanet> => {
      try {
        const info = await pub<{ planet_id: number; type_id: number; name: string }>(`/universe/planets/${pid}/`)
        const category = PLANET_BODY_TYPE_CATEGORY[info.type_id] ?? inferCategoryFromName(info.name)
        return { planetId: pid, category, name: info.name }
      } catch {
        return { planetId: pid, category: 'unknown' }
      }
    })
  )

  return results.filter(p => p.category !== 'unknown')
}

// ── Nearby-system search (BFS over stargates) ────────────────────────────────

export interface EsiSystemInfo {
  system_id: number
  name: string
  stargates?: number[]
  planets?: { planet_id: number }[]
}

export function fetchSystemInfo(systemId: number): Promise<EsiSystemInfo> {
  return pub<EsiSystemInfo>(`/universe/systems/${systemId}/`)
}

export async function fetchStargateDestination(stargateId: number): Promise<number> {
  const gate = await pub<{ destination: { system_id: number } }>(`/universe/stargates/${stargateId}/`)
  return gate.destination.system_id
}

export interface NearbyFreePlanet {
  systemId: number
  systemName: string
  jumps: number
  freeCount: number
}

// BFS outward over stargates looking for a system with an uncolonized planet of
// `category` (any category when undefined). Layers are checked nearest-first and
// the search stops at the first layer with a hit, so depth-2 systems are only
// fetched when depth 1 has nothing. Wormhole systems have no stargates, so the
// search naturally returns null there (callers skip them anyway).
export async function findNearbyFreePlanet(
  originSystemId: number,
  category: string | undefined,
  colonizedPlanetIds: Set<number>,
  maxJumps = 2,
): Promise<NearbyFreePlanet | null> {
  const visited = new Set([originSystemId])
  let frontier = [originSystemId]

  for (let jumps = 1; jumps <= maxJumps; jumps++) {
    const gateIds = (await Promise.all(
      frontier.map(sid => fetchSystemInfo(sid).then(s => s.stargates ?? []).catch(() => []))
    )).flat()
    const destIds = await Promise.all(
      gateIds.map(gid => fetchStargateDestination(gid).catch(() => null))
    )
    const layer = [...new Set(destIds.filter((id): id is number => id != null))]
      .filter(id => !visited.has(id))
    for (const id of layer) visited.add(id)
    if (layer.length === 0) return null

    const hits = await Promise.all(layer.map(async sid => {
      try {
        const planets = await fetchSystemPlanetTypes(sid)
        const free = planets.filter(p =>
          (!category || p.category === category) && !colonizedPlanetIds.has(p.planetId))
        return free.length ? { sid, count: free.length } : null
      } catch { return null }
    }))
    const found = hits.filter((h): h is { sid: number; count: number } => h != null)
    if (found.length > 0) {
      // Same jump distance — prefer the system with the most free candidates
      const best = found.reduce((a, b) => (b.count > a.count ? b : a))
      const name = (await fetchSystemInfo(best.sid).catch(() => null))?.name ?? `system ${best.sid}`
      return { systemId: best.sid, systemName: name, jumps, freeCount: best.count }
    }
    frontier = layer
  }
  return null
}

// ── Market prices (bulk endpoint, single call for all items) ──

interface EsiMarketPrice { type_id: number; adjusted_price?: number; average_price?: number }

let priceCache: Record<number, number> | null = null
let priceFetchedAt = 0
const PRICE_TTL = 30 * 60 * 1000

export async function fetchMarketPrices(): Promise<Record<number, number>> {
  if (priceCache && Date.now() - priceFetchedAt < PRICE_TTL) return priceCache
  const resp = await fetch(`${ESI}/markets/prices/?datasource=tranquility`, {
    headers: { Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`ESI markets/prices: ${resp.status}`)
  const items = await resp.json() as EsiMarketPrice[]
  const out: Record<number, number> = {}
  for (const item of items) {
    const price = item.average_price ?? item.adjusted_price
    if (price) out[item.type_id] = price
  }
  priceCache = out
  priceFetchedAt = Date.now()
  return out
}
