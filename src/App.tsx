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

  const noElectron = typeof window.api === 'undefined'

  const { prices, lastUpdated, nextUpdateAt } = useMarketPrices()

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
        <button className={styles.feedbackBtn} onClick={() => setFeedbackOpen(true)}>
          💬 Feedback
        </button>
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
            <HaulPlan characters={characters} prices={prices} onRefresh={reloadCharacters} />
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
