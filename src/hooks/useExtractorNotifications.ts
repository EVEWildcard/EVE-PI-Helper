import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoredCharacter } from '../types/api'

// Browser notifications for extractors that need reset.
//
// Scope (deliberate): the app has no backend/database, so this can only fire
// while the app is open in a browser tab (a backgrounded tab still works; a
// fully-closed browser does not — that would need a push server). We notify
// with a single batched summary at most once per hour to avoid spam.

const ENABLED_KEY = 'pi.notify.enabled'
const LAST_NOTIFIED_KEY = 'pi.notify.lastNotifiedAt'
const THROTTLE_MS = 60 * 60 * 1000 // at most one notification per hour
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // re-scan every 5 minutes
const NOTIF_TAG = 'pi-extractor-reset' // re-uses one OS slot instead of stacking

const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window

/** Count extractor planets that are past their expiry (i.e. need a reset now). */
export function countExpiredExtractors(characters: StoredCharacter[]): number {
  const now = Date.now()
  let n = 0
  for (const char of characters) {
    for (const planet of char.planets) {
      if ((planet.extractorCount ?? 0) > 0 && planet.expiryTime) {
        if (new Date(planet.expiryTime).getTime() <= now) n++
      }
    }
  }
  return n
}

export function useExtractorNotifications(characters: StoredCharacter[]) {
  const [permission, setPermission] = useState<NotificationPermission>(
    notificationsSupported ? Notification.permission : 'denied'
  )
  const [enabled, setEnabled] = useState<boolean>(
    () => notificationsSupported && localStorage.getItem(ENABLED_KEY) === '1'
  )

  // Keep the latest characters in a ref so the interval reads fresh data
  // without resubscribing every render.
  const charsRef = useRef(characters)
  charsRef.current = characters

  const fireIfNeeded = useCallback(() => {
    if (!notificationsSupported) return
    if (Notification.permission !== 'granted') return
    if (localStorage.getItem(ENABLED_KEY) !== '1') return

    const count = countExpiredExtractors(charsRef.current)
    if (count === 0) {
      // Nothing pending — reset the throttle so the next reset notifies promptly.
      localStorage.removeItem(LAST_NOTIFIED_KEY)
      return
    }

    const last = Number(localStorage.getItem(LAST_NOTIFIED_KEY) || 0)
    if (Date.now() - last < THROTTLE_MS) return

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

  // Periodic scan + scan whenever the character data changes.
  useEffect(() => {
    if (!enabled) return
    fireIfNeeded()
    const id = setInterval(fireIfNeeded, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled, characters, fireIfNeeded])

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
  }
}
