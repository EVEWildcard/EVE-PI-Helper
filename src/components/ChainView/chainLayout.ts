// Pure layout math for the Production Chain graph.
//
// Extracted from ChainView.tsx (behavior-preserving) so the geometry can be
// tested and iterated on independently of React. Everything here is a pure
// function of its arguments — no DOM, no React, no module state. The component
// owns the DOM measurement; it feeds the measured sizes back into the pure
// position/arrow builders below.
//
// Tier model: each tier (P1..P4) is a horizontal band; bands stack bottom-to-top
// (P1 at the bottom). A tier with more than WRAP_MAX_PER_ROW nodes wraps into
// multiple sub-rows so it doesn't sprawl sideways and force the whole graph to
// shrink. A single `scale` then fits the graph to the viewport (or fits height
// only + horizontal pan on narrow screens).

import type { PITier } from '../../data/schematics'
import type { ChainSuggestion } from '../../hooks/useChainSuggestions'

// ── geometry constants ──────────────────────────────────────────────────────

export const NODE_W = 220
export const COL_GAP = 100
export const ROW_GAP = 16
export const PAD_X = 32
export const PAD_Y = 48
export const NODE_H_EST = 90  // rough estimate for first layout pass
export const NARROW_BREAKPOINT = 640  // below this, fit-height + horizontal pan instead of shrink-to-fit
export const WRAP_MAX_PER_ROW = 9  // a tier with more nodes than this wraps into multiple sub-rows
export const WRAP_ROW_GAP = 28     // vertical gap between wrapped sub-rows within one tier band

// ── model types ─────────────────────────────────────────────────────────────

export interface ClusterMember {
  planetName: string
  planetType: string
  characterName: string
  characterId: number
  outputNames: string[]
  outputTiers: PITier[]
}

export interface ChainNode {
  key: string
  planetId: number
  planetName: string
  planetType: string
  characterId: number
  characterName: string
  outputTypeIds: number[]
  outputNames: string[]     // all products this planet makes
  outputTiers: PITier[]
  outputName: string        // primary (highest tier) output name, '' when unassigned
  outputTier: PITier        // tier of primary output
  inputNames: string[]      // union of inputs across all schematics
  unassigned: boolean
  column: number
  row: number
  // P1 cluster nodes
  isCluster?: true
  clusterMembers?: ClusterMember[]
  // product-overview nodes (LOD: one node per product, not per planet). The
  // ProductFlow display data is held separately, keyed by node.key, so this
  // module stays free of any chainModel dependency.
  isProduct?: true
  // ghost nodes
  suggested?: true
  suggestion?: ChainSuggestion   // set on both main and step ghost nodes
  isStep?: true                  // true for intermediate step nodes (extractor/factory)
}

export interface ChainEdge {
  fromKey: string
  toKey: string
  productName: string
  tier: PITier
}

export interface ArrowPath {
  d: string
  color: string
  label: string
  labelX: number
  labelY: number
  fromKey: string
  toKey: string
  ghost?: boolean
}

// ── bezier arrows ───────────────────────────────────────────────────────────

export function makeBezierH(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`
}

export function makeBezierV(x1: number, y1: number, x2: number, y2: number): string {
  const cy = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`
}

// ── tier wrap + node positioning ────────────────────────────────────────────

/** Count of nodes in each tier column. */
export function computeColCounts(nodes: ChainNode[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const n of nodes) m.set(n.column, (m.get(n.column) ?? 0) + 1)
  return m
}

/** How many sub-rows a tier band wraps into. */
export function tierSubRows(colCounts: Map<number, number>, col: number): number {
  return Math.max(1, Math.ceil((colCounts.get(col) ?? 1) / WRAP_MAX_PER_ROW))
}

/** Nodes per sub-row in a (possibly wrapped) tier band. */
export function tierPerRow(colCounts: Map<number, number>, col: number): number {
  return Math.ceil((colCounts.get(col) ?? 1) / tierSubRows(colCounts, col))
}

/** Widest single row across all tiers (after wrapping) — drives centering + total width. */
export function computeMaxRowCount(colCounts: Map<number, number>): number {
  return Math.max(1, ...Array.from(colCounts.keys()).map(c => tierPerRow(colCounts, c)))
}

/** Inner width (excludes outer PAD_X) needed to hold the widest row. */
export function computeTotalInnerW(colCounts: Map<number, number>): number {
  const maxRowCount = computeMaxRowCount(colCounts)
  return maxRowCount * NODE_W + (maxRowCount - 1) * ROW_GAP
}

/** Full canvas width including outer padding. */
export function computeTotalW(colCounts: Map<number, number>): number {
  return PAD_X * 2 + computeTotalInnerW(colCounts)
}

