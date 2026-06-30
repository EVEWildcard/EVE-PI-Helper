import React, { useState, useEffect, useMemo } from 'react'
import type { StoredCharacter, Planet } from '../../types/api'
import { PRODUCT_BY_NAME, SCHEMATIC_INPUTS_BY_NAME, ALL_SCHEMATICS, PRODUCT_BY_TYPE_ID } from '../../data/schematics'
import { PLANET_COLOR } from '../../data/planetColors'
import { TIER_COLOR } from '../../data/tierColors'
import { validateDeliveryUsage } from './validateDeliveryUsage'
import styles from './HaulPlan.module.css'

// output name → its inputs with per-cycle quantities (all factory cycles are 1h,
// so quantity is proportional to hourly demand). Used to split a deposit between
// multiple consumers by how much each actually needs.
const INPUTS_QTY_BY_NAME = new Map<string, { name: string; qty: number }[]>()
for (const s of ALL_SCHEMATICS) {
  const outName = PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name
  if (!outName) continue
  INPUTS_QTY_BY_NAME.set(outName, s.inputs
    .map(i => ({ name: PRODUCT_BY_TYPE_ID.get(i.typeId)?.name ?? '', qty: i.quantity }))
    .filter(x => x.name))
}

/** "half to A · half to B", or "60% to A · 40% to B" for uneven demand. */
function formatSplit(splits: { name: string; share: number }[]): string {
  const allEven = splits.every(s => Math.abs(s.share - splits[0].share) < 0.01)
  const word = (s: { name: string; share: number }) =>
    allEven
      ? `${splits.length === 2 ? 'half' : `1/${splits.length}`} to ${s.name}`
      : `${Math.round(s.share * 100)}% to ${s.name}`
  return splits.map(word).join(' · ')
}

/** Phrase a receiving alt's share of a split deposit, for the "grab your half"
 *  pickup reminder. Even 2-/3-way splits read naturally; anything else falls back
 *  to an approximate percentage. */
function grabSharePhrase(share: number, parts: number): string {
  if (parts === 2 && Math.abs(share - 0.5) < 0.02) return 'grab your half'
  if (parts === 3 && Math.abs(share - 1 / 3) < 0.02) return 'grab your third'
  return `grab your share (~${Math.round(share * 100)}%)`
}

/** How much of `material` a character consumes per cycle across all its factories. */
function materialDemand(char: StoredCharacter, material: string): number {
  let q = 0
  for (const p of char.planets)
    for (const out of p.outputNames ?? [])
      for (const inp of INPUTS_QTY_BY_NAME.get(out) ?? [])
        if (inp.name === material) q += inp.qty
  return q
}

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
  waitId?: number     // deferred: characterId of that later producer (for ordering the return visit)
  urgency: Urgency
}

interface DeliverStop {
  planet: Planet
  outputs: { name: string; tier: string }[]
  inputs: DeliverInput[]
}

interface ResetItem { planet: Planet; p1s: string[]; urgency: Urgency }
interface DepositSplit { name: string; share: number }
interface DepositItem { material: string; tier: string; toNames: string[]; splits?: DepositSplit[] }

export interface AltStep {
  id: string          // unique per step (an alt can appear twice: primary + return visit)
  char: StoredCharacter
  isReturn?: boolean   // a return visit to finish deliveries that were waiting on a later alt
  verbs: string[]
  resets: ResetItem[]
  stops: DeliverStop[]
  deposits: DepositItem[]
  taskKeys: string[]
}

function resetKey(p: Planet): string { return `reset|${p.planetId}` }
function deliverKey(p: Planet, material: string): string { return `deliver|${p.planetId}|${material}` }
function depositKey(charId: number, material: string): string { return `deposit|${charId}|${material}` }

// An extractor counts as ESI-verified-done when its program is running again
// (expiry is in the future) — i.e. the player reset it in-game since the run began.
function isResetVerified(planet: Planet, now: number): boolean {
  return !!planet.expiryTime && new Date(planet.expiryTime).getTime() > now
}

