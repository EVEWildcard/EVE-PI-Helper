// Builds a PRIVACY-SAFE snapshot of the user's current PI state to attach to a
// feedback/bug report, so a maintainer can paste it into localStorage and
// reproduce exactly what the reporter saw — without learning any account or
// character names, or which real in-game assets/systems they own.
//
// What we strip:
//   • characterName  → "Alt N"           (real toon names)
//   • characterId    → synthetic 1,2,3…  (the real ESI id maps to a real char)
//   • planet.name    → "Planet N"        (renames can leak system names, e.g. J-space)
//   • esiPlanetId / systemId             (dropped — real asset locations)
// What we keep (not identifying, needed to reproduce the view):
//   • PI skills, skill overrides + training timers
//   • planet type, outputs/tiers, ccu, extractor/factory counts, expiry
//   • haul-plan run state (order, ticked tasks, step) and UI toggles
//
// The result is a map of localStorage key → raw string value. To replay:
//   Object.entries(snapshot).forEach(([k, v]) => localStorage.setItem(k, v))
//   location.reload()

import type { Planet, StoredCharacter } from '../../types/api'

const STORE_KEY = 'evepi.store'

// UI/run-state keys we copy verbatim — none of these contain identifying data.
const VERBATIM_KEYS = ['haulplan.step', 'setup.planetSort', 'chainView.suggestions', 'pi.notify.enabled']

export interface FeedbackSnapshot {
  /** localStorage key → sanitized string value, ready to replay verbatim */
  data: Record<string, string>
  summary: { alts: number; planets: number }
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

// Checked-task keys embed ids: `reset|<planetId>`, `deliver|<planetId>|<mat>`,
// `deposit|<charId>|<mat>`. planetId is a local counter (safe to keep); charId
// is the real ESI id, so the `deposit|…` form must be remapped to match.
function remapCheckedKey(key: string, idMap: Map<number, number>): string {
  const parts = key.split('|')
  if (parts[0] === 'deposit' && parts.length >= 2) {
    const mapped = idMap.get(Number(parts[1]))
    if (mapped != null) parts[1] = String(mapped)
  }
  return parts.join('|')
}

interface StoreShape {
  characters?: StoredCharacter[]
  nextPlanetId?: number
}

export function buildSnapshot(): FeedbackSnapshot | null {
  const store = readJSON<StoreShape>(STORE_KEY)
  if (!store || !Array.isArray(store.characters) || store.characters.length === 0) return null

  // real characterId → synthetic sequential id
  const idMap = new Map<number, number>()
  store.characters.forEach((c, i) => idMap.set(c.characterId, i + 1))

  const characters = store.characters.map((c, i) => {
    const characterId = i + 1
    const planets = (c.planets ?? []).map((p: Planet, j) => ({
      planetId: p.planetId,
      type: p.type,
      name: `Planet ${j + 1}`,
      outputs: p.outputs,
      ...(p.outputNames?.length ? { outputNames: p.outputNames } : {}),
      ...(p.outputTiers?.length ? { outputTiers: p.outputTiers } : {}),
      ...(p.ccu != null ? { ccu: p.ccu } : {}),
      ...(p.extractorCount != null ? { extractorCount: p.extractorCount } : {}),
      ...(p.factoryCount != null ? { factoryCount: p.factoryCount } : {}),
      ...(p.expiryTime ? { expiryTime: p.expiryTime } : {}),
      // dropped: esiPlanetId, systemId (real in-game asset locations)
    }))
    return {
      characterId,
      characterName: `Alt ${characterId}`,
      piSkills: c.piSkills,
      ...(c.skillOverrides ? { skillOverrides: c.skillOverrides } : {}),
      ...(c.skillTraining ? { skillTraining: c.skillTraining } : {}),
      ...(c.icTraining ? { icTraining: c.icTraining } : {}),
      planets,
    }
  })

  const allPlanetIds = characters.flatMap(c => c.planets.map(p => p.planetId))
  const sanitizedStore = {
    characters,
    nextCharId: characters.length + 1,
    nextPlanetId: store.nextPlanetId ?? (allPlanetIds.length ? Math.max(...allPlanetIds) + 1 : 1),
  }

  const data: Record<string, string> = { [STORE_KEY]: JSON.stringify(sanitizedStore) }

  // Haul-plan run state — remap character ids inside the frozen order + checked set.
  const order = readJSON<number[]>('haulplan.order')
  if (Array.isArray(order)) {
    data['haulplan.order'] = JSON.stringify(order.map(id => idMap.get(id) ?? id))
  }
  const checked = readJSON<string[]>('haulplan.checked')
  if (Array.isArray(checked)) {
    data['haulplan.checked'] = JSON.stringify(checked.map(k => remapCheckedKey(k, idMap)))
  }

  for (const key of VERBATIM_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw != null) data[key] = raw
  }

  const planets = characters.reduce((n, c) => n + c.planets.length, 0)
  return { data, summary: { alts: characters.length, planets } }
}