/** X position of a node within its tier band (rows centered against the widest row). */
export function vNodeX(node: ChainNode, colCounts: Map<number, number>): number {
  const col = node.column
  const perRow = tierPerRow(colCounts, col)
  const count = colCounts.get(col) ?? 1
  const maxRowCount = computeMaxRowCount(colCounts)
  const colInRow = node.row % perRow
  const subRow = Math.floor(node.row / perRow)
  const nodesInRow = Math.min(perRow, count - subRow * perRow)
  const offset = ((maxRowCount - nodesInRow) * (NODE_W + ROW_GAP)) / 2
  return PAD_X + offset + colInRow * (NODE_W + ROW_GAP)
}

/** Sub-row index of a node within its own (possibly wrapped) tier band. */
export function nodeSubRow(node: ChainNode, colCounts: Map<number, number>): number {
  return Math.floor(node.row / tierPerRow(colCounts, node.column))
}

/** Estimated band-top Y (before measurement). Each tier above adds its full wrapped height. */
export function vEstColY(col: number, colCounts: Map<number, number>, maxAssignedCol: number): number {
  let y = PAD_Y
  for (let c = maxAssignedCol; c > col; c--) {
    const rows = tierSubRows(colCounts, c)
    y += NODE_H_EST * rows + WRAP_ROW_GAP * (rows - 1) + COL_GAP
  }
  return y
}

/** Estimated position of a node before DOM measurement. */
export function getNodeEstPos(node: ChainNode, colCounts: Map<number, number>, maxAssignedCol: number): { x: number; y: number } {
  return {
    x: vNodeX(node, colCounts),
    y: vEstColY(node.column, colCounts, maxAssignedCol) + nodeSubRow(node, colCounts) * (NODE_H_EST + WRAP_ROW_GAP),
  }
}

/** Estimated total canvas height (fallback before arrows settle svgSize). */
export function estimateTotalH(colCounts: Map<number, number>, maxAssignedCol: number): number {
  const bottomRows = tierSubRows(colCounts, 0)
  return vEstColY(0, colCounts, maxAssignedCol) + NODE_H_EST * bottomRows + WRAP_ROW_GAP * (bottomRows - 1) + PAD_Y * 2
}

// ── scale ───────────────────────────────────────────────────────────────────

export interface ScaleResult { isNarrow: boolean; scaleW: number; scaleH: number; scale: number }

/**
 * On a wide screen the whole graph scales to fit. On a narrow/portrait screen
 * that would make it microscopic, so instead fit HEIGHT (tiers stay readable)
 * and let the user pan horizontally (Phase 1 mobile support).
 */
export function computeScale(containerW: number, containerH: number, totalW: number, totalH: number): ScaleResult {
  const isNarrow = containerW > 0 && containerW < NARROW_BREAKPOINT
  const scaleW = containerW > 0 && totalW > 0 ? containerW / totalW : 1.0
  const scaleH = containerH > 0 && totalH > 0 ? containerH / totalH : 1.0
  const scale = isNarrow ? Math.min(scaleH, 1) : Math.min(scaleW, scaleH)
  return { isNarrow, scaleW, scaleH, scale }
}

// ── measured positions (band stacking) ──────────────────────────────────────

/**
 * Pass 1: given the measured CSS sizes of every node, stack the tier bands
 * (tallest node in a band sets the band height; wrapped tiers get taller) and
 * place each node. The DOM read happens in the component; this is the pure math.
 */
export function computeMeasuredPositions(
  nodes: ChainNode[],
  colCounts: Map<number, number>,
  maxAssignedCol: number,
  sizes: Map<string, { w: number; h: number }>,
): { positions: Map<string, { x: number; y: number }>; bandY: Map<number, number>; bandH: Map<number, number> } {
  const bandH = new Map<number, number>()
  for (const node of nodes) {
    const s = sizes.get(node.key)
    if (!s) continue
    bandH.set(node.column, Math.max(bandH.get(node.column) ?? 0, s.h))
  }
  const cols = Array.from(new Set(nodes.map(n => n.column))).sort((a, b) => a - b)
  const bandY = new Map<number, number>()
  let y = PAD_Y
  for (const col of [...cols].reverse()) {
    bandY.set(col, y)
    // A wrapped tier is taller — it stacks into multiple sub-rows.
    const rowH = bandH.get(col) ?? NODE_H_EST
    const rows = Math.max(1, Math.ceil((colCounts.get(col) ?? 1) / WRAP_MAX_PER_ROW))
    y += rowH * rows + WRAP_ROW_GAP * (rows - 1) + COL_GAP
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const top = bandY.get(node.column) ?? vEstColY(node.column, colCounts, maxAssignedCol)
    const rowH = bandH.get(node.column) ?? NODE_H_EST
    positions.set(node.key, { x: vNodeX(node, colCounts), y: top + nodeSubRow(node, colCounts) * (rowH + WRAP_ROW_GAP) })
  }
  return { positions, bandY, bandH }
}

