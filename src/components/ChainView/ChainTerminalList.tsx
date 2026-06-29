import React, { useMemo } from 'react'
import type { StoredCharacter } from '../../types/api'
import type { PITier } from '../../data/schematics'
import { buildChainModel, type TerminalChain } from './chainModel'
import styles from './ChainTerminalList.module.css'

// Tier colors (mirrors ChainGraph; TIER_COLOR centralization is roadmap #6).
const TIER_COLOR: Record<PITier, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}

function formatIsk(isk: number): string {
  if (isk >= 1_000_000_000) return `${(isk / 1_000_000_000).toFixed(2)}B`
  if (isk >= 1_000_000) return `${(isk / 1_000_000).toFixed(1)}M`
  if (isk >= 1_000) return `${(isk / 1_000).toFixed(0)}K`
  return `${Math.round(isk)}`
}

type Health = 'broken' | 'bottleneck' | 'ok' | 'noprice'

function healthOf(t: TerminalChain): Health {
  if (t.price <= 0) return 'noprice'
  if (t.broken) return 'broken'
  if (t.realizedFraction < 0.999) return 'bottleneck'
  return 'ok'
}

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onFocusChain: (terminalTypeId: number) => void
  onSeeEverything: () => void
}

export function ChainTerminalList({ characters, prices, onFocusChain, onSeeEverything }: Props) {
  const model = useMemo(() => buildChainModel(characters, prices), [characters, prices])
  const { terminals } = model

  const totalNow = terminals.reduce((s, t) => s + t.iskHrNow, 0)
  const brokenCount = terminals.filter(t => t.broken).length

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.title}>Chains</span>
          <span className={styles.subtitle}>
            {terminals.length} end product{terminals.length !== 1 ? 's' : ''}
            {' · '}≈ {formatIsk(totalNow)} ISK/hr now
            {brokenCount > 0 && <span className={styles.subtitleWarn}> · {brokenCount} broken</span>}
          </span>
        </div>
        <button className={styles.seeAllBtn} onClick={onSeeEverything} title="Render the full combined production graph">
          See everything <span className={styles.seeAllIcon}>⊞</span>
        </button>
      </div>

      <div className={styles.list}>
        {/* Teaching is gated on spatial room: a sparse list has space to explain. */}
        {terminals.length > 0 && terminals.length <= 4 && (
          <div className={styles.teach}>
            <p>Each row is a <strong>chain</strong> — an end product you sell — ranked by ISK/hr.</p>
            <p><span className={styles.teachDot} style={{ background: '#4ab095' }} /> <strong>Running</strong> at full. <span className={styles.teachDot} style={{ background: '#c8a030' }} /> <strong>Bottleneck</strong>: an input can’t keep up — the % is how much of full speed you’re running. <span className={styles.teachDot} style={{ background: '#d05050' }} /> <strong>Broken</strong>: a missing upstream input — it earns 0 now, but ≈ the figure shown once you add it.</p>
            <p>Click a chain to open just its graph; <strong>See everything</strong> shows the whole empire.</p>
          </div>
        )}
        {terminals.length === 0 && (
          <div className={styles.empty}>No end products yet — assign outputs to your planets in Setup.</div>
        )}
        {terminals.map((t, i) => {
          const health = healthOf(t)
          const pct = Math.round(t.realizedFraction * 100)
          return (
            <button
              key={t.product.typeId}
              className={`${styles.row} ${styles[`row_${health}`]}`}
              onClick={() => onFocusChain(t.product.typeId)}
              title="Open this chain"
            >
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.tierBadge} style={{ color: TIER_COLOR[t.product.tier] }}>{t.product.tier}</span>
              <div className={styles.nameCol}>
                <span className={styles.name}>{t.product.name}</span>
                <span className={styles.meta}>
                  {t.producerKeys.length} planet{t.producerKeys.length !== 1 ? 's' : ''}
                  {' · '}{t.upstreamProducts.length} upstream
                </span>
              </div>

              <div className={styles.statusCol}>
                {health === 'broken' && (
                  <span className={`${styles.pill} ${styles.pillBroken}`} title={`Missing upstream: ${t.missingInputs.join(', ')}`}>
                    ⚠ Broken — needs {t.missingInputs.slice(0, 2).join(', ')}{t.missingInputs.length > 2 ? ` +${t.missingInputs.length - 2}` : ''}
                  </span>
                )}
                {health === 'bottleneck' && (
                  <span className={`${styles.pill} ${styles.pillBottleneck}`} title={`Throughput limited by ${t.bottleneck?.name ?? 'an input'}`}>
                    ⛓ Bottleneck{t.bottleneck ? `: ${t.bottleneck.name}` : ''} · {pct}%
                  </span>
                )}
                {health === 'ok' && (
                  <span className={`${styles.pill} ${styles.pillOk}`}>✓ Running</span>
                )}
                {health === 'noprice' && (
                  <span className={`${styles.pill} ${styles.pillMuted}`}>no market price</span>
                )}
                {t.canExtend && (
                  <span
                    className={`${styles.pill} ${styles.pillExtend}`}
                    title={`A higher-tier recipe (${t.canExtend.toProduct}) uses this product and you have spare planet slots`}
                  >
                    ↗ Extend → {t.canExtend.toTier} {t.canExtend.toProduct}
                  </span>
                )}
                {t.sellInstead && (
                  <span
                    className={`${styles.pill} ${styles.pillSell}`}
                    title={`Selling ${t.sellInstead.toSell.join(' + ')} at market beats producing ${t.product.name} by ≈ ${formatIsk(t.sellInstead.deltaIskHr)}/hr`}
                  >
                    💰 Sell inputs +{formatIsk(t.sellInstead.deltaIskHr)}/hr
                  </span>
                )}
              </div>

              <div className={styles.iskCol}>
                {health === 'noprice' ? (
                  <span className={styles.iskMuted}>—</span>
                ) : (
                  <>
                    <span className={`${styles.iskMain} ${t.broken ? styles.iskBroken : ''}`}>
                      {formatIsk(t.iskHrIntended)}<span className={styles.iskUnit}>/hr</span>
                    </span>
                    <span className={styles.iskSub}>
                      {t.broken
                        ? '0 now'
                        : t.realizedFraction < 0.999
                          ? `now ≈ ${formatIsk(t.iskHrNow)}/hr`
                          : 'at full'}
                    </span>
                  </>
                )}
              </div>

              <span className={styles.chev}>›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
