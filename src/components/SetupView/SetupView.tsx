import React, { useState, useRef, useEffect } from 'react'
import type { StoredCharacter, PISkillLevels, Planet } from '../../types/api'
import { PLANET_TYPES } from '../../types/api'
import { SkillBar, PI_SKILLS } from '../SkillEditor/SkillEditor'
import { PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT } from '../../data/schematics'
import { seedEmpireByAccounts, clearTestData, MAX_ACCOUNTS, ALTS_PER_ACCOUNT, DEFAULT_DEV_ACCOUNTS } from '../../dev/seedData'
import styles from './SetupView.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTrainingTime(finishDate: string): string {
  const ms = Math.max(0, new Date(finishDate).getTime() - Date.now())
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtTrainingShort(finishDate: string): string {
  const ms = Math.max(0, new Date(finishDate).getTime() - Date.now())
  if (ms <= 0) return '≈0m'
  const totalMin = Math.ceil(ms / 60_000)
  const totalH   = Math.ceil(ms / 3_600_000)
  const totalD   = Math.ceil(ms / 86_400_000)
  const totalW   = Math.ceil(ms / (7 * 86_400_000))
  const totalMo  = Math.ceil(ms / (30 * 86_400_000))
  if (totalH < 2)  return `≈${totalMin}m`
  if (totalD < 2)  return `≈${totalH}h`
  if (totalW < 2)  return `≈${totalD}d`
  if (totalMo < 3) return `≈${totalW}w`
  return `≈${totalMo}mo`
}

// ── Constants ─────────────────────────────────────────────────────────────────

export { PLANET_LABEL, PLANET_COLOR } from '../../data/planetColors'
import { PLANET_LABEL, PLANET_COLOR } from '../../data/planetColors'
import { TIER_COLOR } from '../../data/tierColors'

// Dev empire seeder is shown when running locally (`npm run dev`, DEV=true) OR
// when VITE_DEV_TOOLS=1 is set at build time — scope that var to Vercel's
// Preview environment to expose the seeder on preview URLs without shipping it
// to Production. When both are statically false the whole block tree-shakes out.
const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === '1'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIsk(isk: number): string {
  if (isk >= 1_000_000_000) return `${(isk / 1_000_000_000).toFixed(2)}B`
  if (isk >= 1_000_000)     return `${(isk / 1_000_000).toFixed(1)}M`
  if (isk >= 1_000)         return `${(isk / 1_000).toFixed(0)}K`
  return isk.toFixed(0)
}

// ── Expiry badge ──────────────────────────────────────────────────────────────

function ExpiryBadge({ iso }: { iso: string }) {
  const expiry = new Date(iso)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const msLeft = expiry.getTime() - now
  const expired = msLeft <= 0
  const h = Math.floor(msLeft / 3600000)
  const m = Math.floor((msLeft % 3600000) / 60000)

  const label = expired ? 'Expired' : h > 0 ? `${h}h ${m}m` : `${m}m`

  const urgency = expired ? 'expired'
    : msLeft < 2 * 3600000  ? 'critical'   // <2h
    : msLeft < 8 * 3600000  ? 'warning'    // <8h
    : 'ok'

  return (
    <span
      className={styles[`expiry_${urgency}`]}
      title={expired
        ? `Extractor cycle expired — set up a new extraction cycle (expired ${expiry.toLocaleString()})`
        : `Extractor cycle expires in ${label} — the extractors will stop running at ${expiry.toLocaleString()}`}
    >
      {label}
    </span>
  )
}

// ── Inline editable name ──────────────────────────────────────────────────────

function InlineEdit({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onCommit(trimmed)
    else setDraft(value)
    setEditing(false)
  }
  if (editing) {
    return (
      <input ref={inputRef} className={`${styles.inlineInput} ${className ?? ''}`} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }} />
    )
  }
  return (
    <span className={`${styles.inlineName} ${className ?? ''}`} onClick={() => { setDraft(value); setEditing(true) }} title="Click to rename">
      {value}<span className={styles.editHint}>✎</span>
    </span>
  )
}

// ── Planet row ────────────────────────────────────────────────────────────────

interface PlanetRowProps {
  planet: Planet
  onRename: (name: string) => void
  hideOutputTier?: boolean
  prices: Record<number, number>
}

