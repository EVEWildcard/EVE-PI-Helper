import { useState, useEffect } from 'react'
import type { StoredCharacter } from '../types/api'

export interface SystemPlanet { planetId: number; category: string }
export type SystemPlanetsMap = Map<number, SystemPlanet[]>  // systemId → planets

export function useSystemPlanets(characters: StoredCharacter[]): {
  systemPlanets: SystemPlanetsMap
  loading: boolean
} {
  const [systemPlanets, setSystemPlanets] = useState<SystemPlanetsMap>(new Map())
  const [loading, setLoading] = useState(false)

  // Stable key: sorted unique system IDs
  const systemIdsKey = Array.from(
    new Set(characters.flatMap(c => c.planets.map(p => p.systemId).filter(Boolean) as number[]))
  ).sort().join(',')

  useEffect(() => {
    if (typeof window.api === 'undefined' || !systemIdsKey) return

    const systemIds = systemIdsKey.split(',').map(Number)
    let cancelled = false
    setLoading(true)

    Promise.all(
      systemIds.map(async sid => ({
        sid,
        planets: await window.api.getSystemPlanets(sid).catch(() => [] as SystemPlanet[])
      }))
    ).then(results => {
      if (cancelled) return
      const m: SystemPlanetsMap = new Map()
      for (const { sid, planets } of results) m.set(sid, planets)
      setSystemPlanets(m)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [systemIdsKey])

  return { systemPlanets, loading }
}