// ── login order ───────────────────────────────────────────────────────────────
// Extractors/low-tier first, then by extractor urgency. Used to seed a run; once a
// run is going we FREEZE this order (see `frozenOrder`) so resetting an extractor
// in-game doesn't reshuffle the plan underneath the player.
function charMaxTier(char: StoredCharacter): number {
  let r = 0
  for (const p of char.planets) for (const t of p.outputTiers ?? []) r = Math.max(r, TIER_RANK[t] ?? 0)
  return r
}
function charExtractionUrgency(char: StoredCharacter, now: number): number {
  const ex = char.planets.filter(isExtractorPlanet)
  return ex.length ? Math.min(...ex.map(p => URGENCY_ORDER[getUrgency(p, now)])) : 99
}
export function deriveLoginOrder(characters: StoredCharacter[], now: number): number[] {
  return [...characters]
    .sort((a, b) =>
      charMaxTier(a) - charMaxTier(b) ||
      charExtractionUrgency(a, now) - charExtractionUrgency(b, now) ||
      a.characterName.localeCompare(b.characterName))
    .map(c => c.characterId)
}

export function computeSteps(characters: StoredCharacter[], now: number, orderIds?: number[]): AltStep[] {
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

  // ── login order ──
  // Use the frozen order when one is supplied (a run is in progress); chars not in
  // it (newly added) fall to the end in freshly-derived order. Otherwise derive fresh.
  const fallback = deriveLoginOrder(characters, now)
  const fpos = new Map(fallback.map((id, i) => [id, i]))
  const frozen = orderIds?.length ? orderIds : fallback
  const fzpos = new Map(frozen.map((id, i) => [id, i]))
  const rank = (id: number) => fzpos.has(id) ? fzpos.get(id)! : 1e6 + (fpos.get(id) ?? 0)
  const order = [...characters].sort((a, b) => rank(a.characterId) - rank(b.characterId))
  const orderIndex = new Map<number, number>()
  order.forEach((c, i) => orderIndex.set(c.characterId, i))

  // ── availability accumulator (what's in the container as you progress) ──
  const availableBefore = new Map<number, Set<string>>()
  const acc = new Set<string>()
  for (const char of order) {
    availableBefore.set(char.characterId, new Set(acc))
    for (const m of producedByChar.get(char.characterId) ?? []) acc.add(m)
  }

  // ── build a primary step per alt, plus a return-visit step for any alt that
  //    has deliveries waiting on a LATER alt (you come back once that alt has
  //    deposited what you need). ──
  const primarySteps: AltStep[] = []
  const returnSteps: { step: AltStep; afterIndex: number }[] = []

  order.forEach(char => {
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
        let waitId: number | undefined
        if (!self) {
          const earlier = others.find(id => (orderIndex.get(id) ?? 0) < (orderIndex.get(cid) ?? 0))
          if (earlier != null) { ready = true; fromName = nameById.get(earlier) }
          else {
            const later = others.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))[0]
            if (later != null) { waitName = nameById.get(later); waitId = later }
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
          waitId,
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
        const consumers = characters
          .filter(c2 => c2.characterId !== cid && (neededByChar.get(c2.characterId)?.has(material) ?? false))
        const toNames = consumers.map(c2 => c2.characterName)
        // When a material feeds 2+ consumers, split it by how much each needs.
        let splits: DepositSplit[] | undefined
        if (consumers.length > 1) {
          const demands = consumers.map(c2 => ({ name: c2.characterName, d: Math.max(1, materialDemand(c2, material)) }))
          const total = demands.reduce((s, x) => s + x.d, 0)
          splits = demands.map(x => ({ name: x.name, share: x.d / total }))
        }
        return { material, tier: tierOf(material), toNames, splits }
      })
      .filter(d => d.toNames.length > 0)
      .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])

    // Split each stop's inputs into "do now" vs "deferred" (waiting on a later alt).
    const nowStops: DeliverStop[] = []
    const deferredStops: DeliverStop[] = []
    let returnAfter = -1
    for (const s of stops) {
      const nowInputs = s.inputs.filter(i => i.waitId == null)
      const defInputs = s.inputs.filter(i => i.waitId != null)
      if (nowInputs.length) nowStops.push({ ...s, inputs: nowInputs })
      if (defInputs.length) {
        // On the return visit those inputs are now sitting in the container.
        deferredStops.push({
          ...s,
          inputs: defInputs.map(i => ({ ...i, ready: true, self: false, fromName: i.waitName, waitName: undefined, waitId: undefined })),
        })
        for (const i of defInputs) returnAfter = Math.max(returnAfter, orderIndex.get(i.waitId!) ?? -1)
      }
    }

    // verbs (primary)
    const hasPickup = nowStops.some(s => s.inputs.some(i => i.ready && !i.self))
    const verbs: string[] = []
    if (resets.length) { verbs.push('Reset', 'Collect') }
    if (deposits.length) verbs.push('Input')
    if (hasPickup) verbs.push('Pickup')
    if (nowStops.length) verbs.push('Deliver')

    const taskKeys: string[] = [
      ...resets.map(r => resetKey(r.planet)),
      ...nowStops.flatMap(s => s.inputs.map(i => deliverKey(s.planet, i.material))),
      ...deposits.map(d => depositKey(cid, d.material)),
    ]

    primarySteps.push({ id: String(cid), char, verbs, resets, stops: nowStops, deposits, taskKeys })

    if (deferredStops.length) {
      returnSteps.push({
        afterIndex: returnAfter,
        step: {
          id: `${cid}:return`,
          char,
          isReturn: true,
          verbs: ['Pickup', 'Deliver'],
          resets: [],
          stops: deferredStops,
          deposits: [],
          taskKeys: deferredStops.flatMap(s => s.inputs.map(i => deliverKey(s.planet, i.material))),
        },
      })
    }
  })

  // Assemble: each return visit slots in right after the last alt it was waiting on.
  const afterMap = new Map<number, AltStep[]>()
  const tail: AltStep[] = []
  for (const r of returnSteps) {
    if (r.afterIndex >= 0 && r.afterIndex < primarySteps.length) {
      const arr = afterMap.get(r.afterIndex) ?? []
      arr.push(r.step); afterMap.set(r.afterIndex, arr)
    } else tail.push(r.step)
  }
  const result: AltStep[] = []
  primarySteps.forEach((ps, idx) => {
    result.push(ps)
    for (const rs of afterMap.get(idx) ?? []) result.push(rs)
  })
  result.push(...tail)
  return result
}

