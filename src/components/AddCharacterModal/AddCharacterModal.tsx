import React, { useState } from 'react'
import type { PISkillLevels } from '../../types/api'
import { DEFAULT_PI_SKILLS } from '../../types/api'
import { SkillBar, PI_SKILLS } from '../SkillEditor/SkillEditor'
import styles from './AddCharacterModal.module.css'
import skillStyles from '../SkillEditor/SkillEditor.module.css'

interface Props {
  onClose: () => void
  onAdd: (name: string, skills: PISkillLevels) => Promise<void>
}

export function AddCharacterModal({ onClose, onAdd }: Props) {
  const [name, setName] = useState('')
  const [skills, setSkills] = useState<PISkillLevels>({ ...DEFAULT_PI_SKILLS })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setSkill(key: keyof PISkillLevels, level: number) {
    setSkills((prev) => ({ ...prev, [key]: level }))
  }

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Character name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await onAdd(trimmed, skills)
      onClose()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') onClose()
  }

  const maxPlanets = 1 + skills.interplanetaryConsolidation

  return (
    <div className={skillStyles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={skillStyles.panel}>
        <div className={skillStyles.header}>
          <div className={skillStyles.headerLeft}>
            <div className={skillStyles.charInitial}>+</div>
            <div>
              <div className={skillStyles.charName}>Add Character</div>
              <div className={skillStyles.charSub}>Enter name and PI skill levels</div>
            </div>
          </div>
          <button className={skillStyles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.nameRow}>
          <label className={styles.nameLabel} htmlFor="charName">Character Name</label>
          <input
            id="charName"
            className={styles.nameInput}
            type="text"
            placeholder="e.g. Ratatosk Yaken"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {error && <span className={styles.nameError}>{error}</span>}
        </div>

        <div className={skillStyles.summary}>
          <div className={skillStyles.summaryItem}>
            <span className={skillStyles.summaryVal}>{maxPlanets}</span>
            <span className={skillStyles.summaryLabel}>max planets</span>
          </div>
          <div className={skillStyles.summaryItem}>
            <span className={skillStyles.summaryVal}>{skills.commandCenterUpgrades}</span>
            <span className={skillStyles.summaryLabel}>CCU level</span>
          </div>
          <div className={skillStyles.summaryItem}>
            <span className={skillStyles.summaryVal}>{skills.planetology + skills.advancedPlanetology}</span>
            <span className={skillStyles.summaryLabel}>survey bonus pts</span>
          </div>
        </div>

        <div className={skillStyles.skillList}>
          {PI_SKILLS.map((skill) => (
            <SkillBar
              key={skill.key}
              skill={skill}
              level={skills[skill.key]}
              onChange={(lvl) => setSkill(skill.key, lvl)}
            />
          ))}
        </div>

        <div className={skillStyles.footer}>
          <span className={skillStyles.hint}>Click a segment to set level · click active level to clear</span>
          <div className={skillStyles.footerBtns}>
            <button className={skillStyles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={skillStyles.saveBtn} onClick={handleAdd} disabled={saving || !name.trim()}>
              {saving ? 'Adding…' : 'Add Character'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