// ── arrows ──────────────────────────────────────────────────────────────────

export interface ArrowColorOptions {
  /** nodeKey → color used for an arrow leaving that node (character color). */
  terminalColorByNode: Map<string, string>
  /** fallback color by tier when a node has no character color. */
  tierColor: Record<PITier, string>
}

/**
 * Pass 2: build the arrow paths from settled positions + sizes. One arrow per
 * (from → to) node pair, so a cluster (or any node) with several edges to the
 * same neighbor draws a single labelled arrow. Overlapping labels are pushed down.
 */
export function computeArrows(
  nodes: ChainNode[],
  edges: ChainEdge[],
  nodePos: Map<string, { x: number; y: number }>,
  nodeSizes: Map<string, { w: number; h: number }>,
  { terminalColorByNode, tierColor }: ArrowColorOptions,
): { arrows: ArrowPath[]; svgSize: { w: number; h: number } } {
  // Key → node, so the per-edge "is the target a ghost?" check is a lookup, not a
  // scan over every node (O(edges) instead of O(edges × nodes)).
  const nodeByKey = new Map(nodes.map(n => [n.key, n]))
  // Use CSS-space positions and sizes — avoids all scale-transform coordinate confusion
  const positions = new Map<string, { left: number; right: number; top: number; bottom: number; cx: number; cy: number }>()
  for (const node of nodes) {
    const pos = nodePos.get(node.key)
    const size = nodeSizes.get(node.key)
    if (!pos || !size) continue
    positions.set(node.key, {
      left: pos.x,
      right: pos.x + size.w,
      top: pos.y,
      bottom: pos.y + size.h,
      cx: pos.x + size.w / 2,
      cy: pos.y + size.h / 2,
    })
  }

  const newArrows: ArrowPath[] = []
  let maxX = 0, maxY = 0

  // One arrow per (from → to) node pair, joining every product carried on that
  // pair into a single label. This handles clusters as source, destination, or
  // both, and plain node→node edges, all the same way.
  const pairs = new Map<string, ChainEdge[]>()
  for (const e of edges) {
    const gk = `${e.fromKey}→${e.toKey}`
    const arr = pairs.get(gk) ?? []; arr.push(e); pairs.set(gk, arr)
  }

  for (const pairEdges of pairs.values()) {
    const e = pairEdges[0]
    const src = positions.get(e.fromKey)
    const dst = positions.get(e.toKey)
    if (!src || !dst) continue
    const x1 = src.cx, y1 = src.top, x2 = dst.cx, y2 = dst.bottom
    const label = [...new Set(pairEdges.map(g => g.productName))].join(', ')
    const isGhost = nodeByKey.get(e.toKey)?.suggested === true
    const color = isGhost ? '#4ab095' : (terminalColorByNode.get(e.fromKey) ?? tierColor[e.tier])
    newArrows.push({ d: makeBezierV(x1, y1, x2, y2), color, label, labelX: (x1+x2)/2, labelY: (y1+y2)/2 - 6, fromKey: e.fromKey, toKey: e.toKey, ghost: isGhost })
    maxX = Math.max(maxX, src.right + PAD_X, dst.right + PAD_X)
    maxY = Math.max(maxY, src.bottom + PAD_Y, dst.bottom + PAD_Y)
  }

  for (const pos of positions.values()) {
    maxX = Math.max(maxX, pos.right + PAD_X)
    maxY = Math.max(maxY, pos.bottom + PAD_Y)
  }

  // Label collision resolution: sort by Y then greedily push overlapping labels downward
  const LABEL_H = 14
  const LABEL_GAP = 3
  const byY = newArrows.slice().sort((a, b) => a.labelY - b.labelY || a.labelX - b.labelX)
  for (let i = 1; i < byY.length; i++) {
    const cur = byY[i]
    const cw = cur.label.length * 6.4 + 12
    for (let j = 0; j < i; j++) {
      const prev = byY[j]
      const pw = prev.label.length * 6.4 + 12
      const xOverlap = Math.abs(cur.labelX - prev.labelX) < (cw + pw) / 2 + LABEL_GAP
      const yOverlap = Math.abs(cur.labelY - prev.labelY) < LABEL_H + LABEL_GAP
      if (xOverlap && yOverlap) cur.labelY = prev.labelY + LABEL_H + LABEL_GAP
    }
  }

  return { arrows: newArrows, svgSize: { w: maxX, h: maxY } }
}