function PlanetRow({ planet, onRename, hideOutputTier, prices }: PlanetRowProps) {
  const outputs = (planet.outputs ?? []).map((tid, i) => {
    const local = PRODUCT_BY_TYPE_ID.get(tid)
    return {
      typeId: tid,
      name: local?.name ?? planet.outputNames?.[i] ?? `#${tid}`,
      tier: (local?.tier ?? planet.outputTiers?.[i] ?? 'P1') as string,
    }
  })

  const highestTier = outputs.reduce<string | null>((best, o) => {
    const order: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }
    return best == null || (order[o.tier] ?? 0) > (order[best] ?? 0) ? o.tier : best
  }, null)
  const isExtractor = highestTier === 'P1' || highestTier === null
  const isIdleFactory = !isExtractor && (planet.factoryCount ?? 0) > 0 && outputs.length === 0

  // Active = extractor with a future expiry, or factory with outputs configured
  const isActive = isExtractor
    ? (!!planet.expiryTime && new Date(planet.expiryTime).getTime() > Date.now())
    : outputs.length > 0

  // ISK/hr: sum over each output product. We split factoryCount evenly across outputs.
  // units/hr per factory = (output.quantity / cycleTime) * 3600
  const totalIskPerHr = outputs.reduce((sum, o) => {
    const price = prices[o.typeId]
    if (!price) return sum
    const sch = SCHEMATIC_BY_OUTPUT.get(o.typeId)
    if (!sch) return sum
    const factoriesForThis = Math.max(1, Math.floor((planet.factoryCount ?? 1) / outputs.length))
    const unitsPerHr = (sch.output.quantity / sch.cycleTime) * 3600 * factoriesForThis
    return sum + unitsPerHr * price
  }, 0)

  return (
    <div className={styles.planetEntry}>
      <div className={styles.planetRow}>
        {/* left: dot + type label stacked */}
        <div className={styles.planetTypeCol}>
          <span className={styles.planetDot} style={{ background: PLANET_COLOR[planet.type] }} />
          <span className={styles.planetTypeLabel}>{PLANET_LABEL[planet.type]}</span>
        </div>
        <span title={isExtractor
          ? 'Extraction planet — extracts raw P0 resources and processes them into P1 materials'
          : 'Factory planet — processes materials from other planets into higher-tier products'
        } className={styles.planetKindIcon}>
          {isExtractor ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="1.5" y1="10.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <line x1="6" y1="9.5" x2="6" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="6" y1="3" x2="3.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="6" y1="3" x2="8.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="5.5" width="9" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="4" y="3" width="1.8" height="2.5" rx="0.4" stroke="currentColor" strokeWidth="1.1"/>
              <rect x="6.2" y="1.5" width="1.8" height="4" rx="0.4" stroke="currentColor" strokeWidth="1.1"/>
              <line x1="3.5" y1="8" x2="3.5" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
              <line x1="6" y1="8" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
              <line x1="8.5" y1="8" x2="8.5" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
            </svg>
          )}
        </span>

        {/* center: two-line block */}
        <div className={styles.planetInfo}>
          <div className={styles.planetInfoTop}>
            <div className={styles.planetNameWrap}>
              <InlineEdit value={planet.name} onCommit={onRename} className={styles.planetName} />
            </div>
            {(planet.ccu != null || planet.extractorCount != null || isIdleFactory) && (
              <span className={styles.planetMeta}>
                {planet.ccu != null && <span>CCU {planet.ccu}</span>}
                {(planet.extractorCount ?? 0) > 0 && (
                  <span className={styles.metaIconStat}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="1.5" y1="10.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="6" y1="9.5" x2="6" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="6" y1="3" x2="3.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="6" y1="3" x2="8.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    {planet.extractorCount}
                  </span>
                )}
                {(planet.factoryCount ?? 0) > 0 && (
                  <span className={styles.metaIconStat}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="5.5" width="9" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="4" y="3" width="1.8" height="2.5" rx="0.4" stroke="currentColor" strokeWidth="1.1"/><rect x="6.2" y="1.5" width="1.8" height="4" rx="0.4" stroke="currentColor" strokeWidth="1.1"/><line x1="3.5" y1="8" x2="3.5" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/><line x1="6" y1="8" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/><line x1="8.5" y1="8" x2="8.5" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/></svg>
                    {planet.factoryCount}
                  </span>
                )}
                {planet.expiryTime && <ExpiryBadge iso={planet.expiryTime} />}
                {isIdleFactory && (
                  <span className={styles.idleBadge} title="Factory planet with no schematics configured — not producing anything">
                    IDLE
                  </span>
                )}
              </span>
            )}
          </div>
          {(outputs.length > 0 || totalIskPerHr > 0) && (
            <div className={styles.planetInfoBottom}>
              {outputs.map(o => (
                <span
                  key={o.typeId}
                  className={styles.outputChip}
                  style={{ '--pill-color': TIER_COLOR[o.tier] } as React.CSSProperties}
                >
                  {!hideOutputTier && <span className={styles.outputTier}>{o.tier}</span>}
                  {o.name}
                </span>
              ))}
              {totalIskPerHr > 0 && (
                <span
                  className={`${styles.iskPerHr} ${!isActive ? styles.iskPerHrIdle : ''}`}
                  title={isActive
                    ? `Estimated using market average prices × output rate`
                    : `Extractor cycle not running — potential if active`}
                >
                  ≈ {formatIsk(totalIskPerHr)}/hr
                </span>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Character card ────────────────────────────────────────────────────────────

interface CharCardProps {
  char: StoredCharacter
  onRemove: () => void
  onSkillChange: (skills: PISkillLevels) => void
  onSkillOverride: (overrides: Partial<Record<keyof PISkillLevels, number>>) => void
  onClearOverrides: () => void
  onAddPlanet: (type: string) => void
  onRenamePlanet: (planetId: number, name: string) => void
  planetSort: PlanetSort
  prices: Record<number, number>
}

type PlanetSort = 'name' | 'tier' | 'expiry'

const TIER_SORT_ORDER: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }
const TIER_LABELS: Record<string, string> = {
  P1: 'P1 — Extraction', P2: 'P2 — Refining', P3: 'P3 — Specialized', P4: 'P4 — Advanced',
}

function sortedPlanets(planets: Planet[], sort: PlanetSort): Planet[] {
  return [...planets].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'tier') {
      const ta = Math.max(0, ...(a.outputTiers ?? []).map(t => TIER_SORT_ORDER[t] ?? 0))
      const tb = Math.max(0, ...(b.outputTiers ?? []).map(t => TIER_SORT_ORDER[t] ?? 0))
      return ta - tb
    }
    if (sort === 'expiry') {
      const ta = a.expiryTime ? new Date(a.expiryTime).getTime() : Infinity
      const tb = b.expiryTime ? new Date(b.expiryTime).getTime() : Infinity
      return ta - tb
    }
    return 0
  })
}

