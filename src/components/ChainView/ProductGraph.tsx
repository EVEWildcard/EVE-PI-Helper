import React, { useLayoutEffect, useRef, useState, useMemo, useEffect } from 'react'
import type { StoredCharacter } from '../../types/api'
import type { PITier } from '../../data/schematics'
import { TIER_COLOR } from '../../data/tierColors'
import { buildChainModel, COVERAGE_ISSUE_THRESHOLD, type ProductFlow, type ProductStatus } from './chainModel'
import { buildProductGraph } from './productModel'
import {
  NODE_W,
  computeColCounts, computeTotalW, estimateTotalH, computeScale,
  computeMeasuredPositions, computeArrows,
  vEstColY as vEstColYPure, getNodeEstPos as getNodeEstPosPure,
  type ChainNode, type ArrowPath,
} from './chainLayout'
import styles from './ChainView.module.css'

const COL_LABELS = ['P1 — Refined', 'P2 — Processed', 'P3 — Specialized', 'P4 — Advanced']

// Status → accent color. The product node's border/stripe carry it so a problem
// reads at a glance without a side panel. Under-coverage is graded, not binary:
// buffer-fed PI normally runs factories oversized vs. sustained supply, so a
// mild gap is quiet — only genuinely low coverage turns amber/red, and only on
// the ROOT product (downstream nodes point at the root instead of also flaring).
const STATUS_COLOR: Record<ProductStatus, string> = {
  constrained: '#c8923c',   // baseline; accentFor() grades it by coverage
  limited:     '#5a8fb0',   // quiet — the root carries the alarm
  missing:     '#d65a5a',
  excess:      '#c8923c',
  terminal:    '#4ab095',
  ok:          '#5a8fb0',
  imported:    '#6b7488',
}

const SEVERE = '#d65a5a'
const MILD = '#c8923c'

/** Coverage of downstream demand this node's supply can sustain. */
function coverageOf(flow: ProductFlow): number {
  return flow.demand > 0 ? flow.supply / flow.demand : 1
}

// A root supply limit is graded by how much of demand it covers; everything
// else keeps its flat status color.
function accentFor(flow: ProductFlow): string {
  if (flow.status === 'constrained') {
    const c = coverageOf(flow)
    return c < 0.5 ? SEVERE : c < COVERAGE_ISSUE_THRESHOLD ? MILD : STATUS_COLOR.ok
  }
  return STATUS_COLOR[flow.status]
}

// Only the informative states get a word. Everything healthy stays quiet — the
// accent color is enough; a wall of "BALANCED" is just noise. ("If something's
// wrong tell me, otherwise we're good.")
function labelFor(flow: ProductFlow): string | null {
  switch (flow.status) {
    case 'constrained': return `covers ${Math.round(coverageOf(flow) * 100)}%`
    case 'limited':     return flow.limitedBy ? `⛓ ${flow.limitedBy}` : null
    case 'missing':     return 'missing'
    case 'excess':      return 'overproduced'
    default:            return null
  }
}

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onBack?: () => void
  backLabel?: string
  /** Switch to the per-planet graph (the raw, unaggregated view). */
  onShowPlanets?: () => void
}

function fmtRate(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 100) return n.toFixed(0)
  return n.toFixed(n >= 10 ? 0 : 1)
}

