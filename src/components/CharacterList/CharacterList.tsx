import React from 'react'
import type { StoredCharacter } from '../../types/api'
import styles from './CharacterList.module.css'

interface Props {
  characters: StoredCharacter[]
  selectedId: number | null
  onSelect: (id: number) => void
  onAdd: () => void
  onRemove: (id: number) => void
  onEditSkills: (character: StoredCharacter) => void
  onRefresh: () => void
  globalLoading: boolean
}

export function CharacterList({
  characters,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onEditSkills
}: Props) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Characters</span>
      </div>

      <div className={styles.list}>
        {characters.map((char) => {
          const maxPlanets = 1 + char.piSkills.interplanetaryConsolidation
          return (
            <button
              key={char.characterId}
              className={`${styles.charItem} ${selectedId === char.characterId ? styles.selected : ''}`}
              onClick={() => onSelect(char.characterId)}
            >
              <div className={styles.portrait}>
                <div className={styles.charInitial}>{char.characterName[0].toUpperCase()}</div>
              </div>
              <div className={styles.info}>
                <span className={styles.name}>{char.characterName}</span>
                <span className={styles.meta}>{maxPlanets} planet{maxPlanets !== 1 ? 's' : ''} max</span>
              </div>
              <div className={styles.hoverActions}>
                <button
                  className={styles.actionBtn}
                  onClick={(e) => { e.stopPropagation(); onEditSkills(char) }}
                  title="Edit PI skills"
                >
                  ⚡
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.removeBtn}`}
                  onClick={(e) => { e.stopPropagation(); onRemove(char.characterId) }}
                  title="Remove character"
                >
                  ×
                </button>
              </div>
            </button>
          )
        })}
      </div>

      <button className={styles.addBtn} onClick={onAdd}>
        + Add Character
      </button>
    </aside>
  )
}
