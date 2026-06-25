import React, { useState, useEffect } from 'react'
import { useCharacters } from './hooks/useCharacters'
import { SetupView } from './components/SetupView/SetupView'
import { ChainView } from './components/ChainView/ChainView'
import { HaulPlan } from './components/HaulPlan/HaulPlan'
import { SkillEditor } from './components/SkillEditor/SkillEditor'
import { FeedbackModal } from './components/Feedback/FeedbackModal'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import type { StoredCharacter, PISkillLevels } from './types/api'
import styles from './App.module.css'
import { APP_VERSION, LATEST_CHANGE } from './version'
import { useMarketPrices } from './hooks/useMarketPrices'
import { useExtractorNotifications, countExpiredExtractors } from './hooks/useExtractorNotifications'

type Tab = 'setup' | 'chain' | 'haul'

function PriceRing({ progress }: { progress: number }) {
  const r = 4.5
  const circ = 2 * Math.PI * r
  const dash = circ * progress
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r={r} fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="6" cy="6" r={r} fill="none" stroke="var(--accent)" strokeWidth="1.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 6 6)"
        style={{ transition: 'stroke-dasharray 30s linear' }}
      />
    </svg>
  )
}

export default function App() {
  const {
    characters,
    loading,
    addCharacter,
    importCharacter,
    refreshCharacter,
    removeCharacter,
    updateCharacterSkills,
    setSkillOverrides,
    clearSkillOverrides,
    addPlanet,
    renamePlanet,
    reloadCharacters,
  } = useCharacters()

  const [tab, setTab] = useState<Tab>('setup')
  const [skillEditChar, setSkillEditChar] = useState<StoredCharacter | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [haulFocusNonce, setHaulFocusNonce] = useState(0)

  const noElectron = typeof window.api === 'undefined'

  const { prices, lastUpdated, nextUpdateAt } = useMarketPrices()

  const notify = useExtractorNotifications(characters)
  const expiredCount = countExpiredExtractors(characters)

  const onToggleNotify = async () => {
    if (notify.enabled) { notify.disable(); return }
    const perm = await notify.enable()
    if (perm === 'denied') {
      alert(
        'Notifications are blocked for this site. Enable them in your browser’s site settings (the icon left of the address bar), then try again.'
      )
    }
  }

  // Attention pill → jump to the Haul plan and focus the first alt that needs a reset.
  const onAttentionClick = () => {
    if (characters.length === 0) return
    setTab('haul')
    setHaulFocusNonce(n => n + 1)
  }

  // Price refresh ring: 0 = just updated, 1 = due for refresh
  const [priceProgress, setPriceProgress] = useState(0)
  useEffect(() => {
    const tick = () => {
      if (!lastUpdated || !nextUpdateAt) { setPriceProgress(0); return }
      const elapsed = Date.now() - lastUpdated
      const total = nextUpdateAt - lastUpdated
      setPriceProgress(Math.min(1, elapsed / total))
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [lastUpdated, nextUpdateAt])

  // Auto-refresh all characters every hour using stored refresh tokens
  useEffect(() => {
    const id = setInterval(() => {
      window.api.refreshAllCharacters().catch(() => {})
    }, 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const [eveTime, setEveTime] = useState(() => new Date().toUTCString().slice(17, 25))
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const hh = String(now.getUTCHours()).padStart(2, '0')
      const mm = String(now.getUTCMinutes()).padStart(2, '0')
      const ss = String(now.getUTCSeconds()).padStart(2, '0')
      setEveTime(`${hh}:${mm}:${ss}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner} />
      </div>
    )
  }

  return (
    <div className={styles.appShell}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <span className={styles.appName}>EVE PI</span>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'setup' ? styles.active : ''}`}
            onClick={() => setTab('setup')}
          >
            Setup
          </button>
          <button
            className={`${styles.tab} ${tab === 'chain' ? styles.active : ''}`}
            onClick={() => setTab('chain')}
            disabled={characters.length === 0}
          >
            Production Chain
          </button>
          <button
            className={`${styles.tab} ${tab === 'haul' ? styles.active : ''}`}
            onClick={() => setTab('haul')}
            disabled={characters.length === 0}
          >
            Haul Plan
          </button>
        </div>
        <div className={styles.tabBarRight}>
          {notify.supported && (
            <button
              className={`${styles.notifyBtn} ${notify.enabled ? styles.notifyOn : styles.notifyOff}`}
              onClick={onToggleNotify}
              aria-pressed={notify.enabled}
              title={
                notify.enabled
                  ? 'Extractor-reset notifications are ON. You’ll get a system notification (at most once an hour, while the app is open) when extractors need reset. Click to turn off.'
                  : 'Extractor-reset notifications are OFF. Click to turn them on — a system alert when 1+ extractors need reset (at most once an hour, while the app is open).'
              }
            >
              {notify.enabled ? '🔔' : '🔕'}
            </button>
          )}
          {expiredCount > 0 && (
            <button
              className={styles.attentionPill}
              onClick={onAttentionClick}
              title={`${expiredCount} extractor${expiredCount !== 1 ? 's' : ''} need reset — open the Haul plan`}
            >
              <span className={styles.attentionIcon}>⚠</span>
              {expiredCount}
            </button>
          )}
          <button className={styles.feedbackBtn} onClick={() => setFeedbackOpen(true)}>
            💬 Feedback
          </button>
        </div>
      </div>

      {noElectron && (
        <div className={styles.warnBanner}>
          Running outside Electron — API calls will not work. Run with <code>npm run dev</code>.
        </div>
      )}

      {/* Content */}
      <div className={styles.content}>
        <ErrorBoundary>
          {tab === 'setup' && (
            <SetupView
              characters={characters}
              onAddCharacter={addCharacter}
              onImportCharacter={importCharacter}
              onRemoveCharacter={removeCharacter}
              onSkillChange={updateCharacterSkills}
              onSkillOverride={setSkillOverrides}
              onClearOverrides={clearSkillOverrides}
              onAddPlanet={addPlanet}
              onRenamePlanet={renamePlanet}
              onDone={() => setTab('chain')}
              prices={prices}
            />
          )}
          {tab === 'chain' && (
            <ChainView characters={characters} prices={prices} onRefresh={reloadCharacters} />
          )}
          {tab === 'haul' && (
            <HaulPlan characters={characters} prices={prices} onRefresh={reloadCharacters} focusNonce={haulFocusNonce} />
          )}
        </ErrorBoundary>
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <span className={styles.statusEveTime}>
          <span className={styles.statusLabel}>EVE Time</span>
          {eveTime}
        </span>
        <span className={styles.statusSep}>|</span>
        {lastUpdated && (
          <>
            <span
              className={styles.statusPrices}
              title={`Jita prices from Fuzzwork. Next refresh in ~${Math.ceil((1 - priceProgress) * 30)}m`}
            >
              <PriceRing progress={priceProgress} />
              Prices @ {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className={styles.statusSep}>|</span>
          </>
        )}
        <a
          className={styles.statusCoffee}
          href="https://buymeacoffee.com/lucianodonati"
          target="_blank"
          rel="noopener noreferrer"
          title="Support EVE PI Helper — buy me a coffee ☕"
        >
          ☕ Buy me a coffee
        </a>
        <span className={styles.statusSpacer} />
        <span className={styles.statusChange}>{LATEST_CHANGE}</span>
        <span className={styles.statusVersion}>v{APP_VERSION}</span>
      </div>

      {skillEditChar && (
        <SkillEditor
          character={skillEditChar}
          onClose={() => setSkillEditChar(null)}
          onSave={(skills: PISkillLevels) => {
            updateCharacterSkills(skillEditChar.characterId, skills)
            setSkillEditChar(null)
          }}
        />
      )}

      {feedbackOpen && (
        <FeedbackModal
          screen={tab === 'setup' ? 'Setup' : tab === 'chain' ? 'Production Chain' : 'Haul Plan'}
          characterCount={characters.length}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  )
}