const VERB_PHRASE: Record<string, string> = {
  Reset: 'Reset', Collect: 'Collect',
  Input: 'Input into shared PI container',
  Pickup: 'Pick up from container', Deliver: 'Deliver',
}

// Clickable section header. Completed rows in the section are hidden by default to
// keep the list tidy as you work; clicking the header reveals them again.
function SectionHeader({ kind, label, done, total, expanded, onToggle, onCompleteAll }: {
  kind: string; label: string; done: number; total: number
  expanded: boolean; onToggle: () => void; onCompleteAll: () => void
}) {
  const hasDone = done > 0
  const complete = total > 0 && done === total
  return (
    <div className={styles.sectionHeaderRow}>
      <button type="button" className={styles.sectionTitle} onClick={onToggle} data-collapsible={hasDone ? '' : undefined}>
        <span className={styles.sectionDot} data-kind={kind} />
        <span className={styles.sectionLabel}>{label}</span>
        <span className={styles.sectionCount} data-complete={complete ? '' : undefined}>
          {complete ? 'all done' : `${done}/${total}`}
        </span>
        {hasDone && <span className={styles.sectionChevron}>{expanded ? '▾' : '▸'}</span>}
      </button>
      {!complete && total > 1 && (
        <button type="button" className={styles.completeAllBtn} onClick={onCompleteAll} title={`Mark all ${total} as done`}>
          Complete all
        </button>
      )}
    </div>
  )
}

// ── persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY_CHECKED = 'haulplan.checked'
const STORAGE_KEY_STEP    = 'haulplan.step'
const STORAGE_KEY_ORDER   = 'haulplan.order'

