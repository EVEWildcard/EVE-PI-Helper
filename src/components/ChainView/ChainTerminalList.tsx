import React, { useMemo } from 'react'
import type { StoredCharacter } from '../../types/api'
import { buildChainModel, type TerminalChain } from './chainModel'
import { TIER_COLOR } from '../../data/tierColors'
import { SeeEverythingButton } from './SeeEverythingButton'
import styles from './ChainTerminalList.module.css'

function formatIsk(isk: number): string {
  if (isk >= 1_000_000_000) return `${(isk / 1_000_000_000).toFixed(2)}B`
  if (isk >= 1_000_000) return `${(isk / 1_000_000).toFixed(1)}M`
  if (isk >= 1_000) return `${(isk / 1_000).toFixed(0)}K`
  return `${Math.round(isk)}`
}

type Health = 'broken' | 'bottleneck' | 'ok' | 'noprice'

// Buffer-fed PI normally runs below 100% of factory nameplate (planets are the
// supply quantum; factories idle for free), so mild throttling is still 'ok' —
// the row shows the % without raising an alarm. Only genuinely low coverage
// gets the bottleneck treatment.
const BOTTLENECK_BELOW = 0.8

function healthOf(t: TerminalChain): Health {
  if (t.price <= 0) return 'noprice'
  if (t.broken) return 'broken'
  if (t.realizedFraction < BOTTLENECK_BELOW) return 'bottleneck'
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
        <SeeEverythingButton onClick={onSeeEverything} />
      </div>

      <div className={styles.list}>
        {/* Teaching is gated on spatial room: a sparse list has space to explain. */}
        {terminals.length > 0 && terminals.length <= 4 && (
          <div className={styles.teach}>
            <p>Each row is a <strong>chain</strong> — an end product you sell — ranked by ISK/hr.</p>
            <p><span className={styles.teachDot} style={{ background: '#4ab095' }} /> <strong>Running</strong> — a % under 100 is your steady-state ceiling, and that’s normal: PI planets rarely balance 1:1, factories just idle for free between hauls. <span className={styles.teachDot} style={{ background: '#c8a030' }} /> <strong>Bottleneck</strong>: an upstream supply covers under {Math.round(BOTTLENECK_BELOW * 100)}% of what your factories could run — worth a look. <span className={styles.teachDot} style={{ background: '#d05050' }} /> <strong>Broken</strong>: a missing upstream input — it earns 0 now, but ≈ the figure shown once you add it. <span className={styles.teachDot} style={{ background: '#8a93a8' }} /> <strong>Imports</strong>: inputs you buy or haul in rather than produce — assumed available, so the chain still runs.</p>
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
                <span className={styles.meta}
                  title={`${t.producerKeys.length} planet${t.producerKeys.length !== 1 ? 's' : ''} make the final product; ${t.chainPlanetCount} planets across the whole chain`}>
                  {t.chainPlanetCount} planet{t.chainPlanetCount !== 1 ? 's' : ''}
                  {' · '}{t.upstreamProducts.length + 1} product{t.upstreamProducts.length + 1 !== 1 ? 's' : ''}
                </span>
              </div>

              <div className={styles.statusCol}>
                {health === 'broken' && (
                  <span className={`${styles.pill} ${styles.pillBroken}`} title={`Missing upstream: ${t.missingInputs.join(', ')}`}>
                    ⚠ Broken — needs {t.missingInputs.slice(0, 2).join(', ')}{t.missingInputs.length > 2 ? ` +${t.missingInputs.length - 2}` : ''}
                  </span>
                )}
                {health === 'bottleneck' && (
                  <span className={`${styles.pill} ${styles.pillBottleneck}`} title={`Throughput limited by ${t.bottleneck?.name ?? 'an input'} — supply comes in whole planets, so +1 producer planet is the lever`}>
                    ⛓ Bottleneck{t.bottleneck ? `: ${t.bottleneck.name}` : ''} · {pct}%
                  </span>
                )}
                {health === 'ok' && (
                  <span className={`${styles.pill} ${styles.pillOk}`}
                    title={t.realizedFraction < 0.999 ? 'Running below factory nameplate — normal for buffer-fed PI; factories idle for free' : undefined}>
                    ✓ Running{t.realizedFraction < 0.999 ? ` @ ${pct}%` : ''}
                  </span>
                )}
                {health === 'noprice' && (
                  <span className={`${styles.pill} ${styles.pillMuted}`}>no market price</span>
                )}
                {t.importedInputs.length > 0 && (
                  <span
                    className={`${styles.pill} ${styles.pillImport}`}
                    title={`Bought or hauled in (not produced from your own chain): ${t.importedInputs.join(', ')}`}
                  >
                    📦 Imports: {t.importedInputs.slice(0, 2).join(', ')}{t.importedInputs.length > 2 ? ` +${t.importedInputs.length - 2}` : ''}
                  </span>
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
