// Browser store layer — localStorage-backed, ports the merge + CRUD logic that
// used to live in electron/store.ts. Holds all character/planet data plus
// manual edits (renames, manual planets, skill overrides). ESI imports are
// merged in here so local-only fields survive a refresh.

import type { PISkillLevels, Planet, StoredCharacter } from '../types/api'
import { MAX_PI_SKILLS } from '../types/api'
import { STORE_KEY } from '../dev/devTools'

interface StoreSchema {
  characters: StoredCharacter[]
  nextCharId: number
  nextPlanetId: number
}

const STORAGE_KEY = STORE_KEY

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

function toRoman(n: number): string {
  return ROMAN[n] ?? String(n)
}

function load(): StoreSchema {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoreSchema>
      return {
        characters: parsed.characters ?? [],
        nextCharId: parsed.nextCharId ?? 1,
        nextPlanetId: parsed.nextPlanetId ?? 1,
      }
    }
  } catch { /* fall through to defaults */ }
  return { characters: [], nextCharId: 1, nextPlanetId: 1 }
}

function persist(state: StoreSchema): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// Imported character shape returned by the ESI refresh (server or future client)
export interface ImportedCharacter {
  characterId: number
  characterName: string
  piSkills: PISkillLevels
  planets: {
    esiPlanetId?: number
    systemId?: number
    name: string
    type: string
    outputs: number[]
    outputNames?: string[]
    outputTiers?: string[]
    ccu?: number
    extractorCount?: number
    factoryCount?: number
    expiryTime?: string
  }[]
  skillTraining?: StoredCharacter['skillTraining']
  icTraining?: StoredCharacter['icTraining']
}

export const store = {
  getCharacters(): StoredCharacter[] {
    const state = load()
    // Deduplicate by characterId (keep last occurrence)
    const seen = new Map<number, StoredCharacter>()
    for (const c of state.characters) seen.set(c.characterId, c)
    const deduped = Array.from(seen.values())
    if (deduped.length !== state.characters.length) {
      state.characters = deduped
      persist(state)
    }
    return deduped
  },

  addCharacter(): StoredCharacter {
    const state = load()
    const char: StoredCharacter = {
      characterId: state.nextCharId,
      characterName: `Alt ${toRoman(state.characters.length + 1)}`,
      piSkills: { ...MAX_PI_SKILLS },
      planets: [],
    }
    state.characters.push(char)
    state.nextCharId += 1
    persist(state)
    return char
  },

  removeCharacter(characterId: number): void {
    const state = load()
    state.characters = state.characters.filter(c => c.characterId !== characterId)
    persist(state)
  },

  renameCharacter(characterId: number, name: string): void {
    const state = load()
    const char = state.characters.find(c => c.characterId === characterId)
    if (char) { char.characterName = name; persist(state) }
  },

  updatePISkills(characterId: number, skills: PISkillLevels): void {
    const state = load()
    const char = state.characters.find(c => c.characterId === characterId)
    if (char) { char.piSkills = skills; persist(state) }
  },

  setSkillOverrides(characterId: number, overrides: Partial<Record<keyof PISkillLevels, number>>): StoredCharacter | null {
    const state = load()
    const char = state.characters.find(c => c.characterId === characterId)
    if (!char) return null
    if (Object.keys(overrides).length === 0) delete char.skillOverrides
    else char.skillOverrides = overrides
    persist(state)
    return char
  },

  clearSkillOverrides(characterId: number): StoredCharacter | null {
    const state = load()
    const char = state.characters.find(c => c.characterId === characterId)
    if (!char) return null
    delete char.skillOverrides
    persist(state)
    return char
  },

  removePlanet(characterId: number, planetId: number): void {
    const state = load()
    const char = state.characters.find(c => c.characterId === characterId)
    if (char) { char.planets = char.planets.filter(p => p.planetId !== planetId); persist(state) }
  },

  renamePlanet(characterId: number, planetId: number, name: string): void {
    const state = load()
    const planet = state.characters.find(c => c.characterId === characterId)?.planets.find(p => p.planetId === planetId)
    if (planet) { planet.name = name; persist(state) }
  },

  setPlanetOutputs(characterId: number, planetId: number, typeIds: number[]): void {
    const state = load()
    const planet = state.characters.find(c => c.characterId === characterId)?.planets.find(p => p.planetId === planetId)
    if (planet) { planet.outputs = typeIds; persist(state) }
  },

  // Merge an ESI import into local state, preserving skill overrides not yet
  // caught up to by real skills. Mirrors the old electron store.importCharacter.
  importCharacter(data: ImportedCharacter): StoredCharacter {
    const state = load()
    const id = data.characterId
    const existing = state.characters.find(c => c.characterId === id)

    // Preserve each planet's internal planetId across refreshes by matching on
    // ESI's stable planet_id (esiPlanetId). Without this, every refresh mints a
    // brand-new planetId, invalidating any planetId-keyed UI state — e.g. the
    // Haul Plan's manual reset/delivery checkmarks would silently reset on the
    // next ESI refresh.
    const prevIdByEsi = new Map<number, number>()
    for (const p of existing?.planets ?? [])
      if (p.esiPlanetId != null) prevIdByEsi.set(p.esiPlanetId, p.planetId)

    const planets: Planet[] = data.planets.map(p => ({
      planetId: (p.esiPlanetId != null && prevIdByEsi.has(p.esiPlanetId))
        ? prevIdByEsi.get(p.esiPlanetId)!
        : state.nextPlanetId++,
      ...(p.esiPlanetId != null ? { esiPlanetId: p.esiPlanetId } : {}),
      ...(p.systemId != null ? { systemId: p.systemId } : {}),
      type: p.type,
      name: p.name,
      outputs: p.outputs,
      ...(p.outputNames?.length ? { outputNames: p.outputNames } : {}),
      ...(p.outputTiers?.length ? { outputTiers: p.outputTiers } : {}),
      ...(p.ccu != null ? { ccu: p.ccu } : {}),
      ...(p.extractorCount != null ? { extractorCount: p.extractorCount } : {}),
      ...(p.factoryCount != null ? { factoryCount: p.factoryCount } : {}),
      ...(p.expiryTime ? { expiryTime: p.expiryTime } : {}),
    }))

    let skillOverrides: Partial<Record<keyof PISkillLevels, number>> | undefined
    if (existing?.skillOverrides) {
      const pruned: Partial<Record<keyof PISkillLevels, number>> = {}
      for (const [k, v] of Object.entries(existing.skillOverrides) as [keyof PISkillLevels, number][]) {
        if (v > data.piSkills[k]) pruned[k] = v
      }
      if (Object.keys(pruned).length > 0) skillOverrides = pruned
    }

    const char: StoredCharacter = {
      characterId: id,
      characterName: data.characterName,
      piSkills: data.piSkills,
      planets,
      ...(skillOverrides ? { skillOverrides } : {}),
      ...(data.skillTraining ? { skillTraining: data.skillTraining } : {}),
      ...(data.icTraining ? { icTraining: data.icTraining } : {}),
    }

    const idx = state.characters.findIndex(c => c.characterId === id)
    if (idx >= 0) state.characters[idx] = char
    else state.characters.push(char)

    state.nextCharId = Math.max(state.nextCharId, id + 1)
    persist(state)
    return char
  },
}