function loadChecked(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_CHECKED) ?? '[]')) }
  catch { return new Set() }
}
function saveChecked(s: Set<string>) {
  localStorage.setItem(STORAGE_KEY_CHECKED, JSON.stringify([...s]))
}
function loadOrder(): number[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_ORDER) ?? '[]') }
  catch { return [] }
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

  // Frozen login order — keeps the plan stable during a run. Only changes when the
  // character set changes (additively) or on an explicit "Reset run"; NOT when an
  // extractor's timer ticks or gets reset in-game.
  const [frozenOrder, setFrozenOrder] = useState<number[]>(loadOrder)
  useEffect(() => {
    const ids = characters.map(c => c.characterId)
    setFrozenOrder(prev => {
      const cur = new Set(ids)
      const prevSet = new Set(prev)
      const kept = prev.filter(id => cur.has(id))                       // drop removed alts
      const added = deriveLoginOrder(characters, Date.now())            // append new alts at the end
        .filter(id => !prevSet.has(id))
      const next = [...kept, ...added]
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev
      localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(next))
      return next
    })
  }, [characters])

  const steps = useMemo(() => computeSteps(characters, now, frozenOrder), [characters, now, frozenOrder])
  const readyAt = useMemo(() => findReadyAt(characters), [characters])

  // Dev-only guard: surface any delivery↔usage mismatch (an alt told to leave a
  // material nobody downstream consumes, or an input with no deposit feeding it).
  // Tree-shaken out of production builds; the invariant is also covered by tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const violations = validateDeliveryUsage(steps)
    if (violations.length)
      console.warn('[HaulPlan] delivery↔usage mismatch:', violations.map(v => v.message))
  }, [steps])

  // material → (receiving alt name → its share) for split deposits. Lets a
  // receiving alt be reminded to grab only ITS half of a shared-container drop.
  const splitShareByMaterial = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const s of steps)
      for (const d of s.deposits)
        if (d.splits) {
          const inner = m.get(d.material) ?? new Map<string, number>()
          for (const sp of d.splits) inner.set(sp.name, sp.share)
          m.set(d.material, inner)
        }
    return m
  }, [steps])

  const [checked, setChecked] = useState<Set<string>>(loadChecked)
  const [active, setActive] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(STORAGE_KEY_STEP) ?? '0', 10)
    return Number.isFinite(v) ? v : 0
  })

  const activeIdx = Math.min(active, Math.max(0, steps.length - 1))
  useEffect(() => { localStorage.setItem(STORAGE_KEY_STEP, String(activeIdx)) }, [activeIdx])

  // When an alt is fully done its task list collapses to a compact summary; the
  // player can expand it again. Reset the expand toggle whenever the alt changes.
  const [expandDone, setExpandDone] = useState(false)
  useEffect(() => { setExpandDone(false) }, [activeIdx])

  // Per-section reveal of completed rows (collapsed by default). Reset on alt change.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  useEffect(() => { setExpandedSections(new Set()) }, [activeIdx])
  const toggleSection = (id: string) => setExpandedSections(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // When the top-bar attention pill is clicked, jump to the first alt that has
  // an expired extractor and briefly pulse its reset rows so the eye lands on
  // exactly what needs doing.
  const [pulsing, setPulsing] = useState(false)
  useEffect(() => {
    if (!focusNonce) return
    const idx = steps.findIndex(s => s.resets.some(r => r.urgency === 'expired'))
    if (idx >= 0) setActive(idx)
    setPulsing(true)
    const t = setTimeout(() => setPulsing(false), 2400)
    return () => clearTimeout(t)
  }, [focusNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Make ESI-verified resets sticky for the duration of a run. A verified reset
  // (extractor running again) is otherwise only derived live from `now`, so when
  // that fresh program later completes — expiry passes while you're still working
  // through later alts — the verification flips off and the already-completed
  // alt's green checkmark would vanish. Once we've seen it verified, record it as
  // done so the completion can't un-stick mid-run.
  useEffect(() => {
    const verified = steps
      .flatMap(s => s.resets)
      .filter(r => isResetVerified(r.planet, now))
      .map(r => resetKey(r.planet))
    if (verified.length === 0) return
    setChecked(prev => {
      const next = new Set(prev)
      let changed = false
      for (const k of verified) if (!next.has(k)) { next.add(k); changed = true }
      if (!changed) return prev
      saveChecked(next)
      return next
    })
  }, [steps, now])

  function toggle(key: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveChecked(next)
      return next
    })
  }

  // Tick every sub-item in a section in one click ("Complete all").
  function checkAll(keys: string[]) {
    setChecked(prev => {
      const next = new Set(prev)
      for (const k of keys) next.add(k)
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
    // Start a fresh run: re-derive the login order from the current state.
    const fresh = deriveLoginOrder(characters, Date.now())
    setFrozenOrder(fresh)
    localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(fresh))
  }

  if (characters.length === 0)
    return <div className={styles.empty}>Add characters to see the hauling plan.</div>

  // Resets the player already did in-game (ESI sees the extractor running again) are
  // auto-verified (✓✓) — counted done without being manually checked, and never
  // removed from the plan.
  const verifiedResetKeys = new Set<string>()
  for (const s of steps)
    for (const r of s.resets)
      if (isResetVerified(r.planet, now)) verifiedResetKeys.add(resetKey(r.planet))

  const isDone = (key: string) => checked.has(key) || verifiedResetKeys.has(key)

  const allKeys = steps.flatMap(s => s.taskKeys)
  const doneItems = allKeys.filter(isDone).length
  const totalItems = allKeys.length

  const isOverdue = readyAt ? readyAt.getTime() <= now : false
  const step = steps[activeIdx]

  function stepDone(s: AltStep): boolean {
    return s.taskKeys.length > 0 && s.taskKeys.every(isDone)
  }

  // Pickup heads-up: materials this alt must collect from the shared container
  // (left by an earlier alt) before undocking.
  const pickupMaterials = step
    ? [...new Set(step.stops.flatMap(s => s.inputs.filter(i => i.ready && !i.self).map(i => i.material)))]
    : []
  // Of those, the ones that are split between multiple consumers — grab only your share.
  const splitPickups = step
    ? pickupMaterials.filter(m => splitShareByMaterial.get(m)?.has(step.char.characterName))
    : []

  const activeDone = step ? stepDone(step) : false

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

      {/* Stepper: each circle = one login. An alt can appear twice — a primary
          visit and a later "return" visit to finish deliveries that were waiting
          on a later alt. Arrows show you move left-to-right through the logins. */}
      <div className={styles.stepper}>
        {steps.map((s, i) => {
          const done = stepDone(s)
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <span className={styles.stepArrow} aria-hidden="true">→</span>}
              <button
                className={`${styles.step} ${i === activeIdx ? styles.stepActive : ''} ${done ? styles.stepDone : ''} ${s.isReturn ? styles.stepReturn : ''}`}
                onClick={() => setActive(i)}
              >
                <span className={styles.stepCircleWrap}>
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
                  {/* Badge sits OUTSIDE the clipped circle so it isn't cropped. */}
                  {s.isReturn && <span className={styles.stepReturnBadge} title="Return visit — come back to finish deliveries that were waiting on a later alt">↩</span>}
                </span>
                <span className={styles.stepName}>
                  {s.char.characterName}{s.isReturn && <span className={styles.stepReturnTag}> · return</span>}
                </span>
                <span className={styles.stepVerbs}>{s.verbs.join(' · ') || 'Nothing to do'}</span>
              </button>
            </React.Fragment>
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
              <span className={styles.altStepNum}>
                Alt {activeIdx + 1} of {steps.length}{step.isReturn && ' · return visit'}
              </span>
              <span className={styles.altName}>
                {step.isReturn ? 'Log back in as ' : 'Log in as '}{step.char.characterName}
              </span>
              <span className={styles.altPlan}>
                {step.isReturn
                  ? 'Finish the deliveries that were waiting on a later alt — they’re in the container now.'
                  : (step.verbs.map(v => VERB_PHRASE[v] ?? v).join(' → ') || 'Nothing to do this login')}
              </span>
            </div>
          </div>

          {pickupMaterials.length > 0 && !activeDone && (
            <div className={styles.pickupCallout}>
              <span className={styles.pickupIcon}>📦</span>
              <span>
                <strong>Before undocking:</strong> pick up {pickupMaterials.join(', ')} from the shared container.
                {splitPickups.length > 0 && (
                  <span className={styles.splitGrab}> Grab only your share of {splitPickups.join(', ')} — it’s split with other alts.</span>
                )}
              </span>
            </div>
          )}

          {activeDone && !expandDone ? (
            <div className={styles.donePanel}>
              <span className={styles.doneCheckBig}>✓</span>
              <div className={styles.donePanelText}>
                <strong>{step.char.characterName} is all done.</strong>
                <button className={styles.linkBtn} onClick={() => setExpandDone(true)}>Show steps</button>
              </div>
            </div>
          ) : (
          <>
          {activeDone && (
            <button className={styles.collapseBtn} onClick={() => setExpandDone(false)}>▲ Collapse completed steps</button>
          )}

          {/* Reset & collect */}
          {step.resets.length > 0 && (() => {
            const rows = step.resets.map(r => {
              const key = resetKey(r.planet)
              const verified = verifiedResetKeys.has(key)
              return { r, key, verified, done: verified || checked.has(key) }
            })
            const doneCount = rows.filter(x => x.done).length
            const expanded = expandedSections.has('reset')
            const visible = expanded ? rows : rows.filter(x => !x.done)
            return (
              <div className={styles.section}>
                <SectionHeader kind="reset" label="Reset & collect extractors" done={doneCount} total={rows.length} expanded={expanded} onToggle={() => toggleSection('reset')} onCompleteAll={() => checkAll(rows.map(x => x.key))} />
                {visible.map(({ r, key, verified, done }) => (
                  <label key={r.planet.planetId} className={`${styles.taskRow} ${done ? styles.taskDone : ''} ${pulsing && r.urgency === 'expired' && !done ? styles.taskPulse : ''}`}>
                    {verified ? (
                      <span className={styles.verifiedCheck} title="Verified via ESI — this extractor is running again">✓✓</span>
                    ) : (
                      <input type="checkbox" className={styles.taskCheck} checked={done} onChange={() => toggle(key)} />
                    )}
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
                ))}
              </div>
            )
          })()}

          {/* Deliver */}
          {step.stops.length > 0 && (() => {
            const expanded = expandedSections.has('deliver')
            let doneCount = 0, total = 0
            for (const s of step.stops) for (const i of s.inputs) { total++; if (isDone(deliverKey(s.planet, i.material))) doneCount++ }
            return (
              <div className={styles.section}>
                <SectionHeader kind="deliver" label="Deliver inputs to your factories" done={doneCount} total={total} expanded={expanded} onToggle={() => toggleSection('deliver')} onCompleteAll={() => checkAll(step.stops.flatMap(s => s.inputs.map(i => deliverKey(s.planet, i.material))))} />
                {step.stops.map(stop => {
                  const inputs = expanded ? stop.inputs : stop.inputs.filter(i => !isDone(deliverKey(stop.planet, i.material)))
                  if (inputs.length === 0) return null
                  return (
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
                      {inputs.map(inp => {
                        const key = deliverKey(stop.planet, inp.material)
                        const done = isDone(key)
                        const splitMap = inp.ready && !inp.self ? splitShareByMaterial.get(inp.material) : undefined
                        const myShare = splitMap?.get(step.char.characterName)
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
                                <span className={styles.sourceNote}>
                                  pick up from container{inp.fromName ? ` · left by ${inp.fromName}` : ''}
                                  {myShare != null && (
                                    <span className={styles.splitGrab}> · {grabSharePhrase(myShare, splitMap!.size)}</span>
                                  )}
                                </span>
                              ) : (
                                <span className={styles.waitNote}>⏳ waiting on {inp.waitName ?? 'an earlier alt'} — come back after</span>
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
          })()}

          {/* Deposit into shared container */}
          {step.deposits.length > 0 && (() => {
            const rows = step.deposits.map(d => ({ d, key: depositKey(step.char.characterId, d.material), done: isDone(depositKey(step.char.characterId, d.material)) }))
            const doneCount = rows.filter(x => x.done).length
            const expanded = expandedSections.has('deposit')
            const visible = expanded ? rows : rows.filter(x => !x.done)
            return (
              <div className={styles.section}>
                <SectionHeader kind="input" label="Drop into shared PI container" done={doneCount} total={rows.length} expanded={expanded} onToggle={() => toggleSection('deposit')} onCompleteAll={() => checkAll(rows.map(x => x.key))} />
                {visible.map(({ d, key, done }) => (
                  <label key={d.material} className={`${styles.taskRow} ${done ? styles.taskDone : ''}`}>
                    <input type="checkbox" className={styles.taskCheck} checked={done} onChange={() => toggle(key)} />
                    <div className={styles.taskBody}>
                      <span className={styles.chip} style={{ '--tier-color': TIER_COLOR[d.tier] } as React.CSSProperties}>
                        <span className={styles.chipTier}>{d.tier}</span>{d.material}
                      </span>
                      {d.splits ? (
                        <span className={styles.sourceNote}>
                          split <span className={styles.splitLabel}>{formatSplit(d.splits)}</span>
                        </span>
                      ) : (
                        <span className={styles.sourceNote}>for {d.toNames.join(', ')}</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )
          })()}

          {step.taskKeys.length === 0 && (
            <div className={styles.nothing}>Nothing to do on this alt right now.</div>
          )}
          </>
          )}
        </div>

        {/* Nav */}
        <div className={styles.nav}>
          <button className={styles.navBtn} disabled={activeIdx === 0} onClick={() => setActive(i => Math.max(0, i - 1))}>
            ← Prev
          </button>
          <span className={styles.navHint}>
            {stepDone(step) ? 'All done on this alt' : `${step.taskKeys.filter(isDone).length}/${step.taskKeys.length} done`}
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
