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
        return { planetId: pid, category }
      } catch {
        return { planetId: pid, category: 'unknown' }
      }
    })
  )

  return results.filter(p => p.category !== 'unknown')
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
