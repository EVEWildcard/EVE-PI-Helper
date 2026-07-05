import React, { useLayoutEffect, useRef, useState, useMemo, useEffect } from 'react'
import type { StoredCharacter } from '../../types/api'
import type { PITier } from '../../data/schematics'
import { TIER_COLOR } from '../../data/tierColors'
import { buildChainModel, COVERAGE_ISSUE_THRESHOLD, type ProductFlow, type ProductStatus } from './chainModel'
import { buildProductGraph } from './productModel'
import {
  NODE_W, NODE_H_EST, WRAP_ROW_GAP,
  computeColCounts, computeTotalW, estimateTotalH, computeScale,
  computeMeasuredPositions, computeArrows, tierSubRows,
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

// Amber band above the Issue threshold: throttled enough to notice at a glance,
// but still normal buffer-fed PI — it never reaches the Issues list.
const MILD_BELOW = 0.8

// A root supply limit is graded by how much of demand it covers; everything
// else keeps its flat status color.
function accentFor(flow: ProductFlow): string {
  if (flow.status === 'constrained') {
    const c = coverageOf(flow)
    return c <= COVERAGE_ISSUE_THRESHOLD ? SEVERE : c < MILD_BELOW ? MILD : STATUS_COLOR.ok
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
  // Tier-band geometry (top + height per column) for the full-bleed color washes.
  const [bandY, setBandY] = useState<Map<number, number>>(new Map())
  const [bandH, setBandH] = useState<Map<number, number>>(new Map())
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // View transform: pan (tx,ty screen px) + zoom. `null` = auto-fit (the original
  // behavior). Once the user wheels or drags we hold their view until "Fit". Refs
  // mirror the applied view so the native wheel/pointer handlers (bound once) read
  // fresh values. Disabled on narrow screens, which keep the scroll path. Ported
  // from the per-planet graph so both boards pan/zoom identically.
  type View = { tx: number; ty: number; zoom: number }
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View>({ tx: 0, ty: 0, zoom: 1 })
  const narrowRef = useRef(false)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const clampZoom = (z: number) => Math.max(0.04, Math.min(2, z))
    const onWheel = (e: WheelEvent) => {
      if (narrowRef.current) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const cur = viewRef.current
      const nz = clampZoom(cur.zoom * Math.exp(-e.deltaY * 0.0015))
      const cx = (mx - cur.tx) / cur.zoom, cy = (my - cur.ty) / cur.zoom
      setView({ zoom: nz, tx: mx - cx * nz, ty: my - cy * nz })
    }
    let dragging = false, sx = 0, sy = 0, sv = viewRef.current
    const onDown = (e: PointerEvent) => {
      if (narrowRef.current || e.button !== 0) return
      if ((e.target as HTMLElement)?.closest('button, input, a, [role="button"]')) return
      dragging = true; sx = e.clientX; sy = e.clientY; sv = viewRef.current
      el.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      setView({ zoom: sv.zoom, tx: sv.tx + (e.clientX - sx), ty: sv.ty + (e.clientY - sy) })
    }
    const onUp = (e: PointerEvent) => { dragging = false; el.releasePointerCapture?.(e.pointerId) }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const model = useMemo(() => buildChainModel(characters, prices), [characters, prices])
  const { nodes, edges, flowByKey } = useMemo(() => buildProductGraph(model), [model])

  // Planet count per product (the "×N" badge) from the flow's producer list.
  const countByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const [key, f] of flowByKey) m.set(key, f.producerKeys.length)
    return m
  }, [flowByKey])

  const maxAssignedCol = nodes.reduce((m, n) => Math.max(m, n.column), -1)

  // Hover lights the SUPPLY that feeds the hovered product — its ingredients back
  // to raw materials (its ancestors + self) — dimming the rest. "What goes into
  // this?" So hovering Superconductors lights the P1s it's made from, not the P3/P4
  // it ends up in. Matches the per-planet graph, which also lights upstream supply.
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

  // Applied view: the user's pan/zoom when set (wide screens only), else auto-fit
  // (centered), which is the original behavior. This board is bounded (~66 nodes),
  // so it always opens fully fit — no big-graph slice like the per-planet graph.
  const fitView = { tx: Math.max(0, (containerW - totalW * scale) / 2), ty: 0, zoom: scale }
  const v = (!isNarrow && view) ? view : fitView
  viewRef.current = v
  narrowRef.current = isNarrow

  // Pass 1: measure node sizes → real positions + tier-band geometry. DOM sizes
  // come back scaled by the applied zoom, so divide it back out.
  useLayoutEffect(() => {
    if (nodes.length === 0) { setNodePos(new Map()); setNodeSizes(new Map()); setBandY(new Map()); setBandH(new Map()); setArrows([]); return }
    const zoom = viewRef.current.zoom || 1
    const sizes = new Map<string, { w: number; h: number }>()
    for (const node of nodes) {
      const el = nodeRefs.current.get(node.key)
      if (!el) continue
      const r = el.getBoundingClientRect()
      sizes.set(node.key, { w: r.width / zoom, h: r.height / zoom })
    }
    const { positions, bandY, bandH } = computeMeasuredPositions(nodes, colCounts, maxAssignedCol, sizes)
    setNodePos(positions)
    setNodeSizes(sizes)
    setBandY(bandY)
    setBandH(bandH)
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
      if (f.status === 'missing' || (f.status === 'constrained' && coverageOf(f) <= COVERAGE_ISSUE_THRESHOLD)) supplyLimits++
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
        {!isNarrow && view && (
          <button className={styles.dirBtn} onClick={() => setView(null)} title="Reset zoom & pan to fit the whole graph">
            Fit · {Math.round(v.zoom * 100)}%
          </button>
        )}
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
        {/* Faint full-bleed tier bands — a color wash across the whole canvas per
            P-row, so at any pan/zoom you know which tier band you're inside.
            Screen-space (left:0 right:0 on the canvas), Y converted from canvas
            coords. Matches the per-planet graph. */}
        {!isNarrow && activeCols.map(i => {
          const BAND_PAD = 16
          const rows = tierSubRows(colCounts, i)
          const rowH = bandH.get(i) ?? NODE_H_EST
          const canvasY = (bandY.get(i) ?? vEstColY(i)) - BAND_PAD
          const canvasH = rowH * rows + WRAP_ROW_GAP * (rows - 1) + BAND_PAD * 2
          const c = TIER_COLOR[`P${i + 1}` as PITier]
          return (
            <div key={`band-${i}`} className={styles.tierBand}
              style={{ top: canvasY * v.zoom + v.ty, height: canvasH * v.zoom, background: `color-mix(in srgb, ${c} 5%, transparent)` }} />
          )
        })}
        {/* Tier band labels pinned to the canvas left, Y converted to visual coords. */}
        {activeCols.slice().reverse().map(i => {
          const canvasY = bandY.get(i) ?? vEstColY(i)
          const top = canvasY * v.zoom + v.ty
          return (
            <div key={i} className={styles.rowHeader} style={{ top }}>
              <span className={styles.colTier} style={{ color: TIER_COLOR[`P${i + 1}` as PITier] }}>P{i + 1}</span>
              <span className={styles.colLabel}>{COL_LABELS[i]}</span>
            </div>
          )
        })}

        <div ref={canvasInnerRef} className={styles.canvasInner}
          style={{ width: totalW, minHeight: totalH, transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`, transformOrigin: 'top left' }}>
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
