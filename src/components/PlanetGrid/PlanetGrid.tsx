import React from 'react'
import type { EsiPlanet, EsiColony, ExtractorExpiry } from '../../types/api'
import { PRODUCT_BY_TYPE_ID } from '../../data/schematics'
import styles from './PlanetGrid.module.css'

interface Props {
  characterName: string
  planets: EsiPlanet[]
  colonies: Map<number, EsiColony>
  expiries: ExtractorExpiry[]
}

const PLANET_COLORS: Record<string, string> = {
  temperate: '#3a6040',
  barren:    '#6a5030',
  oceanic:   '#2a5070',
  ice:       '#4a6080',
  gas:       '#5a4080',
  lava:      '#803020',
  storm:     '#405070',
  plasma:    '#704020'
}

function formatExpiry(hours: number): { label: string; cls: string } {
  if (hours <= 0) return { label: 'EXPIRED', cls: 'badge-danger' }
  if (hours < 4)  return { label: `${hours.toFixed(1)}h`, cls: 'badge-danger' }
  if (hours < 24) return { label: `${hours.toFixed(0)}h`, cls: 'badge-warn' }
  const days = hours / 24
  return { label: `${days.toFixed(1)}d`, cls: 'badge-ok' }
}

export function PlanetGrid({ characterName, planets, colonies, expiries }: Props) {
  if (planets.length === 0) {
    return (
      <div className={styles.empty}>
        No planets found for {characterName}. Make sure the character has PI colonies set up and you have viewed them in-client recently.
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {planets.map((planet) => {
        const colony = colonies.get(planet.planet_id)
        const planetExpiries = expiries.filter((e) => e.planetId === planet.planet_id)
        const extracts: number[] = []
        const produces: number[] = []

        if (colony) {
          for (const pin of colony.pins) {
            if (pin.extractor_details?.product_type_id) {
              extracts.push(pin.extractor_details.product_type_id)
            }
            if (pin.factory_details?.schematic_id) {
              produces.push(pin.factory_details.schematic_id)
            }
          }
        }

        const uniqueExtracts = [...new Set(extracts)]
        const color = PLANET_COLORS[planet.planet_type] ?? '#404050'
        const upgradeRoman = ['', 'I', 'II', 'III', 'IV', 'V'][planet.upgrade_level] ?? planet.upgrade_level

        return (
          <div key={planet.planet_id} className={styles.card} style={{ '--planet-color': color } as React.CSSProperties}>
            <div className={styles.cardHeader}>
              <div className={styles.planetDot} style={{ background: color }} />
              <span className={styles.planetType}>{planet.planet_type}</span>
              <span className={styles.upgrade}>Lv {upgradeRoman}</span>
              <span className={styles.pins}>{planet.num_pins} pins</span>
            </div>

            <div className={styles.cardBody}>
              {uniqueExtracts.length > 0 ? (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Extracting</span>
                  <div className={styles.tags}>
                    {uniqueExtracts.map((tid) => {
                      const p = PRODUCT_BY_TYPE_ID.get(tid)
                      return (
                        <span key={tid} className={`badge badge-p0`}>
                          {p?.name ?? `type:${tid}`}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Extracting</span>
                  <span className={styles.none}>—</span>
                </div>
              )}

              {produces.length > 0 && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Factories</span>
                  <span className={styles.meta}>{produces.length} active</span>
                </div>
              )}
            </div>

            {planetExpiries.length > 0 && (
              <div className={styles.expiryBar}>
                {planetExpiries.map((exp, i) => {
                  const { label, cls } = formatExpiry(exp.hoursRemaining)
                  return (
                    <span key={i} className={`badge ${cls}`}>
                      {label}
                    </span>
                  )
                })}
              </div>
            )}

            <div className={styles.cardFooter}>
              <span className={styles.updated}>
                Updated {new Date(planet.last_update).toLocaleDateString()}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
