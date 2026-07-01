import React, { useState, useMemo } from 'react'
import { PRODUCT_BY_TYPE_ID } from '../../data/schematics'
import type { ChainSuggestion } from '../../hooks/useChainSuggestions'
import { formatTrainTime } from '../../hooks/useChainSuggestions'
import type { StoredCharacter } from '../../types/api'
import styles from './SuggestionPlan.module.css'

// ── Template URLs ─────────────────────────────────────────────────────────────

const TEMPLATE_BASE = 'https://raw.githubusercontent.com/DalShooth/EVE_PI_Templates/8b141a8a321005bc18e1eb31645ce316f016fbd7/PlanetaryInteractionTemplates'

// Known filename typos in the upstream repo
const FILENAME_FIXES: Record<string, string> = {
  'Chiral Structures': 'Chiral Stuctures',
}

function buildTemplateUrl(role: 'factory' | 'miner', productName: string): string {
  const fixed = FILENAME_FIXES[productName] ?? productName
  const prefix = role === 'factory' ? 'Factory' : 'Miner - 00'
  return `${TEMPLATE_BASE}/${encodeURIComponent(`${prefix} - ${fixed}.json`)}`
}

interface Props {
  suggestion: ChainSuggestion
  characters: StoredCharacter[]
  onClose: () => void
  onVerified?: () => Promise<void>
}

const TIER_COLOR: Record<string, string> = {
  P1: '#5b8dd9', P2: '#a06dc8', P3: '#d4963a', P4: '#e05555',
}

