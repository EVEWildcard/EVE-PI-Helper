import { useState, useEffect, useCallback } from 'react'
import type { StoredCharacter, PISkillLevels } from '../types/api'

export function useCharacters() {
  const [characters, setCharacters] = useState<StoredCharacter[]>([])
  const [loading, setLoading] = useState(true)

  const loadCharacters = useCallback(async () => {
    const chars = await window.api.getCharacters()
    setCharacters(chars)
    setLoading(false)
  }, [])

  const addCharacter = useCallback(async () => {
    const char = await window.api.addCharacter()
    setCharacters((prev) => [...prev, char])
    return char
  }, [])

  const removeCharacter = useCallback(async (characterId: number) => {
    await window.api.removeCharacter(characterId)
    setCharacters((prev) => prev.filter((c) => c.characterId !== characterId))
  }, [])

  const renameCharacter = useCallback(async (characterId: number, name: string) => {
    await window.api.renameCharacter(characterId, name)
    setCharacters((prev) =>
      prev.map((c) => (c.characterId === characterId ? { ...c, characterName: name } : c))
    )
  }, [])

  const updateCharacterSkills = useCallback(async (characterId: number, skills: PISkillLevels) => {
    await window.api.updatePISkills(characterId, skills)
    setCharacters((prev) =>
      prev.map((c) => (c.characterId === characterId ? { ...c, piSkills: skills } : c))
    )
  }, [])

  const addPlanet = useCallback(async (characterId: number, type: string) => {
    const planet = await window.api.addPlanet(characterId, type)
    setCharacters((prev) =>
      prev.map((c) =>
        c.characterId === characterId ? { ...c, planets: [...c.planets, planet] } : c
      )
    )
    return planet
  }, [])

  const removePlanet = useCallback(async (characterId: number, planetId: number) => {
    await window.api.removePlanet(characterId, planetId)
    setCharacters((prev) =>
      prev.map((c) =>
        c.characterId === characterId
          ? { ...c, planets: c.planets.filter((p) => p.planetId !== planetId) }
          : c
      )
    )
  }, [])

  const setPlanetOutputs = useCallback(async (characterId: number, planetId: number, typeIds: number[]) => {
    await window.api.setPlanetOutputs(characterId, planetId, typeIds)
    setCharacters((prev) =>
      prev.map((c) =>
        c.characterId === characterId
          ? { ...c, planets: c.planets.map((p) => p.planetId === planetId ? { ...p, outputs: typeIds } : p) }
          : c
      )
    )
  }, [])

  const renamePlanet = useCallback(async (characterId: number, planetId: number, name: string) => {
    await window.api.renamePlanet(characterId, planetId, name)
    setCharacters((prev) =>
      prev.map((c) =>
        c.characterId === characterId
          ? {
              ...c,
              planets: c.planets.map((p) =>
                p.planetId === planetId ? { ...p, name } : p
              )
            }
          : c
      )
    )
  }, [])

  const setSkillOverrides = useCallback(async (characterId: number, overrides: Partial<Record<keyof PISkillLevels, number>>) => {
    const updated = await window.api.setSkillOverrides(characterId, overrides)
    if (updated) {
      setCharacters((prev) => prev.map((c) => c.characterId === characterId ? { ...c, skillOverrides: updated.skillOverrides } : c))
    }
  }, [])

  const clearSkillOverrides = useCallback(async (characterId: number) => {
    const updated = await window.api.clearSkillOverrides(characterId)
    if (updated) {
      setCharacters((prev) => prev.map((c) => c.characterId === characterId ? { ...c, skillOverrides: undefined } : c))
    }
  }, [])

  const importCharacter = useCallback((char: StoredCharacter) => {
    setCharacters((prev) => {
      const exists = prev.some(c => c.characterId === char.characterId)
      return exists
        ? prev.map(c => c.characterId === char.characterId ? char : c)
        : [...prev, char]
    })
  }, [])

  const refreshCharacter = useCallback(async (_characterId: number) => {
    const updated = await window.api.importCharacter('')
    setCharacters((prev) =>
      prev.map((c) => c.characterId === updated.characterId ? updated : c)
    )
    return updated
  }, [])

  useEffect(() => {
    loadCharacters().then(() => {
      // Silent background refresh using stored refresh tokens — no browser popup
      window.api.refreshAllCharacters()
        .then(updated => setCharacters(updated))
        .catch(() => { /* tokens may be missing on first launch — ignore */ })
    })
  }, [])

  const reloadCharacters = useCallback(async () => {
    const updated = await window.api.refreshAllCharacters()
    setCharacters(updated)
  }, [])

  return {
    characters,
    loading,
    addCharacter,
    importCharacter,
    refreshCharacter,
    removeCharacter,
    renameCharacter,
    updateCharacterSkills,
    setSkillOverrides,
    clearSkillOverrides,
    addPlanet,
    removePlanet,
    renamePlanet,
    setPlanetOutputs,
    reloadCharacters,
  }
}
