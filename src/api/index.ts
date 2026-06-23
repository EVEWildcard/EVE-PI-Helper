// Installs `window.api` for the web build, preserving the exact interface the
// Electron preload bridge used to expose so the React UI needs no changes.
//
//   • store ops      → localStorage (src/api/store.ts)
//   • public ESI     → direct browser fetch (src/api/esi.ts)
//   • auth + import  → serverless /api/* functions (token stays server-side)

import type { StoredCharacter } from '../types/api'
import { store, type ImportedCharacter } from './store'
import {
  fetchSchematic, fetchSchematics, fetchPlanetInfo,
  fetchSystemPlanetTypes, fetchMarketPrices,
} from './esi'

// Merge a batch of server-imported characters into local storage, returning the
// merged records. Local-only fields (manual planets, renames, overrides) survive.
function mergeImported(imported: ImportedCharacter[]): StoredCharacter[] {
  const byId = new Map<number, StoredCharacter>()
  for (const c of imported) byId.set(c.characterId, store.importCharacter(c))
  // Return full roster (merged where refreshed, untouched otherwise)
  return store.getCharacters().map(c => byId.get(c.characterId) ?? c)
}

async function refreshAllCharacters(): Promise<StoredCharacter[]> {
  try {
    const resp = await fetch('/api/esi/refresh', { credentials: 'same-origin' })
    if (!resp.ok) return store.getCharacters()           // not logged in yet
    const imported = await resp.json() as ImportedCharacter[]
    return mergeImported(imported)
  } catch {
    return store.getCharacters()                          // offline / no backend
  }
}

export function installApi(): void {
  window.api = {
    // ── store ──
    getCharacters: async () => store.getCharacters(),
    addCharacter: async () => store.addCharacter(),
    removeCharacter: async (id) => { store.removeCharacter(id); return true },
    renameCharacter: async (id, name) => { store.renameCharacter(id, name); return true },
    updatePISkills: async (id, skills) => { store.updatePISkills(id, skills); return true },
    setSkillOverrides: async (id, overrides) => store.setSkillOverrides(id, overrides),
    clearSkillOverrides: async (id) => store.clearSkillOverrides(id),
    addPlanet: async (id, type) => store.addPlanet(id, type)!,
    removePlanet: async (id, planetId) => { store.removePlanet(id, planetId); return true },
    renamePlanet: async (id, planetId, name) => { store.renamePlanet(id, planetId, name); return true },
    setPlanetOutputs: async (id, planetId, typeIds) => { store.setPlanetOutputs(id, planetId, typeIds); return true },

    // ── public ESI ──
    getSchematic: (id) => fetchSchematic(id),
    getPlanetInfo: (id) => fetchPlanetInfo(id),
    getSystemPlanets: (systemId) => fetchSystemPlanetTypes(systemId),
    getSchematicsBatch: (ids) => fetchSchematics(ids),
    getMarketPrices: () => fetchMarketPrices(),

    // ── auth / import (server-side) ──
    // Client ID is a server env var now; these remain for interface compat.
    getClientId: async () => '',
    setClientId: async () => true,
    // Redirect-based OAuth: navigate to the login function. The page leaves, so
    // this promise intentionally never resolves; on return the app refreshes.
    importCharacter: () => {
      window.location.href = '/api/auth/login'
      return new Promise<StoredCharacter>(() => {})
    },
    refreshAllCharacters,
  }
}
