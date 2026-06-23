import React, { useState, useEffect, useMemo } from 'react'
import type { StoredCharacter, Planet } from '../../types/api'
import { PRODUCT_BY_TYPE_ID, SCHEMATIC_INPUTS_BY_NAME } from '../../data/schematics'
import { PLANET_COLOR } from '../../data/planetColors'
import styles from './HaulPlan.module.css'

// ── helpers ───────────────────────────────────────────────────────────────────

function systemFromPlanetName(name: string): string {
  return name.replace(/\s+[IVX]+(?:\s.*)?$/, '').trim() || name
}

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

const TIER_COLOR: Record<string, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}

function isExtractorPlanet(planet: Planet): boolean {
  return (planet.outputTiers ?? []).some(t => t === 'P1')
}

// ── Stage 1 model ─────────────────────────────────────────────────────────────

function computeFeederIds(characters: StoredCharacter[]): Set<number> {
  // For each factory planet, find which OTHER chars produce its inputs → they're feeders
  const producerByName = new Map<string, Set<number>>()
  for (const char of characters) {
    for (const planet of char.planets) {
      for (const name of planet.outputNames ?? []) {
        if (!name) continue
        if (!producerByName.has(name)) producerByName.set(name, new Set())
        producerByName.get(name)!.add(char.characterId)
      }
    }
  }
  const feederIds = new Set<number>()
  for (const toChar of characters) {
    for (const toPlanet of toChar.planets) {
      const needed = new Set<string>()
      for (const out of toPlanet.outputNames ?? [])
        for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(out) ?? [])
          needed.add(inp)
      for (const inp of needed) {
        for (const pid of producerByName.get(inp) ?? [])
          if (pid !== toChar.characterId) feederIds.add(pid)
      }
    }
  }
  return feederIds
}

function charExtractionUrgency(char: StoredCharacter, now: number): number {
  const extractors = char.planets.filter(isExtractorPlanet)
  if (extractors.length === 0) return 99
  return Math.min(...extractors.map(p => URGENCY_ORDER[getUrgency(p, now)]))
}

function sortCharsByDependency(
  characters: StoredCharacter[],
  feederIds: Set<number>,
  now: number,
): StoredCharacter[] {
  return [...characters].sort((a, b) => {
    const af = feederIds.has(a.characterId) ? 0 : 1
    const bf = feederIds.has(b.characterId) ? 0 : 1
    if (af !== bf) return af - bf
    return charExtractionUrgency(a, now) - charExtractionUrgency(b, now)
  })
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

// ── Stage 2 model ─────────────────────────────────────────────────────────────

interface DeliveryTask {
  key: string
  inputName: string
  inputTier: string
  toPlanet: Planet
  toChar: StoredCharacter
  outputNames: string[]
  urgency: Urgency
}

function computeDeliveries(characters: StoredCharacter[], now: number): DeliveryTask[] {
  const allProduced = new Set<string>()
  for (const char of characters)
    for (const planet of char.planets)
      for (const name of planet.outputNames ?? [])
        if (name) allProduced.add(name)

  const inputUrgency = new Map<string, Urgency>()
  for (const char of characters) {
    for (const planet of char.planets) {
      const u = getUrgency(planet, now)
      for (const name of planet.outputNames ?? []) {
        if (!name) continue
        const prev = inputUrgency.get(name)
        if (prev === undefined || URGENCY_ORDER[u] < URGENCY_ORDER[prev])
          inputUrgency.set(name, u)
      }
    }
  }

  const tasks: DeliveryTask[] = []
  const seen = new Set<string>()

  for (const toChar of characters) {
    for (const toPlanet of toChar.planets) {
      const outputNames = toPlanet.outputNames ?? []
      if (outputNames.length === 0) continue

      const neededInputs = new Set<string>()
      for (const out of outputNames)
        for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(out) ?? [])
          neededInputs.add(inp)
      if (neededInputs.size === 0) continue

      for (const inputName of neededInputs) {
        if (!allProduced.has(inputName)) continue
        if (outputNames.includes(inputName)) continue

        let needsHaul = false
        outer: for (const char of characters) {
          for (const planet of char.planets) {
            if (!(planet.outputNames ?? []).includes(inputName)) continue
            if (planet.planetId !== toPlanet.planetId) { needsHaul = true; break outer }
          }
        }
        if (!needsHaul) continue

        const key = `${inputName}|${toPlanet.planetId}`
        if (seen.has(key)) continue
        seen.add(key)

        const resolvedInput = [...PRODUCT_BY_TYPE_ID.values()].find(p => p.name === inputName)

        tasks.push({
          key,
          inputName,
          inputTier: resolvedInput?.tier ?? 'P1',
          toPlanet,
          toChar,
          outputNames,
          urgency: inputUrgency.get(inputName) ?? 'idle',
        })
      }
    }
  }

  return tasks
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onRefresh?: () => Promise<void>
}

