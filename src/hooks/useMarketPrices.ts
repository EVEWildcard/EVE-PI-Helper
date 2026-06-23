import { useState, useEffect } from 'react'

export type PriceMap = Record<number, number>

const REFRESH_MS = 30 * 60 * 1000

export function useMarketPrices(): {
  prices: PriceMap
  loading: boolean
  lastUpdated: number | null
  nextUpdateAt: number | null
} {
  const [prices, setPrices]             = useState<PriceMap>({})
  const [loading, setLoading]           = useState(false)
  const [lastUpdated, setLastUpdated]   = useState<number | null>(null)
  const [nextUpdateAt, setNextUpdateAt] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window.api?.getMarketPrices !== 'function') return
    let cancelled = false

    async function doFetch() {
      setLoading(true)
      try {
        const result = await window.api.getMarketPrices([])
        if (!cancelled) {
          setPrices(result ?? {})
          const now = Date.now()
          setLastUpdated(now)
          setNextUpdateAt(now + REFRESH_MS)
        }
      } catch (err) {
        console.error('[prices] fetch error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    doFetch()
    const id = setInterval(doFetch, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { prices, loading, lastUpdated, nextUpdateAt }
}
