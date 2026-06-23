import React from 'react'
import type { StoredCharacter, GapItem } from '../../types/api'
import { ALL_SCHEMATICS, PRODUCT_BY_TYPE_ID } from '../../data/schematics'
import styles from './GapAnalysis.module.css'

interface Props {
  characters: StoredCharacter[]
  data?: Map<number, unknown>
}

function computeGaps(): GapItem[] {
  // Without live colony data, no resources are covered — show all gaps
  const covered = new Map<number, { characterId: number; characterName: string; planetId: number }[]>()

  // Find P1 products that are needed but not extracted at P0 level
  const gaps: GapItem[] = []

  for (const schematic of ALL_SCHEMATICS) {
    for (const input of schematic.inputs) {
      const producers = covered.get(input.typeId) ?? []
      if (producers.length === 0) {
        const product = PRODUCT_BY_TYPE_ID.get(input.typeId)
        const outputProduct = PRODUCT_BY_TYPE_ID.get(schematic.output.typeId)
        if (!product) continue

        // Check if already in gaps list
        const existing = gaps.find((g) => g.typeId === input.typeId)
        if (existing) {
          if (outputProduct) {
            const already = existing.neededBy.find((n) => n.typeId === outputProduct.typeId)
            if (!already) existing.neededBy.push({ typeId: outputProduct.typeId, name: outputProduct.name })
          }
        } else {
          gaps.push({
            typeId: input.typeId,
            typeName: product.name,
            tier: product.tier,
            neededBy: outputProduct ? [{ typeId: outputProduct.typeId, name: outputProduct.name }] : [],
            producedBy: []
          })
        }
      }
    }
  }

  return gaps
}

export function GapAnalysis({ characters }: Props) {
  const gaps = computeGaps()

  if (characters.length === 0) {
    return <div className={styles.empty}>Add characters to see gap analysis.</div>
  }

  if (gaps.length === 0) {
    return (
      <div className={styles.allGood}>
        <span className={styles.checkmark}>✓</span>
        All P0 resources needed for your current production chains are covered.
      </div>
    )
  }

  const byTier = gaps.reduce<Record<string, GapItem[]>>((acc, g) => {
    if (!acc[g.tier]) acc[g.tier] = []
    acc[g.tier].push(g)
    return acc
  }, {})

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h2 className={styles.title}>Missing Resources</h2>
        <span className={styles.count}>{gaps.length} gaps found</span>
      </div>
      {Object.entries(byTier).map(([tier, items]) => (
        <div key={tier} className={styles.tierGroup}>
          <div className={styles.tierLabel}>
            <span className={`badge badge-${tier.toLowerCase()}`}>{tier}</span>
            <span className={styles.tierCount}>{items.length} missing</span>
          </div>
          <div className={styles.gapList}>
            {items.map((gap) => (
              <div key={gap.typeId} className={styles.gapItem}>
                <div className={styles.gapName}>{gap.typeName}</div>
                {gap.neededBy.length > 0 && (
                  <div className={styles.neededBy}>
                    needed for:{' '}
                    {gap.neededBy.map((n) => (
                      <span key={n.typeId} className={styles.neededItem}>{n.name}</span>
                    ))}
                  </div>
                )}
                <div className={styles.noProducer}>No character extracts this</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
