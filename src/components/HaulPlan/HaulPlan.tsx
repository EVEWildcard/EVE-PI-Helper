import React, { useState, useEffect, useMemo } from 'react'
import type { StoredCharacter, Planet } from '../../types/api'
import { PRODUCT_BY_NAME, SCHEMATIC_INPUTS_BY_NAME } from '../../data/schematics'
import { PLANET_COLOR } from '../../data/planetColors'
import styles from './HaulPlan.module.css'

// ── helpers ───────────────────────────────────────────────────────────────────

type Urgency = 'expired' | 'critical' | 'warning' | 'ok' | 'idle'

function getUrgency(planet: Planet, now: number): Urgency {
  if (!planet.expiryTime) return 'idle'
  const ms = new Date(planet.expiryTime).getTime() - now
  if (ms <= 0)            return 'expired'
  if (ms < 2 * 3600_000) return 'critical'
  if (ms < 8 * 3600_000) return 'warning'
  return 'ok'
}

function formatTimeLeft(expiryTime: string, now: number): string {
  const ms = new Date(expiryTime).getTime() - now
  if (ms <= 0) return 'Expired'
  const h = Math.floor(ms / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatReadyAt(expiryTime: Date, now: number): string {
  const ms = expiryTime.getTime() - now
  if (ms <= 0) return 'Overdue — reset now'
  const h = Math.floor(ms / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  const rel = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`
  const utcH = String(expiryTime.getUTCHours()).padStart(2, '0')
  const utcM = String(expiryTime.getUTCMinutes()).padStart(2, '0')
  return `${rel} · ${utcH}:${utcM} EVE`
}

const URGENCY_ORDER: Record<Urgency, number> = { expired: 0, critical: 1, warning: 2, ok: 3, idle: 4 }
const TIER_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }
const TIER_COLOR: Record<string, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}

function isExtractorPlanet(planet: Planet): boolean {
  return (planet.outputTiers ?? []).some(t => t === 'P1')
}

function tierOf(name: string): string {
  return PRODUCT_BY_NAME.get(name)?.tier ?? 'P1'
}

function findReadyAt(characters: StoredCharacter[]): Date | null {
  let earliest: Date | null = null
  for (const char of characters) {
    for (const planet of char.planets) {
      if (!isExtractorPlanet(planet) || !planet.expiryTime) continue
      const d = new Date(planet.expiryTime)
      if (!earliest || d < earliest) earliest = d
    }
  }
  return earliest
}

// ── per-alt plan model ──────────────────────────────────────────────────────

interface DeliverInput {
  material: string
  tier: string
  ready: boolean      // can be dropped this login (source already collected, or your own)
  self: boolean       // produced on one of your own planets
  fromName?: string   // ready pickup: which alt left it in the container
  waitName?: string   // deferred: which alt produces it later (come back after)
  urgency: Urgency
}

interface DeliverStop {
  planet: Planet
  outputs: { name: string; tier: string }[]
  inputs: DeliverInput[]
}

interface ResetItem { planet: Planet; p1s: string[]; urgency: Urgency }
interface DepositItem { material: string; tier: string; toNames: string[] }

interface AltStep {
  char: StoredCharacter
  verbs: string[]
  resets: ResetItem[]
  stops: DeliverStop[]
  deposits: DepositItem[]
  taskKeys: string[]
}

function resetKey(p: Planet): string { return `reset|${p.planetId}` }
function deliverKey(p: Planet, material: string): string { return `deliver|${p.planetId}|${material}` }
function depositKey(charId: number, material: string): string { return `deposit|${charId}|${material}` }

function computeSteps(characters: StoredCharacter[], now: number): AltStep[] {
  // ── indexes ──
  const producedByChar = new Map<number, Set<string>>()
  const producerCharsByMaterial = new Map<string, Set<number>>()
  const neededByChar = new Map<number, Set<string>>()
  const allProduced = new Set<string>()
  const nameById = new Map<number, string>()
  const inputUrgency = new Map<string, Urgency>()

  for (const char of characters) {
    nameById.set(char.characterId, char.characterName)
    const made = new Set<string>()
    for (const planet of char.planets) {
      const u = getUrgency(planet, now)
      for (const name of planet.outputNames ?? []) {
        if (!name) continue
        made.add(name)
        allProduced.add(name)
        if (!producerCharsByMaterial.has(name)) producerCharsByMaterial.set(name, new Set())
        producerCharsByMaterial.get(name)!.add(char.characterId)
        const prev = inputUrgency.get(name)
        if (prev === undefined || URGENCY_ORDER[u] < URGENCY_ORDER[prev]) inputUrgency.set(name, u)
      }
    }
    producedByChar.set(char.characterId, made)
  }

  for (const char of characters) {
    const needs = new Set<string>()
    for (const planet of char.planets)
      for (const out of planet.outputNames ?? [])
        for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(out) ?? [])
          if (allProduced.has(inp)) needs.add(inp)
    neededByChar.set(char.characterId, needs)
  }

  // ── login order: extractors/low-tier first, then by extractor urgency ──
  function maxTier(char: StoredCharacter): number {
    let r = 0
    for (const p of char.planets) for (const t of p.outputTiers ?? []) r = Math.max(r, TIER_RANK[t] ?? 0)
    return r
  }
  function extractionUrgency(char: StoredCharacter): number {
    const ex = char.planets.filter(isExtractorPlanet)
    return ex.length ? Math.min(...ex.map(p => URGENCY_ORDER[getUrgency(p, now)])) : 99
  }
  const order = [...characters].sort((a, b) =>
    maxTier(a) - maxTier(b) ||
    extractionUrgency(a) - extractionUrgency(b) ||
    a.characterName.localeCompare(b.characterName)
  )
  const orderIndex = new Map<number, number>()
  order.forEach((c, i) => orderIndex.set(c.characterId, i))

  // ── availability accumulator (what's in the container as you progress) ──
  const availableBefore = new Map<number, Set<string>>()
  const acc = new Set<string>()
  for (const char of order) {
    availableBefore.set(char.characterId, new Set(acc))
    for (const m of producedByChar.get(char.characterId) ?? []) acc.add(m)
  }

  // ── build a step per alt ──
  return order.map(char => {
    const cid = char.characterId
    const own = producedByChar.get(cid)!
    const before = availableBefore.get(cid)!

    const resets: ResetItem[] = char.planets
      .filter(isExtractorPlanet)
      .map(p => ({
        planet: p,
        p1s: (p.outputNames ?? []).filter((_, i) => (p.outputTiers ?? [])[i] === 'P1'),
        urgency: getUrgency(p, now),
      }))
      .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency])

    const stops: DeliverStop[] = []
    for (const planet of char.planets) {
      const outputs = (planet.outputNames ?? []).map((n, i) => ({ name: n, tier: (planet.outputTiers ?? [])[i] ?? 'P2' }))
      const needed = new Set<string>()
      for (const out of planet.outputNames ?? [])
        for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(out) ?? [])
          if (allProduced.has(inp)) needed.add(inp)
      if (needed.size === 0) continue

      const inputs: DeliverInput[] = [...needed].map(material => {
        const self = own.has(material)
        const others = [...(producerCharsByMaterial.get(material) ?? [])].filter(id => id !== cid)
        let ready = self
        let fromName: string | undefined
        let waitName: string | undefined
        if (!self) {
          const earlier = others.find(id => (orderIndex.get(id) ?? 0) < (orderIndex.get(cid) ?? 0))
          if (earlier != null) { ready = true; fromName = nameById.get(earlier) }
          else {
            const later = others.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))[0]
            if (later != null) waitName = nameById.get(later)
          }
        } else if (before.has(material)) {
          // also stocked by an earlier alt — still your own, leave note off
        }
        return {
          material,
          tier: tierOf(material),
          ready,
          self,
          fromName,
          waitName,
          urgency: inputUrgency.get(material) ?? 'idle',
        }
      }).sort((a, b) => Number(b.ready) - Number(a.ready) || URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency])

      stops.push({ planet, outputs, inputs })
    }
    stops.sort((a, b) => {
      const ua = Math.min(99, ...a.inputs.map(i => URGENCY_ORDER[i.urgency]))
      const ub = Math.min(99, ...b.inputs.map(i => URGENCY_ORDER[i.urgency]))
      return ua - ub
    })

    const deposits: DepositItem[] = [...own]
      .map(material => {
        const toNames = characters
          .filter(c2 => c2.characterId !== cid && (neededByChar.get(c2.characterId)?.has(material) ?? false))
          .map(c2 => c2.characterName)
        return { material, tier: tierOf(material), toNames }
      })
      .filter(d => d.toNames.length > 0)
      .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])

    // verbs
    const hasPickup = stops.some(s => s.inputs.some(i => i.ready && !i.self))
    const verbs: string[] = []
    if (resets.length) { verbs.push('Reset', 'Collect') }
    if (deposits.length) verbs.push('Input')
    if (hasPickup) verbs.push('Pickup')
    if (stops.length) verbs.push('Deliver')

    const taskKeys: string[] = [
      ...resets.map(r => resetKey(r.planet)),
      ...stops.flatMap(s => s.inputs.map(i => deliverKey(s.planet, i.material))),
      ...deposits.map(d => depositKey(cid, d.material)),
    ]

    return { char, verbs, resets, stops, deposits, taskKeys }
  })
}

const VERB_PHRASE: Record<string, string> = {
  Reset: 'Reset', Collect: 'Collect',
  Input: 'Input into shared PI container',
  Pickup: 'Pick up from container', Deliver: 'Deliver',
}

// ── persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY_CHECKED = 'haulplan.checked'
const STORAGE_KEY_STEP    = 'haulplan.step'

function loadChecked(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_CHECKED) ?? '[]')) }
  catch { return new Set() }
}
function saveChecked(s: Set<string>) {
  localStorage.setItem(STORAGE_KEY_CHECKED, JSON.stringify([...s]))
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onRefresh?: () => Promise<void>
  /** Bumped by the top-bar attention pill to jump to the first alt needing a reset. */
  focusNonce?: number
}

export function HaulPlan({ characters, onRefresh, focusNonce }: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!onRefresh) return
    const id = setInterval(() => onRefresh().catch(() => {}), 5 * 60_000)
    return () => clearInterval(id)
  }, [onRefresh])

  const steps = useMemo(() => computeSteps(characters, now), [characters, now])
  const readyAt = useMemo(() => findReadyAt(characters), [characters])

  const [checked, setChecked] = useState<Set<string>>(loadChecked)
  const [active, setActive] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(STORAGE_KEY_STEP) ?? '0', 10)
    return Number.isFinite(v) ? v : 0
  })

  const activeIdx = Math.min(active, Math.max(0, steps.length - 1))
  useEffect(() => { localStorage.setItem(STORAGE_KEY_STEP, String(activeIdx)) }, [activeIdx])

  // When the top-bar attention pill is clicked, jump to the first alt that has
  // an expired extractor so the user lands directly on what needs doing.
  useEffect(() => {
    if (!focusNonce) return
    const idx = steps.findIndex(s => s.resets.some(r => r.urgency === 'expired'))
    if (idx >= 0) setActive(idx)
  }, [focusNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveChecked(next)
      return next
    })
  }

  function completeAndNext(step: AltStep) {
    setChecked(prev => {
      const next = new Set(prev)
      for (const k of step.taskKeys) next.add(k)
      saveChecked(next)
      return next
    })
    setActive(i => Math.min(steps.length - 1, i + 1))
  }

  function clearAll() {
    const empty = new Set<string>()
    setChecked(empty)
    saveChecked(empty)
  }

  if (characters.length === 0)
    return <div className={styles.empty}>Add characters to see the hauling plan.</div>

  const allKeys = steps.flatMap(s => s.taskKeys)
  const doneItems = allKeys.filter(k => checked.has(k)).length
  const totalItems = allKeys.length

  const isOverdue = readyAt ? readyAt.getTime() <= now : false
  const step = steps[activeIdx]

  function stepDone(s: AltStep): boolean {
    return s.taskKeys.length > 0 && s.taskKeys.every(k => checked.has(k))
  }

  return (
    <div className={styles.root}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarRow}>
          <h1 className={styles.title}>Haul Plan</h1>
          {readyAt && (
            <span className={`${styles.readyAt} ${isOverdue ? styles.readyAtOverdue : ''}`}>
              {isOverdue ? '⚡' : '⏱'} {formatReadyAt(readyAt, now)}
            </span>
          )}
          <div className={styles.topBarActions}>
            <span className={styles.progressLabel}>{doneItems}/{totalItems}</span>
            {doneItems > 0 && <button className={styles.clearBtn} onClick={clearAll}>Reset run</button>}
          </div>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${totalItems > 0 ? (doneItems / totalItems) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Stepper: one circle per alt = one login */}
      <div className={styles.stepper}>
        {steps.map((s, i) => {
          const done = stepDone(s)
          return (
            <button
              key={s.char.characterId}
              className={`${styles.step} ${i === activeIdx ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}
              onClick={() => setActive(i)}
            >
              <span className={styles.stepCircle}>
                {s.char.characterId > 0 ? (
                  <img
                    src={`https://images.evetech.net/characters/${s.char.characterId}/portrait?size=64`}
                    alt={s.char.characterName}
                    onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                  />
                ) : (
                  <span className={styles.stepInitial}>{s.char.characterName[0]}</span>
                )}
                {done && <span className={styles.stepCheck}>✓</span>}
              </span>
              <span className={styles.stepName}>{s.char.characterName}</span>
              <span className={styles.stepVerbs}>{s.verbs.join(' · ') || 'Nothing to do'}</span>
            </button>
          )
        })}
      </div>

      {/* Active alt — full screen */}
      <div className={styles.stage}>
        <div className={styles.altCard}>
          <div className={styles.altHeader}>
            {step.char.characterId > 0 && (
              <img
                src={`https://images.evetech.net/characters/${step.char.characterId}/portrait?size=64`}
                className={styles.altPortrait}
                alt={step.char.characterName}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <div className={styles.altHeaderText}>
              <span className={styles.altStepNum}>Alt {activeIdx + 1} of {steps.length}</span>
              <span className={styles.altName}>Log in as {step.char.characterName}</span>
              <span className={styles.altPlan}>
                {step.verbs.map(v => VERB_PHRASE[v] ?? v).join(' → ') || 'Nothing to do this login'}
              </span>
            </div>
          </div>

          {/* Reset & collect */}
          {step.resets.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}><span className={styles.sectionDot} data-kind="reset" />Reset &amp; collect extractors</div>
              {step.resets.map(r => {
                const key = resetKey(r.planet)
                const done = checked.has(key)
                return (
                  <label key={r.planet.planetId} className={`${styles.taskRow} ${done ? styles.taskDone : ''}`}>
                    <input type="checkbox" className={styles.taskCheck} checked={done} onChange={() => toggle(key)} />
                    <div className={styles.taskBody}>
                      <span className={styles.planetTypeDot} style={{ background: PLANET_COLOR[r.planet.type] }} title={r.planet.type} />
                      <span className={styles.planetName}>{r.planet.name}</span>
                      <div className={styles.chips}>
                        {r.p1s.map(n => (
                          <span key={n} className={styles.chip} style={{ '--tier-color': TIER_COLOR.P1 } as React.CSSProperties}>
                            <span className={styles.chipTier}>P1</span>{n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`${styles.timer} ${styles[`timer_${r.urgency}`]}`}>
                      {r.planet.expiryTime ? formatTimeLeft(r.planet.expiryTime, now) : 'no timer'}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {/* Deliver */}
          {step.stops.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}><span className={styles.sectionDot} data-kind="deliver" />Deliver inputs to your factories</div>
              {step.stops.map(stop => (
                <div key={stop.planet.planetId} className={styles.stop}>
                  <div className={styles.stopHeader}>
                    <span className={styles.planetTypeDot} style={{ background: PLANET_COLOR[stop.planet.type] }} title={stop.planet.type} />
                    <span className={styles.planetName}>{stop.planet.name}</span>
                    <div className={styles.chips}>
                      {stop.outputs.map(o => (
                        <span key={o.name} className={styles.chip} style={{ '--tier-color': TIER_COLOR[o.tier] } as React.CSSProperties}>
                          <span className={styles.chipTier}>{o.tier}</span>{o.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  {stop.inputs.map(inp => {
                    const key = deliverKey(stop.planet, inp.material)
                    const done = checked.has(key)
                    return (
                      <label
                        key={inp.material}
                        className={`${styles.taskRow} ${styles.inputRow} ${done ? styles.taskDone : ''} ${!inp.ready ? styles.waiting : ''}`}
                      >
                        <input type="checkbox" className={styles.taskCheck} checked={done} onChange={() => toggle(key)} />
                        <div className={styles.taskBody}>
                          <span className={styles.chip} style={{ '--tier-color': TIER_COLOR[inp.tier] } as React.CSSProperties}>
                            <span className={styles.chipTier}>{inp.tier}</span>{inp.material}
                          </span>
                          {inp.self ? (
                            <span className={styles.sourceNote}>from your own extractor</span>
                          ) : inp.ready ? (
                            <span className={styles.sourceNote}>pick up from container{inp.fromName ? ` · left by ${inp.fromName}` : ''}</span>
                          ) : (
                            <span className={styles.waitNote}>⏳ waiting on {inp.waitName ?? 'an earlier alt'} — come back after</span>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Deposit into shared container */}
          {step.deposits.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}><span className={styles.sectionDot} data-kind="input" />Drop into shared PI container</div>
              {step.deposits.map(d => {
                const key = depositKey(step.char.characterId, d.material)
                const done = checked.has(key)
                return (
                  <label key={d.material} className={`${styles.taskRow} ${done ? styles.taskDone : ''}`}>
                    <input type="checkbox" className={styles.taskCheck} checked={done} onChange={() => toggle(key)} />
                    <div className={styles.taskBody}>
                      <span className={styles.chip} style={{ '--tier-color': TIER_COLOR[d.tier] } as React.CSSProperties}>
                        <span className={styles.chipTier}>{d.tier}</span>{d.material}
                      </span>
                      <span className={styles.sourceNote}>for {d.toNames.join(', ')}</span>
                    </div>
                  </label>
                )
              })}
            </div>
          )}

          {step.taskKeys.length === 0 && (
            <div className={styles.nothing}>Nothing to do on this alt right now.</div>
          )}
        </div>

        {/* Nav */}
        <div className={styles.nav}>
          <button className={styles.navBtn} disabled={activeIdx === 0} onClick={() => setActive(i => Math.max(0, i - 1))}>
            ← Prev
          </button>
          <span className={styles.navHint}>
            {stepDone(step) ? 'All done on this alt' : `${step.taskKeys.filter(k => checked.has(k)).length}/${step.taskKeys.length} done`}
          </span>
          {activeIdx < steps.length - 1 ? (
            <button className={styles.navPrimary} onClick={() => completeAndNext(step)}>
              Complete &amp; next →
            </button>
          ) : (
            <button className={styles.navPrimary} onClick={() => completeAndNext(step)}>
              Finish run ✓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
