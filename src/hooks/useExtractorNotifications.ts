import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StoredCharacter } from '../types/api'

// Browser notifications for extractors that need reset.
//
// Scope (deliberate): the app has no backend/database, so this can only fire
// while the app is open in a browser tab (a backgrounded tab still works; a
// fully-closed browser does not — that would need a push server). We notify
// with a single batched summary at most once per hour to avoid spam.
//
// Acknowledge model: clicking the top-bar attention pill "acknowledges" the
// currently-expired extractors (keyed by character:planet). Acknowledged ones
// drop out of the pending count and stop notifying until a NEW extractor expires.
// The ack set is pruned to only still-expired keys, so an extractor that is reset
// and later expires again will alert afresh.

const ENABLED_KEY = 'pi.notify.enabled'
const LAST_NOTIFIED_KEY = 'pi.notify.lastNotifiedAt'
const ACK_KEY = 'pi.notify.acked'
const THROTTLE_MS = 60 * 60 * 1000 // at most one notification per hour
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // re-scan every 5 minutes
const NOTIF_TAG = 'pi-extractor-reset' // re-uses one OS slot instead of stacking

const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window

/** Keys (`characterId:planetId`) of extractor planets past their expiry — i.e. needing a reset now. */
export function expiredExtractorKeys(characters: StoredCharacter[]): string[] {
  const now = Date.now()
  const keys: string[] = []
  for (const char of characters) {
    for (const planet of char.planets) {
      if ((planet.extractorCount ?? 0) > 0 && planet.expiryTime) {
        if (new Date(planet.expiryTime).getTime() <= now) keys.push(`${char.characterId}:${planet.planetId}`)
      }
    }
  }
  return keys
}

function loadAcked(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function useExtractorNotifications(characters: StoredCharacter[]) {
  const [permission, setPermission] = useState<NotificationPermission>(
    notificationsSupported ? Notification.permission : 'denied'
  )
  const [enabled, setEnabled] = useState<boolean>(
    () => notificationsSupported && localStorage.getItem(ENABLED_KEY) === '1'
  )
  const [acked, setAcked] = useState<Set<string>>(loadAcked)

  // Keep the latest characters in a ref so the interval reads fresh data
  // without resubscribing every render.
  const charsRef = useRef(characters)
  charsRef.current = characters

  const expiredKeys = useMemo(() => expiredExtractorKeys(characters), [characters])

  // Pending = expired extractors the user hasn't acknowledged yet.
  const pending = useMemo(
    () => expiredKeys.filter(k => !acked.has(k)),
    [expiredKeys, acked]
  )
  const pendingCount = pending.length

  // Prune the ack set down to only still-expired keys, so a reset-then-expired
  // extractor alerts again rather than staying silently acknowledged.
  // Skip while characters are absent (initial load / mid-refresh) — otherwise an
  // empty `characters` would look like "nothing expired" and wipe valid acks.
  useEffect(() => {
    if (characters.length === 0) return
    const exp = new Set(expiredKeys)
    setAcked(prev => {
      let changed = false
      const next = new Set<string>()
      for (const k of prev) { if (exp.has(k)) next.add(k); else changed = true }
      if (!changed) return prev
      localStorage.setItem(ACK_KEY, JSON.stringify([...next]))
      return next
    })
  }, [expiredKeys])

  // `force` skips the hourly throttle — used when the user just enabled
  // notifications or re-opened the app, so those moments alert promptly even if
  // we notified recently. The background poll passes force=false so repeat
  // alerts for the same expiries stay throttled to once an hour.
  const fireIfNeeded = useCallback((force = false) => {
    if (!notificationsSupported) return
    if (Notification.permission !== 'granted') return
    if (localStorage.getItem(ENABLED_KEY) !== '1') return

    const ack = loadAcked()
    const count = expiredExtractorKeys(charsRef.current).filter(k => !ack.has(k)).length
    if (count === 0) {
      // Nothing pending — reset the throttle so the next reset notifies promptly.
      localStorage.removeItem(LAST_NOTIFIED_KEY)
      return
    }

    if (!force) {
      const last = Number(localStorage.getItem(LAST_NOTIFIED_KEY) || 0)
      if (Date.now() - last < THROTTLE_MS) return
    }

    const title = count === 1 ? '1 extractor needs reset' : `${count} extractors need reset`
    try {
      new Notification(title, {
        body: 'Open EVE PI Helper to reset your extractors.',
        tag: NOTIF_TAG,
        icon: '/favicon.svg',
      })
      localStorage.setItem(LAST_NOTIFIED_KEY, String(Date.now()))
    } catch {
      /* some browsers throw if constructed without a service worker — ignore */
    }
  }, [])

  // Fire promptly when notifications are enabled / the app (re)opens — bypassing
  // the hourly throttle so toggling on or re-opening alerts right away — then poll
  // on the throttle. Deliberately NOT keyed on `characters`/`acked`: a new expiry
  // is picked up by the poll within CHECK_INTERVAL_MS, and re-running this on every
  // data refresh would re-fire the un-throttled alert and spam the user.
  useEffect(() => {
    if (!enabled) return
    fireIfNeeded(true)
    const id = setInterval(() => fireIfNeeded(false), CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled, fireIfNeeded])

  /** Acknowledge all currently-expired extractors — clears the pill + notification until a new one expires. */
  const acknowledge = useCallback(() => {
    const keys = expiredExtractorKeys(charsRef.current)
    setAcked(new Set(keys))
    localStorage.setItem(ACK_KEY, JSON.stringify(keys))
    // Treat acknowledging as "notified now" so we don't immediately re-alert.
    localStorage.setItem(LAST_NOTIFIED_KEY, String(Date.now()))
  }, [])

  /** Turn notifications on, requesting OS permission if needed. Returns final state. */
  const enable = useCallback(async (): Promise<NotificationPermission> => {
    if (!notificationsSupported) return 'denied'
    let perm = Notification.permission
    if (perm === 'default') {
      perm = await Notification.requestPermission()
      setPermission(perm)
    }
    if (perm === 'granted') {
      localStorage.setItem(ENABLED_KEY, '1')
      setEnabled(true)
    }
    return perm
  }, [])

  const disable = useCallback(() => {
    localStorage.setItem(ENABLED_KEY, '0')
    setEnabled(false)
  }, [])

  return {
    supported: notificationsSupported,
    permission,
    enabled,
    enable,
    disable,
    pendingCount,
    acknowledge,
  }
}
