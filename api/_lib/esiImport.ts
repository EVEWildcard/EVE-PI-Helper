// Authenticated ESI import (server-side). Ported from the old electron/esi.ts.
// Runs in the serverless function where the access token is available; the
// browser never sees the token. Returns the ImportedCharacter shape that
// src/api/store.ts merges into localStorage.

const ESI = 'https://esi.evetech.net/latest'

export interface PISkillLevels {
  commandCenterUpgrades: number
  interplanetaryConsolidation: number
  remoteSensing: number
  planetology: number
  advancedPlanetology: number
}

interface EsiPlanetSummary {
  planet_id: number
  planet_type: string
  solar_system_id: number
  upgrade_level: number
  num_pins: number
}
interface EsiPlanetInfo { name: string; planet_id: number; system_id: number }
interface EsiPin {
  pin_id: number
  type_id: number
  schematic_id?: number
  expiry_time?: string
  extractor_details?: { product_type_id?: number }
}
interface EsiColony {
  pins: EsiPin[]
  routes: { content_type_id: number; source_pin_id: number; destination_pin_id: number }[]
}
interface EsiSkills { skills: { skill_id: number; trained_skill_level: number }[] }
interface EsiSchematicFull { cycle_time: number; schematic_name: string }
interface EsiSkillQueueItem {
  skill_id: number
  finish_date?: string
  start_date?: string
  queue_position: number
  trained_skill_level: number
  level_end_sp: number
  level_start_sp: number
  training_start_sp?: number
}

export interface SkillTrainingEntry {
  toLevel: number
  finishDate: string
  startDate?: string
  trainingSP?: number
  levelStartSP?: number
  levelEndSP?: number
}

export interface ImportedPlanet {
  esiPlanetId: number
  systemId: number
  name: string
  type: string
  outputs: number[]
  outputNames: string[]
  outputTiers: string[]
  ccu: number
  extractorCount: number
  factoryCount: number
  expiryTime?: string
}

export interface ImportedCharacter {
  characterId: number
  characterName: string
  piSkills: PISkillLevels
  planets: ImportedPlanet[]
  skillTraining?: Partial<Record<keyof PISkillLevels, SkillTrainingEntry>>
  icTraining?: SkillTrainingEntry
}

const PI_SKILL_IDS = {
  commandCenterUpgrades: 2505,
  interplanetaryConsolidation: 2495,
  remoteSensing: 13279,
  planetology: 2406,
  advancedPlanetology: 2403,
}

// ── tiny in-memory cache (per warm function instance) for public lookups ──
const cache = new Map<string, { data: unknown; ts: number }>()
function getCached<T>(key: string, ttl: number): T | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > ttl) { cache.delete(key); return null }
  return e.data as T
}

