import { useState } from 'react'
import type { PISkillLevels, StoredCharacter } from '../../types/api'
import { PI_SKILLS } from './skillMeta'
import type { SkillMeta } from './skillMeta'
import styles from './SkillEditor.module.css'

export type { SkillMeta }
export { PI_SKILLS }

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

// ── SkillBar ─────────────────────────────────────────────────────────────────

interface TrainingInfo {
  toLevel: number
  finishDate: string
  startDate?: string
  trainingSP?: number
  levelStartSP?: number
  levelEndSP?: number
}

interface SkillBarProps {
  skill: SkillMeta
  level: number
  onChange: (level: number) => void
  training?: TrainingInfo
  /** Planned override level (above real level) */
  overrideLevel?: number
  /** Called when user clicks a pip above real level; null = clear override */
  onOverrideChange?: (level: number | null) => void
}

export function SkillBar({ skill, level, onChange, training, overrideLevel, onOverrideChange }: SkillBarProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const effectiveLevel = overrideLevel ?? level
  const displayLevel = hovered ?? effectiveLevel
  const label = skill.levelLabels[displayLevel]

  const trainingProgress = (() => {
    if (!training?.startDate || !training.finishDate) return null
    const now = Date.now()
    const start = new Date(training.startDate).getTime()
    const finish = new Date(training.finishDate).getTime()
    const timeFraction = Math.min(1, Math.max(0, (now - start) / (finish - start)))
    // SP-based progress if we have the data: accounts for SP already banked before this queue slot
    if (training.trainingSP !== undefined && training.levelStartSP !== undefined && training.levelEndSP !== undefined) {
      const spAtNow = training.trainingSP + (training.levelEndSP - training.trainingSP) * timeFraction
      return Math.min(1, Math.max(0, (spAtNow - training.levelStartSP) / (training.levelEndSP - training.levelStartSP)))
    }
    return timeFraction
  })()

  const trainingTimeStr = training ? (() => {
    const ms = Math.max(0, new Date(training.finishDate).getTime() - Date.now())
    const d = Math.floor(ms / 86_400_000)
    const h = Math.floor((ms % 86_400_000) / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  })() : null

  return (
    <div className={styles.skillRow}>
      <div className={styles.skillTop}>
        <div className={styles.skillInfo}>
          <span className={styles.skillIcon}>{skill.icon}</span>
          <span className={styles.skillName}>{skill.name}</span>
        </div>

        <div className={styles.skillRight}>
        <div className={styles.bar} onMouseLeave={() => setHovered(null)}>
          {[1, 2, 3, 4, 5].map((pip) => {
            const active = pip <= (hovered ?? effectiveLevel)
            const isHoverTarget = hovered !== null && pip <= hovered
            const isTraining = !!training && pip === level + 1
            const isOverride = overrideLevel !== undefined && pip === overrideLevel && pip > level
            const isOverrideFill = !isOverride && overrideLevel !== undefined && pip > level && pip < overrideLevel

            function handleClick() {
              if (onOverrideChange) {
                if (pip > level) {
                  onOverrideChange(pip === overrideLevel ? null : pip)
                }
              } else {
                onChange(pip === level ? 0 : pip)
              }
            }

            return (
              <button
                key={pip}
                className={[
                  styles.pip,
                  active ? styles.pipActive : '',
                  isHoverTarget ? styles.pipHover : '',
                  isTraining ? styles.pipTraining : '',
                  isOverride ? styles.pipOverride : '',
                  isOverrideFill ? styles.pipOverrideFill : '',
                ].filter(Boolean).join(' ')}
                style={isTraining ? {
                  background: '#0a0c10',
                  boxShadow: '0 0 7px rgba(93, 207, 170, 0.35)',
                  overflow: 'hidden',
                  transition: 'none',
                } : undefined}
                onMouseEnter={() => setHovered(pip)}
                onClick={handleClick}
                title={`Level ${pip}`}
                aria-label={`Set ${skill.name} to level ${pip}`}
              >
                {isTraining && (() => {
                  const fill = trainingProgress ?? 0
                  const fillPct = `${(fill * 100).toFixed(1)}%`
                  return (
                    <>
                      {fill > 0 && (
                        <span style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: fillPct,
                          background: '#1a5a40',
                          pointerEvents: 'none',
                        }} />
                      )}
                      <span style={{
                        position: 'absolute', left: fillPct, top: 0, bottom: 0, right: 0,
                        background: '#0a0c10',
                        overflow: 'hidden',
                        clipPath: 'inset(0)',
                        pointerEvents: 'none',
                      }}>
                        <span style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: '30%',
                          background: 'linear-gradient(90deg, transparent, #2a7a5a, #5dcfaa, #2a7a5a, transparent)',
                          animation: 'pipSweepLine 6s linear infinite',
                          pointerEvents: 'none',
                        }} />
                      </span>
                    </>
                  )
                })()}
              </button>
            )
          })}
        </div>

        <div className={styles.levelReadout}>
          <span className={`${styles.levelNum} ${displayLevel > 0 ? styles.levelActive : ''}`}>
            {displayLevel > 0 ? ROMAN[displayLevel] : '—'}
          </span>
          <span className={styles.levelLabel}>{label}</span>
        </div>
        </div>
      </div>
      {training && (
        <div className={styles.skillTrainingRow}>
          ▲ {skill.name} → {training.toLevel} &nbsp;{trainingTimeStr} left
        </div>
      )}
      <span className={styles.skillDesc}>{skill.description}</span>
    </div>
  )
}

// ── SkillEditor (edit existing character) ────────────────────────────────────

interface Props {
  character: StoredCharacter
  onClose: () => void
  onSave: (skills: PISkillLevels) => void
}

export function SkillEditor({ character, onClose, onSave }: Props) {
  const [skills, setSkills] = useState<PISkillLevels>({ ...character.piSkills })
  const [saving, setSaving] = useState(false)

  function setSkill(key: keyof PISkillLevels, level: number) {
    setSkills((prev) => ({ ...prev, [key]: level }))
  }

  async function handleSave() {
    setSaving(true)
    await window.api.updatePISkills(character.characterId, skills)
    onSave(skills)
    setSaving(false)
  }

  const maxPlanets = 1 + skills.interplanetaryConsolidation

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.charInitial}>{character.characterName[0].toUpperCase()}</div>
            <div>
              <div className={styles.charName}>{character.characterName}</div>
              <div className={styles.charSub}>PI Skills</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryVal}>{maxPlanets}</span>
            <span className={styles.summaryLabel}>max planets</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryVal}>{skills.commandCenterUpgrades}</span>
            <span className={styles.summaryLabel}>CCU level</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryVal}>{skills.planetology + skills.advancedPlanetology}</span>
            <span className={styles.summaryLabel}>survey bonus pts</span>
          </div>
        </div>

        <div className={styles.skillList}>
          {PI_SKILLS.map((skill) => (
            <SkillBar
              key={skill.key}
              skill={skill}
              level={skills[skill.key]}
              onChange={(lvl) => setSkill(skill.key, lvl)}
            />
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>Click a segment to set level · click active level to clear</span>
          <div className={styles.footerBtns}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Skills'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