function getPlanetGroupKey(planet: Planet, sort: PlanetSort): string {
  if (sort === 'tier') {
    const tiers = planet.outputTiers ?? []
    const max = tiers.reduce<string | null>((best, t) =>
      best == null || (TIER_SORT_ORDER[t] ?? 0) > (TIER_SORT_ORDER[best] ?? 0) ? t : best, null)
    return max ?? 'Unassigned'
  }
  if (sort === 'name') return planet.name[0]?.toUpperCase() ?? '#'
  if (sort === 'expiry') {
    if (!planet.expiryTime) return 'No timer'
    const h = Math.floor((new Date(planet.expiryTime).getTime() - Date.now()) / 3600000)
    if (h < 0) return 'Expired'
    if (h < 24) return 'Expiring today'
    return `${Math.floor(h / 24)}d`
  }
  return ''
}

function getGroupLabel(key: string, sort: PlanetSort): string {
  if (sort === 'tier') return TIER_LABELS[key] ?? key
  return key
}

function CharCard({ char, onRemove, onSkillChange, onSkillOverride, onClearOverrides, onAddPlanet, onRenamePlanet, planetSort, prices }: CharCardProps) {
  const [skillsOpen, setSkillsOpen] = useState(false)

  const ov = char.skillOverrides ?? {}
  const hasOverrides = Object.keys(ov).length > 0

  function effectiveLevel(key: keyof PISkillLevels): number {
    return Math.max(char.piSkills[key], ov[key] ?? 0)
  }

  function handleOverrideChange(key: keyof PISkillLevels, level: number | null) {
    const next = { ...ov }
    if (level === null || level <= char.piSkills[key]) {
      delete next[key]
    } else {
      next[key] = level
    }
    onSkillOverride(next)
  }

  const maxPlanets = 1 + effectiveLevel('interplanetaryConsolidation')
  const piEnabled = effectiveLevel('commandCenterUpgrades') >= 1

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        {char.characterId > 0 ? (
          <img
            src={`https://images.evetech.net/characters/${char.characterId}/portrait?size=64`}
            className={styles.charPortrait}
            alt={char.characterName}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className={styles.charInitial}>{char.characterName[0].toUpperCase()}</div>
        )}
        <div className={styles.charNameRow}>
          <span className={styles.charName}>{char.characterName}</span>
          {piEnabled && (
            <span className={styles.piEnabledBadge} title="PI enabled — has Command Center Upgrades I+">
              PI
            </span>
          )}
        </div>
        <span className={styles.planetCount} title="Planets used / max">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" opacity="0.7">
            <circle cx="6" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
            <ellipse cx="6" cy="6" rx="5.5" ry="2.2" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
          </svg>
          {char.planets.length}/{maxPlanets}
        </span>
        <button className={styles.removeCharBtn} onClick={onRemove} title="Remove">×</button>
      </div>

      <button className={styles.skillsToggle} onClick={() => setSkillsOpen((v) => !v)}>
        <span className={styles.skillsLabel}>PI Skills</span>
        {!skillsOpen && <span className={styles.skillsSummaryRow}>
          {(() => {
            const tr = char.skillTraining
            return (<>
              <span className={`${styles.skillChip} ${tr?.interplanetaryConsolidation ? styles.skillChipTraining : ''} ${ov.interplanetaryConsolidation ? styles.skillChipOverride : ''}`} title="Max planets (Interplanetary Consolidation)">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={styles.chipIcon}>
                  <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                  <ellipse cx="5.5" cy="5.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
                </svg>
                <span className={styles.chipVal}>{1 + effectiveLevel('interplanetaryConsolidation')}</span>
                {tr?.interplanetaryConsolidation && <span className={styles.chipTraining}>▲{tr.interplanetaryConsolidation.toLevel} {fmtTrainingShort(tr.interplanetaryConsolidation.finishDate)}</span>}
              </span>
              <span className={`${styles.skillChip} ${tr?.commandCenterUpgrades ? styles.skillChipTraining : ''} ${ov.commandCenterUpgrades ? styles.skillChipOverride : ''}`} title="Command Center Upgrades — CPU & powergrid level">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={styles.chipIcon}>
                  <path d="M6.5 1.5 L4 6h3L4.5 10 L9 4.5H6L8 1.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none"/>
                </svg>
                <span className={styles.chipVal}>{effectiveLevel('commandCenterUpgrades')}</span>
                {tr?.commandCenterUpgrades && <span className={styles.chipTraining}>▲{tr.commandCenterUpgrades.toLevel} {fmtTrainingShort(tr.commandCenterUpgrades.finishDate)}</span>}
              </span>
              <span className={`${styles.skillChip} ${tr?.remoteSensing ? styles.skillChipTraining : ''} ${ov.remoteSensing ? styles.skillChipOverride : ''}`} title="Remote Sensing — survey range in jumps">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={styles.chipIcon}>
                  <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/>
                  <path d="M3 3 Q5.5 1 8 3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/>
                  <path d="M1.5 1.5 Q5.5 -1 9.5 1.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5"/>
                  <path d="M3 8 Q5.5 10 8 8" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/>
                  <path d="M1.5 9.5 Q5.5 12 9.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5"/>
                </svg>
                <span className={styles.chipVal}>{[0,0,1,3,5,7,9][effectiveLevel('remoteSensing')] ?? 0}j</span>
                {tr?.remoteSensing && <span className={styles.chipTraining}>▲{tr.remoteSensing.toLevel} {fmtTrainingShort(tr.remoteSensing.finishDate)}</span>}
              </span>
              <span className={`${styles.skillChip} ${tr?.planetology ? styles.skillChipTraining : ''} ${ov.planetology ? styles.skillChipOverride : ''}`} title="Planetology — survey accuracy">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={styles.chipIcon}>
                  <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="6.8" y1="6.8" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <line x1="4.5" y1="2.5" x2="4.5" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
                  <line x1="2.5" y1="4.5" x2="6.5" y2="4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
                </svg>
                <span className={styles.chipVal}>{effectiveLevel('planetology')}</span>
                {tr?.planetology && <span className={styles.chipTraining}>▲{tr.planetology.toLevel} {fmtTrainingShort(tr.planetology.finishDate)}</span>}
              </span>
              <span className={`${styles.skillChip} ${tr?.advancedPlanetology ? styles.skillChipTraining : ''} ${ov.advancedPlanetology ? styles.skillChipOverride : ''}`} title="Advanced Planetology — enhanced survey accuracy">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={styles.chipIcon}>
                  <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="6.8" y1="6.8" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <line x1="4.5" y1="2.5" x2="4.5" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
                  <line x1="2.5" y1="4.5" x2="6.5" y2="4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
                  <circle cx="4.5" cy="4.5" r="1" fill="currentColor"/>
                </svg>
                <span className={styles.chipVal}>{effectiveLevel('advancedPlanetology')}</span>
                {tr?.advancedPlanetology && <span className={styles.chipTraining}>▲{tr.advancedPlanetology.toLevel} {fmtTrainingShort(tr.advancedPlanetology.finishDate)}</span>}
              </span>
            </>)
          })()}
        </span>}
        <span className={styles.chevron}>{skillsOpen ? '▲' : '▼'}</span>
      </button>

      {skillsOpen && (
        <div className={styles.skillsPanel}>
          {hasOverrides && (
            <button
              className={styles.clearOverridesBtn}
              onClick={(e) => { e.stopPropagation(); onClearOverrides() }}
              title="Clear all planned skill overrides"
            >
              🧹 Clear planned skills
            </button>
          )}
          {PI_SKILLS.map((skill) => {
            const t = char.skillTraining?.[skill.key]
            return (
              <SkillBar key={skill.key} skill={skill} level={char.piSkills[skill.key]}
                onChange={(lvl) => onSkillChange({ ...char.piSkills, [skill.key]: lvl })}
                training={t}
                overrideLevel={ov[skill.key]}
                onOverrideChange={(lvl) => handleOverrideChange(skill.key, lvl)}
              />
            )
          })}
        </div>
      )}

      {char.planets.length > 0 && (
        <div className={styles.planetList}>
          {(() => {
            const sorted = sortedPlanets(char.planets, planetSort)
            const rows: React.ReactNode[] = []
            let lastGroup = ''
            for (const planet of sorted) {
              const groupKey = getPlanetGroupKey(planet, planetSort)
              if (groupKey !== lastGroup && planetSort !== 'name') {
                rows.push(
                  <div key={`group-${groupKey}`} className={styles.planetGroupHeader}>
                    {getGroupLabel(groupKey, planetSort)}
                  </div>
                )
                lastGroup = groupKey
              }
              rows.push(
                <PlanetRow
                  key={planet.planetId}
                  planet={planet}
                  onRename={(name) => onRenamePlanet(planet.planetId, name)}
                  hideOutputTier={planetSort === 'tier'}
                  prices={prices}
                />
              )
            }
            return rows
          })()}
        </div>
      )}
    </div>
  )
}