async function authed<T>(token: string, path: string): Promise<T> {
  const resp = await fetch(`${ESI}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) throw new Error(`ESI ${path}: ${resp.status} ${resp.statusText}`)
  return resp.json() as Promise<T>
}

async function pub<T>(path: string): Promise<T> {
  const key = `pub:${path}`
  const hit = getCached<T>(key, 24 * 60 * 60 * 1000)
  if (hit) return hit
  const resp = await fetch(`${ESI}${path}`)
  if (!resp.ok) throw new Error(`ESI ${path}: ${resp.status} ${resp.statusText}`)
  const data = await resp.json() as T
  cache.set(key, { data, ts: Date.now() })
  return data
}

const SCHEMATIC_NAME_TO_TYPE_ID: Record<string, number> = {
  'Bacteria': 2393, 'Biofuels': 2396, 'Biomass': 3779, 'Chiral Structures': 2401,
  'Electrolytes': 2390, 'Industrial Fibers': 2397, 'Oxidizing Compound': 2392,
  'Oxygen': 3683, 'Plasmoids': 2389, 'Precious Metals': 2399, 'Proteins': 2395,
  'Reactive Metals': 2398, 'Silicon': 9828, 'Toxic Metals': 2400, 'Water': 3645,
  'Biocells': 2329, 'Construction Blocks': 3828, 'Consumer Electronics': 9836,
  'Coolant': 9832, 'Enriched Uranium': 44, 'Fertilizer': 3693,
  'Genetically Enhanced Livestock': 15317, 'Livestock': 3725, 'Mechanical Parts': 3689,
  'Microfiber Shielding': 2327, 'Miniature Electronics': 9842, 'Nanites': 2463,
  'Oxides': 2317, 'Polyaramids': 2321, 'Polytextiles': 3695, 'Rocket Fuel': 9830,
  'Silicate Glass': 3697, 'Superconductors': 9838, 'Supertensile Plastics': 2312,
  'Synthetic Oil': 3691, 'Test Cultures': 2319, 'Transmitter': 9840,
  'Viral Agent': 3775, 'Water-Cooled CPU': 2328,
  'Biotech Research Reports': 2358, 'Camera Drones': 2345, 'Condensates': 2344,
  'Cryoprotectant Solution': 2367, 'Data Chips': 17392, 'Gel-Matrix Biopaste': 2348,
  'Guidance Systems': 9834, 'Hazmat Detection Systems': 2366, 'Hermetic Membranes': 2361,
  'High-Tech Transmitters': 17898, 'Industrial Explosives': 2360, 'Neocoms': 2354,
  'Nuclear Reactors': 2352, 'Planetary Vehicles': 9846, 'Robotics': 9848,
  'Smartfab Units': 2351, 'Supercomputers': 2349, 'Synthetic Synapses': 2346,
  'Transcranial Microcontrollers': 12836, 'Ukomi Superconductors': 17136, 'Vaccines': 28974,
  'Broadcast Node': 2867, 'Integrity Response Drones': 2868, 'Nano-Factory': 2869,
  'Organic Mortar Applicators': 2870, 'Recursive Computing Module': 2871,
  'Self-Harmonizing Power Core': 2872, 'Sterile Conduits': 2875, 'Wetware Mainframe': 2876,
}

const SCHEMATIC_NAME_TO_TIER: Record<string, string> = {
  'Bacteria':'P1','Biofuels':'P1','Biomass':'P1','Chiral Structures':'P1',
  'Electrolytes':'P1','Industrial Fibers':'P1','Oxidizing Compound':'P1',
  'Oxygen':'P1','Plasmoids':'P1','Precious Metals':'P1','Proteins':'P1',
  'Reactive Metals':'P1','Silicon':'P1','Toxic Metals':'P1','Water':'P1',
  'Biocells':'P2','Construction Blocks':'P2','Consumer Electronics':'P2',
  'Coolant':'P2','Enriched Uranium':'P2','Fertilizer':'P2',
  'Genetically Enhanced Livestock':'P2','Livestock':'P2','Mechanical Parts':'P2',
  'Microfiber Shielding':'P2','Miniature Electronics':'P2','Nanites':'P2',
  'Oxides':'P2','Polyaramids':'P2','Polytextiles':'P2','Rocket Fuel':'P2',
  'Silicate Glass':'P2','Superconductors':'P2','Supertensile Plastics':'P2',
  'Synthetic Oil':'P2','Test Cultures':'P2','Transmitter':'P2',
  'Viral Agent':'P2','Water-Cooled CPU':'P2',
  'Biotech Research Reports':'P3','Camera Drones':'P3','Condensates':'P3',
  'Cryoprotectant Solution':'P3','Data Chips':'P3','Gel-Matrix Biopaste':'P3',
  'Guidance Systems':'P3','Hazmat Detection Systems':'P3','Hermetic Membranes':'P3',
  'High-Tech Transmitters':'P3','Industrial Explosives':'P3','Neocoms':'P3',
  'Nuclear Reactors':'P3','Planetary Vehicles':'P3','Robotics':'P3',
  'Smartfab Units':'P3','Supercomputers':'P3','Synthetic Synapses':'P3',
  'Transcranial Microcontrollers':'P3','Ukomi Superconductors':'P3','Vaccines':'P3',
  'Broadcast Node':'P4','Integrity Response Drones':'P4','Nano-Factory':'P4',
  'Organic Mortar Applicators':'P4','Recursive Computing Module':'P4',
  'Self-Harmonizing Power Core':'P4','Sterile Conduits':'P4','Wetware Mainframe':'P4',
}

interface DetectedOutput { typeId: number; tier: string }

async function detectOutputs(colony: EsiColony): Promise<DetectedOutput[]> {
  const factoryPins = colony.pins.filter(p => p.schematic_id != null)
  if (factoryPins.length === 0) return []

  const factoryPinIds = new Set(factoryPins.map(p => p.pin_id))
  const uniqueIds = [...new Set(factoryPins.map(p => p.schematic_id!))]

  const schematics = new Map<number, EsiSchematicFull>()
  await Promise.all(uniqueIds.map(async id => {
    try { schematics.set(id, await pub<EsiSchematicFull>(`/universe/schematics/${id}/`)) } catch { /* skip */ }
  }))

  const tierByTypeId = new Map<number, string>()
  for (const s of schematics.values()) {
    const tier = SCHEMATIC_NAME_TO_TIER[s.schematic_name]
    const typeId = SCHEMATIC_NAME_TO_TYPE_ID[s.schematic_name]
    if (tier && typeId != null) tierByTypeId.set(typeId, tier)
  }

  const factoryOutputTypes = new Set<number>()
  const factoryInputTypes = new Set<number>()
  for (const route of colony.routes ?? []) {
    if (factoryPinIds.has(route.source_pin_id)) factoryOutputTypes.add(route.content_type_id)
    if (factoryPinIds.has(route.destination_pin_id)) factoryInputTypes.add(route.content_type_id)
  }
  const terminals = [...factoryOutputTypes].filter(t => !factoryInputTypes.has(t))

  if (terminals.length > 0) {
    return terminals.map(typeId => ({ typeId, tier: tierByTypeId.get(typeId) ?? 'P1' }))
  }

  const TIER_ORDER: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }
  const seen = new Set<number>()
  const results: DetectedOutput[] = []
  const sorted = [...schematics.values()].sort((a, b) =>
    (TIER_ORDER[SCHEMATIC_NAME_TO_TIER[b.schematic_name] ?? 'P1'] ?? 1) -
    (TIER_ORDER[SCHEMATIC_NAME_TO_TIER[a.schematic_name] ?? 'P1'] ?? 1)
  )
  for (const s of sorted) {
    const typeId = SCHEMATIC_NAME_TO_TYPE_ID[s.schematic_name]
    const tier = SCHEMATIC_NAME_TO_TIER[s.schematic_name]
    if (typeId != null && tier && !seen.has(typeId)) { seen.add(typeId); results.push({ typeId, tier }) }
  }
  return results
}

async function fetchTypeName(typeId: number): Promise<string> {
  try {
    const t = await pub<{ name: string }>(`/universe/types/${typeId}/`)
    return t.name
  } catch { return '' }
}

const PI_SKILL_ID_TO_KEY: Record<number, keyof PISkillLevels> = {
  2505: 'commandCenterUpgrades',
  2495: 'interplanetaryConsolidation',
  13279: 'remoteSensing',
  2406: 'planetology',
  2403: 'advancedPlanetology',
}

export async function importCharacterFromESI(
  token: string, characterId: number, characterName: string,
): Promise<ImportedCharacter> {
  const skillsData = await authed<EsiSkills>(token, `/characters/${characterId}/skills/`)
  const skillMap = new Map(skillsData.skills.map(s => [s.skill_id, s.trained_skill_level]))
  const piSkills: PISkillLevels = {
    commandCenterUpgrades: skillMap.get(PI_SKILL_IDS.commandCenterUpgrades) ?? 0,
    interplanetaryConsolidation: skillMap.get(PI_SKILL_IDS.interplanetaryConsolidation) ?? 0,
    remoteSensing: skillMap.get(PI_SKILL_IDS.remoteSensing) ?? 0,
    planetology: skillMap.get(PI_SKILL_IDS.planetology) ?? 0,
    advancedPlanetology: skillMap.get(PI_SKILL_IDS.advancedPlanetology) ?? 0,
  }

  const esiPlanets = await authed<EsiPlanetSummary[]>(token, `/characters/${characterId}/planets/`)

  const planets = await Promise.all(esiPlanets.map(async (ep): Promise<ImportedPlanet> => {
    const [info, colony] = await Promise.all([
      pub<EsiPlanetInfo>(`/universe/planets/${ep.planet_id}/`),
      authed<EsiColony>(token, `/characters/${characterId}/planets/${ep.planet_id}/`),
    ])
    const detected = await detectOutputs(colony)
    const extractorPins = colony.pins.filter(p => p.extractor_details != null)
    const factoryPins = colony.pins.filter(p => p.schematic_id != null)
    const expiries = extractorPins.map(p => p.expiry_time).filter(Boolean) as string[]
    const expiryTime = expiries.length > 0 ? expiries.reduce((a, b) => a < b ? a : b) : undefined
    const outputNames = await Promise.all(detected.map(d => fetchTypeName(d.typeId)))
    return {
      esiPlanetId: ep.planet_id,
      systemId: info.system_id,
      name: info.name,
      type: ep.planet_type,
      outputs: detected.map(d => d.typeId),
      outputNames,
      outputTiers: detected.map(d => d.tier),
      ccu: ep.upgrade_level,
      extractorCount: extractorPins.length,
      factoryCount: factoryPins.length,
      expiryTime,
    }
  }))

  let skillTraining: Partial<Record<keyof PISkillLevels, SkillTrainingEntry>> | undefined
  try {
    const queue = await authed<EsiSkillQueueItem[]>(token, `/characters/${characterId}/skillqueue/`)
    const now = Date.now()
    const active = queue.find(e =>
      e.start_date && e.finish_date &&
      new Date(e.start_date).getTime() <= now &&
      new Date(e.finish_date).getTime() > now
    )
    if (active) {
      const key = PI_SKILL_ID_TO_KEY[active.skill_id]
      if (key && active.finish_date) {
        skillTraining = { [key]: {
          toLevel: active.trained_skill_level,
          finishDate: active.finish_date,
          startDate: active.start_date,
          trainingSP: active.training_start_sp,
          levelStartSP: active.level_start_sp,
          levelEndSP: active.level_end_sp,
        } }
      }
    }
  } catch { /* skill queue optional */ }

  return {
    characterId, characterName, piSkills, planets,
    skillTraining,
    icTraining: skillTraining?.interplanetaryConsolidation,
  }
}
