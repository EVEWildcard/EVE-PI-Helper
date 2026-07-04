import { useEffect, useState } from 'react'
import type { ChainStep } from './useChainSuggestions'
import type { StoredCharacter } from '../types/api'
import { findNearbyFreePlanet, type NearbyFreePlanet } from '../api/esi'

export type NearbySearchResult =
  | { state: 'searching' }
  | { state: 'done'; nearest: NearbyFreePlanet | null }

export type NearbyResultsMap = Map<string, NearbySearchResult>

// Wormhole systems (J######) have no stargates to BFS over — the
// uncolonize/swap fallback for that case is a separate feature.
const WORMHOLE_RE = /^J\d{6}$/i

// Extractors need a specific planet category; factories take any planet.
export function nearbySearchKey(step: ChainStep): string {
  const cat = step.role === 'extractor' ? step.planetCategory : ''
  return `${step.systemId}|${cat}`
}

// Only steps whose home system has zero free planets warrant the (request-heavy)
// nearby search. Steps with a same-system swap render the swap action instead,
// so searching for them would be wasted requests.
export function stepNeedsNearbySearch(step: ChainStep): boolean {
  return step.freePlanetsInSystem === 0
    && !step.swap
    && step.systemId != null
    && !!step.systemName
    && !WORMHOLE_RE.test(step.systemName)
}

// Session-scoped result cache: reopening a plan (or another step needing the
// same system+category) reuses the finished search instead of refetching.
const searchCache = new Map<string, Promise<NearbyFreePlanet | null>>()

export function useNearbyFreePlanets(
  steps: ChainStep[],
  characters: StoredCharacter[],
): NearbyResultsMap {
  const [results, setResults] = useState<NearbyResultsMap>(new Map())

  const targetsKey = [...new Set(steps.filter(stepNeedsNearbySearch).map(nearbySearchKey))]
    .sort().join(';')

  useEffect(() => {
    if (!targetsKey) return
    let cancelled = false

    const colonized = new Set<number>()
    for (const c of characters) {
      for (const p of c.planets) if (p.esiPlanetId != null) colonized.add(p.esiPlanetId)
    }

    const keys = targetsKey.split(';')
    setResults(new Map(keys.map(k => [k, { state: 'searching' } as NearbySearchResult])))

    for (const key of keys) {
      const [sidStr, cat] = key.split('|')
      let promise = searchCache.get(key)
      if (!promise) {
        promise = findNearbyFreePlanet(Number(sidStr), cat || undefined, colonized).catch(() => null)
        searchCache.set(key, promise)
      }
      promise.then(nearest => {
        if (cancelled) return
        setResults(prev => new Map(prev).set(key, { state: 'done', nearest }))
      })
    }
    return () => { cancelled = true }
    // `characters` only feeds the colonized-id set; keying the effect on the
    // step targets alone (like useSystemPlanets) avoids refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey])

  return results
}