// ── Import from EVE modal ─────────────────────────────────────────────────────

interface ImportModalProps {
  onImport: (clientId: string) => void
  onClose: () => void
  importing: boolean
  error: string | null
}

function ImportModal({ onImport, onClose, importing, error }: ImportModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>Import from EVE Online</h2>
        <p className={styles.modalText}>
          Your browser will open the EVE Online login page. Log in as the character you want to import — the app will read their planets and skills automatically.
        </p>
        {error && <div className={styles.modalError}>{error}</div>}
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onClose}>Cancel</button>
          <button
            className={styles.modalConfirm}
            onClick={() => onImport('')}
            disabled={importing}
          >
            {importing ? 'Waiting for login…' : 'Login with EVE →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SetupView ─────────────────────────────────────────────────────────────────

interface Props {
  characters: StoredCharacter[]
  onAddCharacter: () => void
  onImportCharacter: (char: StoredCharacter) => void
  onRemoveCharacter: (id: number) => void
  onSkillChange: (id: number, skills: PISkillLevels) => void
  onSkillOverride: (id: number, overrides: Partial<Record<keyof PISkillLevels, number>>) => void
  onClearOverrides: (id: number) => void
  onAddPlanet: (characterId: number, type: string) => void
  onRenamePlanet: (characterId: number, planetId: number, name: string) => void
  onDone: () => void
  prices: Record<number, number>
}

export function SetupView({ characters, onAddCharacter, onImportCharacter, onRemoveCharacter, onSkillChange, onSkillOverride, onClearOverrides, onAddPlanet, onRenamePlanet, onDone, prices }: Props) {
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [planetSort, setPlanetSort] = useState<PlanetSort>(
    () => (localStorage.getItem('setup.planetSort') as PlanetSort) ?? 'name'
  )
  // Dev-only generator (stress-test the production chain). The Scale slider is
  // ACCOUNT-based: one seeded empire of N accounts (each running all 3 alts);
  // the more accounts, the likelier each alt is maxed (all maxed at the ceiling).
  const curAccounts = Math.max(1, Math.ceil(characters.length / ALTS_PER_ACCOUNT))
  const [seedAccounts, setSeedAccounts] = useState(() =>
    Math.min(MAX_ACCOUNTS, characters.length ? curAccounts : DEFAULT_DEV_ACCOUNTS)
  )
  const commitSeed = () => { seedEmpireByAccounts(seedAccounts); window.location.reload() }

  // Dev-only: on a fresh local store, auto-seed the default test empire (≈8 alts
  // / 48 planets) with suggestions on, to match the canonical readability-test
  // view. Fires once per browser (a flag survives "Clear" so empty stays empty);
  // adjust scale anytime with the slider.
  useEffect(() => {
    if (!DEV_TOOLS) return
    if (characters.length > 0) return
    if (localStorage.getItem('evepi.dev.seeded')) return
    localStorage.setItem('evepi.dev.seeded', '1')
    localStorage.setItem('chainView.suggestions', 'true')
    seedEmpireByAccounts(DEFAULT_DEV_ACCOUNTS)
    window.location.reload()
  }, [characters.length])

  async function handleImport() {
    setImporting(true)
    setImportError(null)
    try {
      const char = await window.api.importCharacter('')
      onImportCharacter(char)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h1 className={styles.title}>Setup</h1>
          <span className={styles.subtitle}>Add characters, assign planets, pick what each one produces</span>
        </div>
        <div className={styles.planetSortBar}>
          {DEV_TOOLS && (
            <>
              <span
                className={styles.planetSortLabel}
                title={`Dev: seed ONE empire of N accounts (each runs all ${ALTS_PER_ACCOUNT} alts). The more accounts, the likelier each alt is maxed; at ${MAX_ACCOUNTS} accounts every alt is maxed (the supported ceiling). The first alt of the first account is always maxed.`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Scale
                <input
                  type="range"
                  min={1}
                  max={MAX_ACCOUNTS}
                  value={seedAccounts}
                  onChange={(e) => setSeedAccounts(Number(e.target.value))}
                  onPointerUp={commitSeed}
                  onKeyUp={(e) => { if (e.key !== 'Tab') commitSeed() }}
                  style={{ width: 150, verticalAlign: 'middle' }}
                />
                {/* Fixed width so the readout never reflows the slider while dragging. */}
                <span style={{ display: 'inline-block', width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                  {seedAccounts} acct{seedAccounts === 1 ? '' : 's'}
                </span>
              </span>
              <button
                className={styles.planetSortBtn}
                title="Dev only: wipe all characters"
                onClick={() => { localStorage.setItem('evepi.dev.seeded', '1'); clearTestData(); window.location.reload() }}
              >
                Clear
              </button>
              <span className={styles.planetSortLabel} style={{ marginLeft: 8 }}>Sort planets</span>
            </>
          )}
          {!DEV_TOOLS && <span className={styles.planetSortLabel}>Sort planets</span>}
          {(['name', 'tier', 'expiry'] as PlanetSort[]).map(opt => (
            <button
              key={opt}
              className={`${styles.planetSortBtn} ${planetSort === opt ? styles.planetSortBtnActive : ''}`}
              onClick={() => { setPlanetSort(opt); localStorage.setItem('setup.planetSort', opt) }}
            >
              {opt === 'name' ? 'Name' : opt === 'tier' ? 'Tier' : 'Expiry'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.cards}>
        {[...characters].sort((a, b) => b.planets.length - a.planets.length).map((char) => (
          <CharCard
            key={char.characterId}
            char={char}
            onRemove={() => onRemoveCharacter(char.characterId)}
            onSkillChange={(skills) => onSkillChange(char.characterId, skills)}
            onSkillOverride={(overrides) => onSkillOverride(char.characterId, overrides)}
            onClearOverrides={() => onClearOverrides(char.characterId)}
            onAddPlanet={(type) => onAddPlanet(char.characterId, type)}
            onRenamePlanet={(pid, name) => onRenamePlanet(char.characterId, pid, name)}
            planetSort={planetSort}
            prices={prices}
          />
        ))}

        {/* Add character card */}
        <div className={styles.addCharCard}>
          <button
            className={styles.importBtn}
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? '⏳ Waiting for login…' : '↓ Import from EVE'}
          </button>
          <span className={styles.importHint}>
            {importing
              ? 'Log in in your browser, then come back here.'
              : 'Opens EVE login — imports character, skills & planets automatically.'}
          </span>
          {importError && (
            <>
              <span className={styles.importError}>{importError}</span>
              <button className={styles.manualAddBtn} onClick={onAddCharacter}>
                Add manually instead
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