/** Flood a directed adjacency map from `start`, accumulating into `seed`. */
function reachClosure(start: string[], adj: Map<string, Set<string>>, seed: Set<string>): Set<string> {
  const seen = seed
  const stack = [...start]
  while (stack.length) {
    const k = stack.pop()!
    for (const n of adj.get(k) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  }
  return seen
}

export function ProductGraph({ characters, prices, onBack, backLabel = 'Back', onShowPlanets }: Props) {
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const canvasInnerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [containerH, setContainerH] = useState(0)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setContainerW(r.width)
      setContainerH(r.height)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const [arrows, setArrows] = useState<ArrowPath[]>([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })
  const [nodePos, setNodePos] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [nodeSizes, setNodeSizes] = useState<Map<string, { w: number; h: number }>>(new Map())
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const model = useMemo(() => buildChainModel(characters, prices), [characters, prices])
  const { nodes, edges, flowByKey } = useMemo(() => buildProductGraph(model), [model])

  // Planet count per product (the "×N" badge) from the flow's producer list.
  const countByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const [key, f] of flowByKey) m.set(key, f.producerKeys.length)
    return m
  }, [flowByKey])

  const maxAssignedCol = nodes.reduce((m, n) => Math.max(m, n.column), -1)

  // Hover lights only what flows UP INTO the hovered product (its ancestors +
  // self), dimming the rest — same as the planet graph. To inspect a downstream
  // consumer, hover that node.
  const bwd = useMemo(() => {
    const bwd = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!bwd.has(e.toKey)) bwd.set(e.toKey, new Set())
      bwd.get(e.toKey)!.add(e.fromKey)
    }
    return bwd
  }, [edges])
  const highlight = useMemo(() => {
    if (hoveredKey === null) return null
    return reachClosure([hoveredKey], bwd, new Set([hoveredKey]))
  }, [hoveredKey, bwd])

  const colCounts = useMemo(() => computeColCounts(nodes), [nodes])
  const vEstColY = (col: number) => vEstColYPure(col, colCounts, maxAssignedCol)
  const getNodeEstPos = (node: ChainNode) => getNodeEstPosPure(node, colCounts, maxAssignedCol)
  const getPos = (node: ChainNode) => nodePos.get(node.key) ?? getNodeEstPos(node)

  const totalW = computeTotalW(colCounts)
  const totalH = svgSize.h || estimateTotalH(colCounts, maxAssignedCol)
  const { isNarrow, scale } = computeScale(containerW, containerH, totalW, totalH)

  // Pass 1: measure node sizes → real positions.
  useLayoutEffect(() => {
    if (nodes.length === 0) { setNodePos(new Map()); setNodeSizes(new Map()); setArrows([]); return }
    const { scale: currentScale } = computeScale(containerW, containerH, totalW, totalH)
    const sizes = new Map<string, { w: number; h: number }>()
    for (const node of nodes) {
      const el = nodeRefs.current.get(node.key)
      if (!el) continue
      const r = el.getBoundingClientRect()
      sizes.set(node.key, { w: r.width / currentScale, h: r.height / currentScale })
    }
    const { positions } = computeMeasuredPositions(nodes, colCounts, maxAssignedCol, sizes)
    setNodePos(positions)
    setNodeSizes(sizes)
  }, [nodes, containerW]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pass 2: arrows from settled positions. Empty color map → tier-colored arrows.
  useLayoutEffect(() => {
    if (nodes.length === 0 || nodePos.size === 0 || nodeSizes.size === 0) return
    const { arrows: newArrows, svgSize: newSvgSize } =
      computeArrows(nodes, edges, nodePos, nodeSizes, { terminalColorByNode: new Map(), tierColor: TIER_COLOR })
    setSvgSize(newSvgSize)
    setArrows(newArrows)
  }, [nodes, edges, nodePos, nodeSizes])

  if (characters.length === 0) {
    return <div className={styles.empty}>Set up your characters first to see the production chain.</div>
  }
  if (nodes.length === 0) {
    return <div className={styles.empty}>Import planets in Setup to build the chain.</div>
  }

  const activeCols = ([0, 1, 2, 3] as const).filter(i => nodes.some(n => n.column === i))

  // Overview stats for the legend. Only ROOT supply limits below the Issue
  // threshold count — 'limited' nodes are symptoms of a root, not extra problems.
  const stats = (() => {
    let planets = 0
    for (const c of characters) planets += c.planets.length
    let supplyLimits = 0, excess = 0
    for (const f of flowByKey.values()) {
      if (f.status === 'missing' || (f.status === 'constrained' && coverageOf(f) < COVERAGE_ISSUE_THRESHOLD)) supplyLimits++
      else if (f.status === 'excess') excess++
    }
    return { planets, products: nodes.length, supplyLimits, excess, alts: characters.filter(c => c.planets.length > 0).length }
  })()

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {onBack && (
          <button className={styles.dirBtn} onClick={onBack} title="Back to the chain list">
            ← {backLabel}
          </button>
        )}
        <span className={styles.focusTitle}>Production overview · by product</span>
        {onShowPlanets && (
          <button className={styles.seeAllBtn} onClick={onShowPlanets} title="Drill into every planet individually (detailed, heavier)">
            Per-planet detail <span className={styles.seeAllIcon}>▦</span>
          </button>
        )}
      </div>

      <div className={`${styles.canvas} ${isNarrow ? styles.canvasScroll : ''}`} ref={canvasRef}>
        {isNarrow && (
          <div className={styles.mobileHint}>
            Drag to pan · the production chain is best viewed on a wider screen
          </div>
        )}
        {/* Tier band labels pinned to the canvas left. */}
        {activeCols.slice().reverse().map(i => {
          const pos = nodePos.get(nodes.find(n => n.column === i)?.key ?? '')
          const canvasY = pos?.y ?? vEstColY(i)
          const top = canvasY * scale
          return (
            <div key={i} className={styles.rowHeader} style={{ top }}>
              <span className={styles.colTier} style={{ color: TIER_COLOR[`P${i + 1}` as PITier] }}>P{i + 1}</span>
              <span className={styles.colLabel}>{COL_LABELS[i]}</span>
            </div>
          )
        })}

        <div ref={canvasInnerRef} className={styles.canvasInner}
          style={{ width: totalW, minHeight: totalH, transform: `translateX(${Math.max(0, (containerW - totalW * scale) / 2)}px) scale(${scale})`, transformOrigin: 'top left' }}>
          <svg className={styles.svg} width={svgSize.w || totalW} height={svgSize.h || totalH}>
            <defs>
              <marker id="arrowhead-prod" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
              </marker>
            </defs>
            {arrows.map((a, i) => {
              const resting = highlight === null
              const connected = resting || (highlight.has(a.fromKey) && highlight.has(a.toKey))
              const opacity = resting ? 0.34 : connected ? 1 : 0.05
              const strokeWidth = connected && highlight ? 2.5 : 1.5
              return (
                <g key={i} style={{ transition: 'opacity 0.15s' }} opacity={opacity}>
                  <path d={a.d} fill="none" stroke={a.color} strokeWidth={strokeWidth}
                    strokeOpacity={connected ? 0.85 : 0.5} strokeDasharray="6 4"
                    color={a.color} markerEnd="url(#arrowhead-prod)"
                    className={!resting && connected ? styles.arrowFlow : undefined}
                    style={{ transition: 'stroke-width 0.15s' }} />
                  {hoveredKey !== null && connected && (
                    <>
                      <rect x={a.labelX - a.label.length * 3.2 - 6} y={a.labelY - 10}
                        width={a.label.length * 6.4 + 12} height={14}
                        rx={4} fill="var(--bg-deep)" opacity={0.85} />
                      <text x={a.labelX} y={a.labelY} textAnchor="middle"
                        fill={a.color} fontSize={10} fontWeight={700}
                        style={{ userSelect: 'none', fontFamily: 'var(--font)' }}>
                        {a.label}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </svg>

          {nodes.map(node => {
            const pos = getPos(node)
            const flow = flowByKey.get(node.key)
            if (!flow) return null
            return (
              <ProductNode
                key={node.key}
                node={node}
                flow={flow}
                count={countByKey.get(node.key) ?? 0}
                x={pos.x}
                y={pos.y}
                hovered={hoveredKey === node.key}
                dimmed={highlight !== null && !highlight.has(node.key)}
                onHover={setHoveredKey}
                ref={el => { if (el) nodeRefs.current.set(node.key, el); else nodeRefs.current.delete(node.key) }}
              />
            )
          })}
        </div>

        {!isNarrow && (
          <div className={styles.legend}>
            <div className={styles.legendStats}>
              <div className={styles.legendStatBig}>{stats.alts} alts · {stats.planets} planets</div>
              <div>{stats.products} products in the chain</div>
              {stats.supplyLimits > 0 && (
                <div style={{ color: MILD }}>{stats.supplyLimits} supply limit{stats.supplyLimits !== 1 ? 's' : ''} · ⛓ points at the root</div>
              )}
              {stats.excess > 0 && (
                <div style={{ color: STATUS_COLOR.excess }}>{stats.excess} overproduced</div>
              )}
              <div className={styles.legendHint}>coverage under 100% is normal — factories idle for free</div>
              <div className={styles.legendHint}>one card per product · hover to trace a chain</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ProductNode ─────────────────────────────────────────────────────────────

interface ProductNodeProps {
  node: ChainNode
  flow: ProductFlow
  count: number
  x: number
  y: number
  hovered: boolean
  dimmed: boolean
  onHover: (key: string | null) => void
}

const ProductNode = React.forwardRef<HTMLDivElement, ProductNodeProps>(
  function ProductNode({ node, flow, count, x, y, hovered, dimmed, onHover }, ref) {
    const accent = accentFor(flow)
    const tierColor = TIER_COLOR[flow.tier]
    // Supply/demand fill: how much of demand is covered (capped visual at 100%).
    const coverage = flow.demand > 0 ? Math.min(1, flow.supply / flow.demand) : 1
    const showBar = flow.demand > 0
    const pct = Math.round(coverageOf(flow) * 100)
    const realizedPct = Math.round(flow.realizedFraction * 100)
    const title = (() => {
      if (flow.status === 'constrained')
        return `${flow.name}: your planets make ${fmtRate(flow.supply)}/h; downstream factories could burn ${fmtRate(flow.demand)}/h at full duty (${pct}% covered). That gap is normal in buffer-fed PI — factories idle for free — but it is the chain's throughput ceiling. Supply only comes in whole planets: +1 ${flow.name} planet is the only real lever.`
      if (flow.status === 'limited' && flow.limitedBy)
        return `${flow.name}: throughput capped at ~${realizedPct}% by ${flow.limitedBy} upstream — fix starts there, not here.`
      if (flow.demand > 0)
        return `${flow.name}: producing ${fmtRate(flow.supply)}/h, ${fmtRate(flow.demand)}/h needed downstream`
      return `${flow.name}: end product — ${fmtRate(flow.supply)}/h produced (nothing else you make consumes it)${flow.realizedFraction < 0.999 ? `; runs at ~${realizedPct}% of that${flow.limitedBy ? `, limited by ${flow.limitedBy}` : ''}` : ''}`
    })()

    return (
      <div ref={ref}
        className={`${styles.node} ${styles.prodNode} ${hovered ? styles.nodeHovered : ''} ${dimmed ? styles.nodeDimmed : ''} ${flow.status === 'imported' ? styles.prodNodeImported : ''}`}
        style={{ left: x, top: y, width: NODE_W,
          '--node-glow': accent,
          '--node-border': accent,
        } as React.CSSProperties}
        onMouseEnter={() => onHover(node.key)}
        onMouseLeave={() => onHover(null)}
        title={title}
      >
        <div className={styles.nodeTierStripe} style={{ background: tierColor }} />
        <div className={styles.prodHeader}>
          <span className={styles.prodTierBadge} style={{ color: tierColor }}>{flow.tier}</span>
          <span className={styles.prodName}>{flow.name}</span>
          {count > 0 && <span className={styles.prodCount}>×{count}</span>}
        </div>
        <div className={styles.prodStats}>
          {labelFor(flow) && (
            <span className={styles.prodStatus} style={{ color: accent }}>{labelFor(flow)}</span>
          )}
          {flow.status === 'terminal' && flow.realizedFraction < 0.999 && (
            <span className={styles.prodStatus} style={{ color: STATUS_COLOR.imported }}>@ {realizedPct}%</span>
          )}
          {flow.status !== 'imported' && (
            <span className={styles.prodRate}>
              {fmtRate(flow.supply)}/h{flow.demand > 0 ? ` → ${fmtRate(flow.demand)}/h` : ''}
            </span>
          )}
        </div>
        {showBar && (
          <div className={styles.prodBar}>
            <div className={styles.prodBarFill} style={{ width: `${coverage * 100}%`, background: accent }} />
          </div>
        )}
      </div>
    )
  }
)