const STORAGE_KEY_RESETS   = 'haulplan.resets.checked'
const STORAGE_KEY_DELIVERS = 'haulplan.checked'

function loadChecked(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')) }
  catch { return new Set() }
}
function saveChecked(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s]))
}

export function HaulPlan({ characters, prices, onRefresh }: Props) {
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

  const feederIds  = useMemo(() => computeFeederIds(characters), [characters])
  const orderedChars = useMemo(() => sortCharsByDependency(characters, feederIds, now), [characters, feederIds, now])
  const readyAt    = useMemo(() => findReadyAt(characters), [characters])
  const tasks      = useMemo(() => computeDeliveries(characters, now), [characters, now])

  const [resets,    setResets]    = useState<Set<string>>(() => loadChecked(STORAGE_KEY_RESETS))
  const [checked,   setChecked]   = useState<Set<string>>(() => loadChecked(STORAGE_KEY_DELIVERS))

  function toggleReset(key: string) {
    setResets(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveChecked(STORAGE_KEY_RESETS, next)
      return next
    })
  }

  function toggle(key: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveChecked(STORAGE_KEY_DELIVERS, next)
      return next
    })
  }

  function clearAll() {
    const empty = new Set<string>()
    setResets(empty);  saveChecked(STORAGE_KEY_RESETS, empty)
    setChecked(empty); saveChecked(STORAGE_KEY_DELIVERS, empty)
  }

  if (characters.length === 0)
    return <div className={styles.empty}>Add characters to see the hauling plan.</div>

  // ── Stage 1: chars with extraction planets ──
  const charsWithExtractors = orderedChars.filter(c => c.planets.some(isExtractorPlanet))

  // Total checkable items
  const totalResetItems = charsWithExtractors.reduce((s, c) =>
    s + c.planets.filter(isExtractorPlanet).length, 0)
  const doneResets    = charsWithExtractors.reduce((s, c) =>
    s + c.planets.filter(p => isExtractorPlanet(p) && resets.has(`reset|${p.planetId}`)).length, 0)
  const doneDeliveries = tasks.filter(t => checked.has(t.key)).length
  const totalItems = totalResetItems + tasks.length
  const doneItems  = doneResets + doneDeliveries

  // ── Stage 2: group by char → planet ──
  const byChar = new Map<string, { char: StoredCharacter; byPlanet: Map<number, DeliveryTask[]> }>()
  for (const t of tasks) {
    const cid = String(t.toChar.characterId)
    if (!byChar.has(cid)) byChar.set(cid, { char: t.toChar, byPlanet: new Map() })
    const { byPlanet } = byChar.get(cid)!
    if (!byPlanet.has(t.toPlanet.planetId)) byPlanet.set(t.toPlanet.planetId, [])
    byPlanet.get(t.toPlanet.planetId)!.push(t)
  }

  // Deliver chars in dependency order (same orderedChars order)
  const deliverChars = orderedChars
    .filter(c => byChar.has(String(c.characterId)))
    .map(c => byChar.get(String(c.characterId))!)

  // chars that appear in both stages (need two logins or careful ordering)
  const doubleLoginIds = new Set(
    charsWithExtractors
      .filter(c => byChar.has(String(c.characterId)))
      .map(c => c.characterId)
  )

  const isOverdue = readyAt ? readyAt.getTime() <= now : false

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
            {doneItems > 0 && (
              <button className={styles.clearBtn} onClick={clearAll}>Clear</button>
            )}
          </div>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${totalItems > 0 ? (doneItems / totalItems) * 100 : 0}%` }} />
        </div>
      </div>

      <div className={styles.groupList}>

        {/* ── Stage 1: Reset & Collect ── */}
        {charsWithExtractors.length > 0 && (
          <div className={styles.stageColumn}>
            <div className={styles.stageHeader}>
              <span className={styles.stageNum}>1</span>
              <span className={styles.stageTitle}>Reset &amp; Collect</span>
              <span className={styles.stageDesc}>Visit extraction planets, reset heads, collect P1s</span>
              <span className={styles.stageProgress}>{doneResets}/{totalResetItems}</span>
            </div>

            {charsWithExtractors.map(char => {
              const extractors = char.planets
                .filter(isExtractorPlanet)
                .sort((a, b) => URGENCY_ORDER[getUrgency(a, now)] - URGENCY_ORDER[getUrgency(b, now)])

              const charDone = extractors.every(p => resets.has(`reset|${p.planetId}`))
              const worstChar: Urgency = extractors.reduce<Urgency>((w, p) => {
                const u = getUrgency(p, now)
                return URGENCY_ORDER[u] < URGENCY_ORDER[w] ? u : w
              }, 'idle')

              return (
                <div key={char.characterId} className={`${styles.charBlock} ${charDone ? styles.charBlockDone : ''}`}>
                  <div className={`${styles.charHeader} ${styles[`charHeader_${worstChar}`]}`}>
                    {char.characterId > 0 && (
                      <img
                        src={`https://images.evetech.net/characters/${char.characterId}/portrait?size=32`}
                        className={styles.charPortrait}
                        alt={char.characterName}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <span className={styles.charName}>Log in as {char.characterName}</span>
                    {feederIds.has(char.characterId) && (
                      <span className={styles.feederBadge}>feeder</span>
                    )}
                    {doubleLoginIds.has(char.characterId) && (
                      <span className={styles.doubleLoginBadge} title="Also has delivery stops in Stage 2">2 visits</span>
                    )}
                    <span className={styles.charCount}>
                      {extractors.length} planet{extractors.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {extractors.map(planet => {
                    const u = getUrgency(planet, now)
                    const resetKey = `reset|${planet.planetId}`
                    const isDone = resets.has(resetKey)
                    const p1s = (planet.outputNames ?? []).filter((_, i) =>
                      (planet.outputTiers ?? [])[i] === 'P1'
                    )

                    return (
                      <label
                        key={planet.planetId}
                        className={`${styles.taskRow} ${styles.resetRow} ${isDone ? styles.taskDone : ''}`}
                      >
                        <input
                          type="checkbox"
                          className={styles.taskCheck}
                          checked={isDone}
                          onChange={() => toggleReset(resetKey)}
                        />
                        <div className={styles.taskBody}>
                          <div className={styles.taskMain}>
                            <span
                              className={styles.planetTypeDot}
                              style={{ background: PLANET_COLOR[planet.type] }}
                              title={planet.type}
                            />
                            <span className={styles.planetName}>{planet.name}</span>
                            <span className={styles.taskFor}>reset · collect</span>
                            <div className={styles.collectChips}>
                              {p1s.map(n => (
                                <span key={n} className={styles.collectChip}
                                  style={{ '--tier-color': TIER_COLOR.P1 } as React.CSSProperties}>
                                  <span className={styles.taskProductTier}>P1</span>{n}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className={styles.taskTimer}>
                          {planet.expiryTime ? (
                            <span className={`${styles.timerValue} ${styles[`timer_${u}`]}`}>
                              {formatTimeLeft(planet.expiryTime, now)}
                            </span>
                          ) : (
                            <span className={`${styles.timerValue} ${styles.timer_idle}`}>no timer</span>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Stage 2: Deliver ── */}
        {tasks.length > 0 && (
          <div className={styles.stageColumn}>
            <div className={styles.stageHeader}>
              <span className={styles.stageNum}>2</span>
              <span className={styles.stageTitle}>Deliver</span>
              <span className={styles.stageDesc}>Move collected P1s to factory planets</span>
              <span className={styles.stageProgress}>{doneDeliveries}/{tasks.length}</span>
            </div>

            {deliverChars.map(({ char, byPlanet }) => {
              const allTasks = Array.from(byPlanet.values()).flat()
              const charDone = allTasks.every(t => checked.has(t.key))
              const worstChar: Urgency = allTasks.reduce<Urgency>((w, t) =>
                URGENCY_ORDER[t.urgency] < URGENCY_ORDER[w] ? t.urgency : w, 'idle')

              const sortedPlanets = Array.from(byPlanet.values()).sort((a, b) => {
                const wA = Math.min(...a.map(t => URGENCY_ORDER[t.urgency]))
                const wB = Math.min(...b.map(t => URGENCY_ORDER[t.urgency]))
                return wA - wB
              })

              const productStops = new Map<string, string[]>()
              for (const planetTasks of byPlanet.values()) {
                for (const t of planetTasks) {
                  if (!productStops.has(t.inputName)) productStops.set(t.inputName, [])
                  productStops.get(t.inputName)!.push(t.toPlanet.name)
                }
              }

              return (
                <div key={char.characterId} className={`${styles.charBlock} ${charDone ? styles.charBlockDone : ''}`}>
                  <div className={`${styles.charHeader} ${styles[`charHeader_${worstChar}`]}`}>
                    {char.characterId > 0 && (
                      <img
                        src={`https://images.evetech.net/characters/${char.characterId}/portrait?size=32`}
                        className={styles.charPortrait}
                        alt={char.characterName}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <span className={styles.charName}>Log in as {char.characterName}</span>
                    {doubleLoginIds.has(char.characterId) && (
                      <span className={styles.doubleLoginBadge} title="Also has extraction resets in Stage 1">2 visits</span>
                    )}
                    <span className={styles.charCount}>
                      {allTasks.length} haul{allTasks.length !== 1 ? 's' : ''} · {byPlanet.size} stop{byPlanet.size !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {sortedPlanets.map(planetTasks => {
                    const sample = planetTasks[0]
                    const worstPlanet: Urgency = planetTasks.reduce<Urgency>((w, t) =>
                      URGENCY_ORDER[t.urgency] < URGENCY_ORDER[w] ? t.urgency : w, 'idle')
                    const sorted = [...planetTasks].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency])

                    return (
                      <div key={sample.toPlanet.planetId} className={styles.planetStop}>
                        <div className={`${styles.planetHeader} ${styles[`planetHeader_${worstPlanet}`]}`}>
                          <span className={`${styles.destDot} ${styles[`dot_${worstPlanet}`]}`} />
                          <span className={styles.stopLabel}>Stop</span>
                          <span className={styles.planetName}>{sample.toPlanet.name}</span>
                          <span
                            className={styles.planetTypeDot}
                            style={{ background: PLANET_COLOR[sample.toPlanet.type] }}
                            title={sample.toPlanet.type}
                          />
                          <div className={styles.destOutputs}>
                            {sample.outputNames.map((n, i) => {
                              const tier = sample.toPlanet.outputTiers?.[i] ?? 'P2'
                              return (
                                <span key={n} className={styles.destOutputChip}
                                  style={{ '--tier-color': TIER_COLOR[tier] } as React.CSSProperties}>
                                  <span className={styles.destOutputTier}>{tier}</span>{n}
                                </span>
                              )
                            })}
                          </div>
                        </div>

                        {sorted.map(t => {
                          const allStops = productStops.get(t.inputName) ?? []
                          const otherStops = allStops.filter(p => p !== t.toPlanet.name)
                          return (
                            <label
                              key={t.key}
                              className={`${styles.taskRow} ${checked.has(t.key) ? styles.taskDone : ''}`}
                            >
                              <input
                                type="checkbox"
                                className={styles.taskCheck}
                                checked={checked.has(t.key)}
                                onChange={() => toggle(t.key)}
                              />
                              <div className={styles.taskBody}>
                                <div className={styles.taskMain}>
                                  <span
                                    className={styles.taskProduct}
                                    style={{ '--tier-color': TIER_COLOR[t.inputTier] } as React.CSSProperties}
                                  >
                                    <span className={styles.taskProductTier}>{t.inputTier}</span>
                                    {t.inputName}
                                  </span>
                                  <span className={styles.taskFor}>for {t.outputNames.join(', ')}</span>
                                </div>
                                {otherStops.length > 0 && (
                                  <div className={styles.splitWarning}>
                                    ÷{allStops.length} — take 1/{allStops.length} here, rest to {otherStops.join(', ')}
                                  </div>
                                )}
                              </div>
                              <div className={styles.taskTimer}>
                                {t.toPlanet.expiryTime ? (
                                  <span className={`${styles.timerValue} ${styles[`timer_${t.urgency}`]}`}>
                                    {formatTimeLeft(t.toPlanet.expiryTime, now)}
                                  </span>
                                ) : (
                                  <span className={`${styles.timerValue} ${styles.timer_idle}`}>no timer</span>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {charsWithExtractors.length === 0 && tasks.length === 0 && (
          <div className={styles.emptyInner}>All factory inputs are produced within the same character and system.</div>
        )}
      </div>
    </div>
  )
}