function formatIsk(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return `${(v / 1e3).toFixed(0)}K`
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

// ── Build a flat ordered action list ─────────────────────────────────────────

interface Action {
  id: string
  kind: 'buy' | 'extractor' | 'factory' | 'repurpose'
  character?: string
  label: string        // main action line
  detail?: string      // secondary line
  templateUrl?: string // link to DalShooth's PI template repo
}

function buildActions(s: ChainSuggestion): Action[] {
  const actions: Action[] = []

  // 1. Buy command centers
  const ccCounts = new Map<string, number>()
  for (const step of s.chainSteps) {
    if (s.repurposes && step.role === 'factory' && step.produces === s.product.name) continue
    ccCounts.set(step.commandCenter, (ccCounts.get(step.commandCenter) ?? 0) + 1)
  }
  if (ccCounts.size > 0) {
    const list = Array.from(ccCounts.entries()).map(([name, qty]) => `${qty}× ${name}`).join(', ')
    actions.push({ id: 'buy', kind: 'buy', label: `Buy ${list}` })
  }

  // 2. Extractor steps
  for (const step of s.chainSteps.filter(st => st.role === 'extractor')) {
    actions.push({
      id: `ext-${step.produces}`,
      kind: 'extractor',
      character: step.characterName,
      label: `Colonize a ${capitalize(step.planetCategory)} planet`,
      detail: `Set up extractor: ${step.extractsP0} → ${step.produces}`,
      templateUrl: buildTemplateUrl('miner', step.produces),
    })
  }

  // 3. Intermediate factory steps
  for (const step of s.chainSteps.filter(st => st.role === 'factory' && st.produces !== s.product.name)) {
    actions.push({
      id: `fac-${step.produces}`,
      kind: 'factory',
      character: step.characterName,
      label: `Colonize any planet for a factory`,
      detail: `Produce ${step.produces} from ${(step.factoryInputs ?? []).join(' + ')}`,
      templateUrl: buildTemplateUrl('factory', step.produces),
    })
  }

  // 4. Final factory or repurpose
  if (s.repurposes) {
    const inputs = (s.schematic?.inputs ?? []).map(i => PRODUCT_BY_TYPE_ID.get(i.typeId)?.name ?? '').filter(Boolean)
    actions.push({
      id: 'repurpose',
      kind: 'repurpose',
      character: s.repurposes.characterName,
      label: `Repurpose ${s.repurposes.planet.name}`,
      detail: `Remove ${s.repurposes.currentOutputNames.join(', ')} · set up factory for ${s.product.name} from ${inputs.join(' + ')}`,
      templateUrl: buildTemplateUrl('factory', s.product.name),
    })
  } else {
    const finalStep = s.chainSteps.find(st => st.role === 'factory' && st.produces === s.product.name)
    if (finalStep) {
      actions.push({
        id: `fac-${finalStep.produces}`,
        kind: 'factory',
        character: finalStep.characterName,
        label: `Colonize any planet for the ${s.product.tier} factory`,
        detail: `Produce ${finalStep.produces} from ${(finalStep.factoryInputs ?? []).join(' + ')}`,
        templateUrl: buildTemplateUrl('factory', finalStep.produces),
      })
    }
  }

  return actions
}

// ── Verify against ESI ────────────────────────────────────────────────────────

function checkFulfilled(s: ChainSuggestion, chars: StoredCharacter[]): { ok: boolean; missing: string[] } {
  const allProduced = new Set(chars.flatMap(c => c.planets.flatMap(p => p.outputNames ?? [])))
  const missing: string[] = []

  // Check all inputs that needed new extractors
  for (const inp of s.inputs) {
    if (inp.status === 'needsExtractor' && !allProduced.has(inp.name)) missing.push(inp.name)
  }
  // Check all chain-step outputs. For a shortfall fix the product was already
  // produced, so mere existence proves nothing — its own step is checked by
  // producer COUNT below instead.
  for (const step of s.chainSteps) {
    if (step.produces === s.shortfallOf?.name) continue
    if ((step.role === 'factory' || s.shortfallOf) && !allProduced.has(step.produces)) missing.push(step.produces)
  }
  // Check final product
  if (s.shortfallOf) {
    const producers = chars.reduce(
      (n, c) => n + c.planets.filter(p => (p.outputNames ?? []).includes(s.shortfallOf!.name)).length, 0)
    if (producers <= s.shortfallOf.currentProducers) missing.push(`another ${s.shortfallOf.name} producer`)
  } else if (!allProduced.has(s.product.name)) {
    missing.push(s.product.name)
  }

  return { ok: missing.length === 0, missing: [...new Set(missing)] }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SuggestionPlan({ suggestion: s, characters, onClose, onVerified }: Props) {
  const actions = useMemo(() => buildActions(s), [s])

  const storageKey = `plan.checked.${s.key}`
  const [checked, setChecked] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]')) }
    catch { return new Set() }
  })

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }

  const doneCount = actions.filter(a => checked.has(a.id)).length
  const allDone = doneCount === actions.length

  const [copyState, setCopyState] = useState<Record<string, 'idle' | 'copying' | 'copied' | 'error'>>({})

  async function copyTemplate(actionId: string, url: string) {
    setCopyState(s => ({ ...s, [actionId]: 'copying' }))
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopyState(s => ({ ...s, [actionId]: 'copied' }))
      setTimeout(() => setCopyState(s => ({ ...s, [actionId]: 'idle' })), 2000)
    } catch {
      setCopyState(s => ({ ...s, [actionId]: 'error' }))
      setTimeout(() => setCopyState(s => ({ ...s, [actionId]: 'idle' })), 2000)
    }
  }

  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'ok' | 'missing'>('idle')
  const [missingItems, setMissingItems] = useState<string[]>([])

  async function handleVerify() {
    setVerifyState('loading')
    try {
      const updated: StoredCharacter[] = await window.api.refreshAllCharacters()
      const result = checkFulfilled(s, updated)
      setMissingItems(result.missing)
      setVerifyState(result.ok ? 'ok' : 'missing')
      if (result.ok) {
        await onVerified?.()
        setTimeout(onClose, 1800)
      }
    } catch {
      setVerifyState('idle')
    }
  }

  return (
    <div className={styles.panel}>
      {verifyState === 'ok' && (
        <div className={styles.successOverlay}>
          <div className={styles.successIcon}>
            <svg viewBox="0 0 52 52" width="52" height="52">
              <circle cx="26" cy="26" r="24" fill="none" stroke="#4ab095" strokeWidth="2.5" className={styles.successCircle} />
              <path d="M14 26 L22 34 L38 18" fill="none" stroke="#4ab095" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={styles.successCheck} />
            </svg>
          </div>
          <div className={styles.successText}>All planets confirmed live</div>
        </div>
      )}
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTier} style={{ color: TIER_COLOR[s.product.tier] }}>
            {s.product.tier}
          </span>
          <span className={styles.headerName}>{s.product.name}</span>
          <span className={styles.headerIsk}>≈ {formatIsk(s.iskHr)}/hr</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Shortfall context */}
      {s.shortfallOf && (
        <div className={styles.shortfallBanner}>
          ⚡ {s.shortfallOf.name} shortfall — {s.shortfallOf.currentProducers} producer{s.shortfallOf.currentProducers !== 1 ? 's' : ''} feeding {s.shortfallOf.consumers} consumer{s.shortfallOf.consumers !== 1 ? 's' : ''}. Add one more producer to restore throughput.
        </div>
      )}

      {/* Skills warning */}
      {s.blocked && (() => {
        const assignedChar = characters.find(c => c.characterName === s.characterName)
        const t = assignedChar?.skillTraining?.interplanetaryConsolidation
        const training = t?.toLevel === s.blocked.trainToLevel ? t : undefined
        const timeLeft = training ? Math.max(0, new Date(training.finishDate).getTime() - Date.now()) : 0
        const tlDays = Math.floor(timeLeft / 86_400_000)
        const tlH = Math.floor((timeLeft % 86_400_000) / 3_600_000)
        const tlM = Math.floor((timeLeft % 3_600_000) / 60_000)
        const tlStr = tlDays > 0 ? `${tlDays}d ${tlH}h` : tlH > 0 ? `${tlH}h ${tlM}m` : `${tlM}m`
        return (
          <div className={styles.blockedBanner}>
            <div>⚠ Needs {s.blocked.extraSlotsNeeded} more planet slot{s.blocked.extraSlotsNeeded !== 1 ? 's' : ''} — train IC {s.blocked.trainFromLevel}→{s.blocked.trainToLevel} ({formatTrainTime(s.blocked.trainTimeHours)})</div>
            {training
              ? <div className={styles.blockedTraining}>✦ {s.characterName} is training this now — {tlStr} left</div>
              : <div className={styles.blockedNotTraining}>Not currently in {s.characterName}'s skill queue</div>
            }
          </div>
        )
      })()}

      {/* Progress */}
      <div className={styles.progress}>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${actions.length ? (doneCount / actions.length) * 100 : 0}%` }}
          />
        </div>
        <span className={styles.progressLabel}>{doneCount} / {actions.length} done</span>
      </div>

      {/* Action list */}
      <div className={styles.actionList}>
        {actions.map((action, i) => (
          <label key={action.id} className={`${styles.actionRow} ${checked.has(action.id) ? styles.actionDone : ''}`}>
            <input
              type="checkbox"
              className={styles.actionCheck}
              checked={checked.has(action.id)}
              onChange={() => toggle(action.id)}
            />
            <div className={styles.actionBody}>
              <div className={styles.actionTop}>
                <span className={styles.actionStep}>{i + 1}</span>
                {action.character && (
                  <span className={styles.actionChar}>{action.character}</span>
                )}
                <span className={styles.actionLabel}>{action.label}</span>
                {action.templateUrl && (() => {
                  const cs = copyState[action.id] ?? 'idle'
                  return (
                    <button
                      className={`${styles.templateBtn} ${cs === 'copied' ? styles.templateBtnCopied : cs === 'error' ? styles.templateBtnError : ''}`}
                      onClick={e => { e.preventDefault(); copyTemplate(action.id, action.templateUrl!) }}
                      title="Copy PI template to clipboard — paste in-game in the colony editor"
                      disabled={cs === 'copying'}
                    >
                      {cs === 'copied' ? '✓ Copied' : cs === 'error' ? '✗ Error' : cs === 'copying' ? '…' : '📋 Template'}
                    </button>
                  )
                })()}
              </div>
              {action.detail && (
                <div className={styles.actionDetail}>{action.detail}</div>
              )}
            </div>
          </label>
        ))}
      </div>

      {/* ESI verify */}
      <div className={styles.verifySection}>
        {verifyState === 'ok' && (
          <div className={styles.verifyOk}>✓ ESI confirmed — all planets are live</div>
        )}
        {verifyState === 'missing' && (
          <div className={styles.verifyMissing}>
            Still missing: {missingItems.join(', ')}
          </div>
        )}
        <button
          className={`${styles.verifyBtn} ${allDone ? styles.verifyBtnReady : ''}`}
          onClick={handleVerify}
          disabled={verifyState === 'loading'}
        >
          {verifyState === 'loading' ? 'Refreshing ESI…' : allDone ? '✓ Verify with ESI' : 'Re-scan ESI'}
        </button>
        {!allDone && (
          <div className={styles.verifyHint}>Check off steps as you complete them in-game</div>
        )}
      </div>
    </div>
  )
}
