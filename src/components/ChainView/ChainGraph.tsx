import React, { useLayoutEffect, useRef, useState, useMemo, useEffect } from 'react'
import type { StoredCharacter } from '../../types/api'
import { PRODUCT_BY_TYPE_ID, PRODUCT_BY_NAME, SCHEMATIC_INPUTS_BY_NAME } from '../../data/schematics'
import type { PITier } from '../../data/schematics'
import { PLANET_COLOR } from '../../data/planetColors'
import { TIER_COLOR } from '../../data/tierColors'
import { useChainSuggestions, useBalanceHints, type ChainSuggestion, type BalanceHint } from '../../hooks/useChainSuggestions'
import { useSystemPlanets } from '../../hooks/useSystemPlanets'
import { buildChainModel } from './chainModel'
import { SuggestionPlan } from '../SuggestionPlan/SuggestionPlan'
import { TemplateSearch } from '../TemplateSearch/TemplateSearch'
import {
  NODE_W, NODE_H_EST,
  computeColCounts, computeTotalW, estimateTotalH, computeScale,
  computeMeasuredPositions, computeArrows,
  vEstColY as vEstColYPure, getNodeEstPos as getNodeEstPosPure,
  type ClusterMember, type ChainNode, type ChainEdge, type ArrowPath,
} from './chainLayout'
import { SeeEverythingButton } from './SeeEverythingButton'
import styles from './ChainView.module.css'

// ── constants ─────────────────────────────────────────────────────────────────
// Geometry constants + the layout math live in ./chainLayout. TIER_COLOR is
// shared via ../../data/tierColors and passed into the arrow builder as a param
// so the layout module carries no color policy.

const TIER_COL: Partial<Record<string, number>> = { P1: 0, P2: 1, P3: 2, P4: 3 }
const COL_LABELS = ['P1 — Extraction', 'P2 — Refining', 'P3 — Specialized', 'P4 — Advanced']

// ── graph builder ─────────────────────────────────────────────────────────────

function buildGraph(characters: StoredCharacter[]): {
  nodes: ChainNode[]
  edges: ChainEdge[]
  producedNames: Set<string>
} {
  const nodes: ChainNode[] = []

  const TIER_ORDER: PITier[] = ['P4', 'P3', 'P2', 'P1', 'P0']

  for (const char of characters) {
    for (const planet of char.planets) {
      const outputs = planet.outputs ?? []
      const resolvedOutputs = outputs.map(tid => PRODUCT_BY_TYPE_ID.get(tid)).filter(Boolean) as { name: string; tier: PITier }[]

      const outputNames = resolvedOutputs.map(o => o.name)
      const outputTiers = resolvedOutputs.map(o => o.tier)

      // Primary output = highest tier
      const primaryIdx = outputTiers.reduce((best, tier, i) => {
        const bestRank = TIER_ORDER.indexOf(outputTiers[best])
        const rank = TIER_ORDER.indexOf(tier)
        return rank < bestRank ? i : best
      }, 0)

      const outputName = outputNames[primaryIdx] ?? ''
      const outputTier = (outputTiers[primaryIdx] ?? 'P1') as PITier
      const unassigned = outputNames.length === 0

      // Union of inputs across all schematics
      const inputNames = Array.from(new Set(
        outputNames.flatMap(name => SCHEMATIC_INPUTS_BY_NAME.get(name) ?? [])
      ))

      nodes.push({
        key: `${char.characterId}:${planet.planetId}`,
        planetId: planet.planetId,
        planetName: planet.name,
        planetType: planet.type,
        characterId: char.characterId,
        characterName: char.characterName,
        outputTypeIds: outputs,
        outputNames,
        outputTiers,
        outputName,
        outputTier,
        inputNames,
        unassigned,
        column: unassigned ? -1 : (TIER_COL[outputTier] ?? 0),
        row: 0
      })
    }
  }

  // Group nodes by column
  const byColumn = new Map<number, ChainNode[]>()
  for (const node of nodes) {
    if (!byColumn.has(node.column)) byColumn.set(node.column, [])
    byColumn.get(node.column)!.push(node)
  }

  // Build edges early (row-independent) so we can use them for clustering
  const byOutputName = new Map<string, ChainNode[]>()
  for (const n of nodes) {
    for (const name of n.outputNames) {
      const arr = byOutputName.get(name) ?? []; arr.push(n); byOutputName.set(name, arr)
    }
  }
  const earlyEdges: ChainEdge[] = []
  for (const dst of nodes) {
    for (const inputName of dst.inputNames) {
      for (const src of byOutputName.get(inputName) ?? []) {
        if (src.key !== dst.key)
          earlyEdges.push({ fromKey: src.key, toKey: dst.key, productName: inputName, tier: src.outputTier })
      }
    }
  }

  // consumerKey → set of supplier keys feeding it — so clustering is a Set lookup
  // per (supplier, consumer) instead of a scan over every edge.
  const suppliersByConsumer = new Map<string, Set<string>>()
  for (const e of earlyEdges) {
    let set = suppliersByConsumer.get(e.toKey)
    if (!set) { set = new Set(); suppliersByConsumer.set(e.toKey, set) }
    set.add(e.fromKey)
  }

  // Top-down clustering: assign rows starting from the highest tier.
  // For each tier, group supplier nodes under their consumers (already row-ordered).
  function clusterUnderConsumers(supplierNodes: ChainNode[], consumerNodes: ChainNode[]) {
    const consumersSorted = consumerNodes.slice().sort((a, b) => a.row - b.row)
    const placed = new Set<string>()
    const ordered: ChainNode[] = []
    for (const consumer of consumersSorted) {
      const feeders = suppliersByConsumer.get(consumer.key)
      if (!feeders) continue
      supplierNodes
        .filter(s => !placed.has(s.key) && feeders.has(s.key))
        .sort((a, b) => a.characterName.localeCompare(b.characterName))
        .forEach(n => { ordered.push(n); placed.add(n.key) })
    }
    for (const n of supplierNodes) { if (!placed.has(n.key)) ordered.push(n) }
    ordered.forEach((n, i) => { n.row = i })
  }

  // Start from highest tier and work down
  const maxCol = Math.max(...[...byColumn.keys()].filter(c => c >= 0))
  // Top tier: sort alphabetically within each character (no consumers above)
  const topNodes = byColumn.get(maxCol) ?? []
  topNodes.sort((a, b) => a.characterName.localeCompare(b.characterName) || a.outputName.localeCompare(b.outputName))
  topNodes.forEach((n, i) => { n.row = i })

  // Each tier below: cluster under consumers
  for (let col = maxCol - 1; col >= 0; col--) {
    const supplierNodes = byColumn.get(col) ?? []
    const consumerNodes = byColumn.get(col + 1) ?? []
    if (supplierNodes.length === 0) continue
    clusterUnderConsumers(supplierNodes, consumerNodes)
  }

  // Unassigned
  const unassigned = byColumn.get(-1) ?? []
  unassigned.sort((a, b) => a.characterName.localeCompare(b.characterName))
  unassigned.forEach((n, i) => { n.row = i })

  // All output names that any planet produces
  const producedNames = new Set(nodes.flatMap(n => n.outputNames))

  return { nodes, edges: earlyEdges, producedNames }
}

// ── duplicate clustering ────────────────────────────────────────────────────────
// Collapse duplicate producers — same tier + same output signature — into one ×N
// card, chain-wide, regardless of which consumers each feeds. A product made by a
// single planet passes through unchanged, so unique/small chains stay fully
// expanded and read exactly as before. Members are sub-grouped by character inside
// each cluster. Applies to every tier (P1..P4), not just extractors.

const MERGE_MIN = 2  // a product made by this many planets or more collapses into one card

function clusterDuplicates(nodes: ChainNode[], edges: ChainEdge[]): { nodes: ChainNode[], edges: ChainEdge[] } {
  // Signature = tier column + sorted output names, so a "Mechanical Parts" planet
  // never merges with a "Mechanical Parts + Consumer Electronics" one.
  const sigOf = (n: ChainNode) => `${n.column}|${[...n.outputNames].sort().join('~')}`

  const groups = new Map<string, ChainNode[]>()
  const passthrough: ChainNode[] = []  // unassigned + unique-product singletons
  for (const n of nodes) {
    if (n.unassigned || n.outputNames.length === 0) { passthrough.push(n); continue }
    const arr = groups.get(sigOf(n)) ?? []; arr.push(n); groups.set(sigOf(n), arr)
  }

  const clusterNodes: ChainNode[] = []
  const keyRemap = new Map<string, string>()  // old node key → cluster key

  for (const [sig, members] of groups) {
    if (members.length < MERGE_MIN) { passthrough.push(...members); continue }
    const clusterKey = `cluster:${sig}`
    for (const m of members) keyRemap.set(m.key, clusterKey)

    // Sub-group members by character, preserving row order within each character
    const charOrder: number[] = []
    const byChar = new Map<number, ChainNode[]>()
    for (const m of members.slice().sort((a, b) => a.row - b.row)) {
      if (!byChar.has(m.characterId)) { byChar.set(m.characterId, []); charOrder.push(m.characterId) }
      byChar.get(m.characterId)!.push(m)
    }
    const sortedMembers: ClusterMember[] = []
    for (const charId of charOrder) {
      for (const m of byChar.get(charId)!) {
        sortedMembers.push({
          planetName:    m.planetName,
          characterName: m.characterName,
          characterId:   m.characterId,
          outputNames:   m.outputNames,
          outputTiers:   m.outputTiers,
        })
      }
    }

    // Members share the same output signature, so the rep carries the shared
    // outputs + inputs (keeps input chips, balance-warning + suggestion matching).
    const rep = members[0]
    clusterNodes.push({
      key: clusterKey,
      planetId: -1,
      planetName: '',
      planetType: '',
      characterId: rep.characterId,
      characterName: '',
      outputTypeIds: rep.outputTypeIds,
      outputNames:   rep.outputNames,
      outputTiers:   rep.outputTiers,
      outputName:    rep.outputName,
      outputTier:    rep.outputTier,
      inputNames:    rep.inputNames,
      unassigned:    false,
      column:        rep.column,
      row:           Math.min(...members.map(m => m.row)),
      isCluster:     true,
      clusterMembers: sortedMembers,
    })
  }

  const outNodes = [...passthrough, ...clusterNodes]

  // Re-sequence rows per column, preserving the top-down consumer ordering that
  // buildGraph produced (clusters land near their earliest member's old row).
  const byCol = new Map<number, ChainNode[]>()
  for (const n of outNodes) {
    const arr = byCol.get(n.column) ?? []; arr.push(n); byCol.set(n.column, arr)
  }
  for (const arr of byCol.values()) {
    arr.sort((a, b) => a.row - b.row).forEach((n, i) => { n.row = i })
  }

  // Remap BOTH endpoints (a cluster can be a source or a destination now), drop
  // self-edges, and deduplicate.
  const seen = new Set<string>()
  const newEdges = edges
    .map(e => ({ ...e, fromKey: keyRemap.get(e.fromKey) ?? e.fromKey, toKey: keyRemap.get(e.toKey) ?? e.toKey }))
    .filter(e => {
      if (e.fromKey === e.toKey) return false
      const k = `${e.fromKey}→${e.toKey}:${e.productName}`
      if (seen.has(k)) return false
      seen.add(k); return true
    })

  return { nodes: outNodes, edges: newEdges }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getP0Roots(name: string, visited = new Set<string>()): string[] {
  if (visited.has(name)) return []
  visited.add(name)
  const product = PRODUCT_BY_NAME.get(name)
  if (!product || product.tier === 'P0') return [name]
  const inputs = SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []
  return Array.from(new Set(inputs.flatMap(i => getP0Roots(i, new Set(visited)))))
}

/** Flood a directed adjacency map from `start`, accumulating into `seed`. Shared
 *  by the hover-focus and legend-pin highlight computations. */
function reachClosure(start: string[], adj: Map<string, Set<string>>, seed: Set<string>): Set<string> {
  const seen = seed
  const stack = [...start]
  while (stack.length) {
    const k = stack.pop()!
    for (const n of adj.get(k) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  }
  return seen
}

/** All product names in a chain: the product plus every recursive input. */
function collectChainNames(name: string, acc = new Set<string>()): Set<string> {
  if (acc.has(name)) return acc
  acc.add(name)
  for (const inp of SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []) collectChainNames(inp, acc)
  return acc
}

function getMissingInputHint(name: string): string {
  const product = PRODUCT_BY_NAME.get(name)
  const tier = product?.tier ?? 'P1'
  const directInputs = SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []

  if (tier === 'P1') {
    const p0 = directInputs[0]
    return p0
      ? `Harvest ${p0} on an extraction planet → processes into ${name}`
      : `Add an extraction planet for ${name}`
  }

  const p0s = Array.from(new Set(directInputs.flatMap(i => getP0Roots(i))))
  const inputList = directInputs.join(' + ')
  const p0List = p0s.join(', ')
  return `Needs: ${inputList}\nP0 sources required: ${p0List}`
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onRefresh?: () => Promise<void>
  /** When set, a "back" button appears in the toolbar (chain-focus / see-everything). */
  onBack?: () => void
  backLabel?: string
  /** Optional heading shown next to the back button (e.g. the focused chain name). */
  focusTitle?: React.ReactNode
  /** Focus view turns suggestions off to keep the single chain clean. */
  suggestionsAllowed?: boolean
  /** Single-chain (focus) view: always alt-colored, and hover highlights the
   *  path THROUGH a node (ancestors ∪ descendants) rather than the whole chain. */
  singleChain?: boolean
  /** When provided, a "See everything" button is shown (jump to the full graph). */
  onSeeEverything?: () => void
}

function formatIsk(isk: number): string {
  if (isk >= 1_000_000_000) return `${(isk / 1_000_000_000).toFixed(2)}B`
  if (isk >= 1_000_000) return `${(isk / 1_000_000).toFixed(1)}M`
  if (isk >= 1_000) return `${(isk / 1_000).toFixed(0)}K`
  return isk.toFixed(0)
}

export function ChainGraph({ characters, prices, onRefresh, onBack, backLabel = 'Back', focusTitle, suggestionsAllowed = true, singleChain = false, onSeeEverything }: Props) {
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // keyed by `${nodeKey}:${inputName}` → center-x of the chip in CSS canvas space
  const inputChipRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const canvasInnerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  // Issue-row elements keyed by product name → so hovering a node can scroll its
  // explaining Issue into view.
  const hintRefs = useRef<Map<string, HTMLDivElement>>(new Map())
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
    // window resize catches monitor moves / DPI changes that ResizeObserver can miss
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  // View transform: pan (tx,ty in screen px) + zoom. `null` = auto-fit (the
  // original behavior — small graphs look identical). Once the user wheels or
  // drags we hold their view until they hit "Fit". Refs mirror the applied view
  // + fit so the native wheel/pointer handlers (attached once) read fresh values
  // without re-binding. Disabled on narrow screens, which keep the scroll path.
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
      // keep the canvas point under the cursor fixed while zooming
      const cx = (mx - cur.tx) / cur.zoom, cy = (my - cur.ty) / cur.zoom
      setView({ zoom: nz, tx: mx - cx * nz, ty: my - cy * nz })
    }
    let dragging = false, sx = 0, sy = 0, sv = viewRef.current
    const onDown = (e: PointerEvent) => {
      if (narrowRef.current || e.button !== 0) return
      // don't hijack clicks on the legend / panels / their controls
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

  // Node sizes are measured once per CARD SHAPE, not per instance: a big empire
  // has hundreds of planets but only a few dozen distinct card layouts (same
  // outputs ⇒ same height). Measuring one of each makes every node's size known
  // without mounting them all, which is what lets us cull off-screen cards.
  const [sizeByShape, setSizeByShape] = useState<Map<string, { w: number; h: number }>>(new Map())
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // Set while hovering a balance-warning chip → locates the responsible nodes.
  const [warnProduct, setWarnProduct] = useState<string | null>(null)
  // Overproduction is the lesser evil; collapse it by default when there's a lot.
  const [showExcess, setShowExcess] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true) }
    const up   = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  const [assumeMaxSkills, setAssumeMaxSkills] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<ChainSuggestion | null>(null)
  // Suggestions are always on now (no toggle) and live in the right-side column.
  // Hovering a row locates its chain in the graph; the ISK-impact threshold
  // (% of current income) filters out the small ones. Both persisted.
  const [hoverSuggestKey, setHoverSuggestKey] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(() => {
    const v = parseFloat(localStorage.getItem('chainView.suggestThreshold') ?? '')
    return Number.isFinite(v) ? v : 15
  })
  function updateThreshold(v: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(v)))
    localStorage.setItem('chainView.suggestThreshold', String(clamped))
    setThreshold(clamped)
  }

  const { systemPlanets, loading: systemPlanetsLoading } = useSystemPlanets(characters)
  const suggestions = useChainSuggestions(characters, prices, assumeMaxSkills, systemPlanets, 30)
  const balanceHints = useBalanceHints(characters)
  // Split by severity: bottlenecks (shortfalls) lose money → always up top;
  // overproduction is the lesser evil → grouped below, collapsible when noisy.
  const bottlenecks = balanceHints.filter(h => h.type === 'bottleneck')
  const excess = balanceHints.filter(h => h.type === 'excess')
  // Current income = Σ terminal iskHrNow — the basis for the ISK-impact filter.
  const chainModel = useMemo(() => buildChainModel(characters, prices), [characters, prices])
  const currentIncome = useMemo(
    () => chainModel.terminals.reduce((sum, t) => sum + t.iskHrNow, 0),
    [chainModel]
  )

  const { nodes: rawNodes, edges: rawEdges, producedNames } = useMemo(() => buildGraph(characters), [characters])
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => clusterDuplicates(rawNodes, rawEdges), [rawNodes, rawEdges])

  // In-graph ghost suggestion nodes are superseded by the suggestions column
  // (right side), so the graph renders just the real planets.
  const nodes = baseNodes
  const edges = baseEdges

  // Key → node, built once per node set and reused by the lookups below (terminal
  // coloring, per-arrow alt tint) so none of them scan the node array.
  const nodeByKey = useMemo(() => new Map(nodes.map(n => [n.key, n])), [nodes])

  // Character color palette — distinct from TIER_COLOR values (P1=#4a90c8, P2=#8060c0, P3=#c06040, P4=#c09020)
  const CHAR_PALETTE = [
    '#3cc8a0', '#e05880', '#a0c840', '#d070e0', '#40c0e0', '#e09040', '#60d090', '#e06098'
  ]
  // Built from the pre-cluster nodes (one per planet) so every alt gets a color —
  // a cluster only carries its first member's characterId, so deriving from the
  // post-cluster `nodes` could drop an alt whose planets all merged away.
  const charColorByCharId = useMemo(() => {
    const seen: number[] = []
    for (const n of rawNodes) {
      if (n.characterId > 0 && !seen.includes(n.characterId)) seen.push(n.characterId)
    }
    const m = new Map<number, string>()
    seen.forEach((id, i) => m.set(id, CHAR_PALETTE[i % CHAR_PALETTE.length]))
    return m
  }, [rawNodes])

  // Past ~4 alts the per-alt rainbow is just noise: color the whole graph by
  // product TIER and swap the legend for a stats line. Hovering a chain still
  // reveals its alts' colors. The single-chain focus view always stays alt-colored.
  const manyAlts = !singleChain && charColorByCharId.size > 4

  // Productive nodes + terminal label per node (color now comes from charColorByCharId)
  const { productiveNodes, terminalColorByNode, nodeTerminal, terminalNameByKey } = useMemo(() => {
    const tierRank: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }
    const maxRank = nodes.filter(n => !n.unassigned)
      .reduce((m, n) => Math.max(m, tierRank[n.outputTier] ?? 0), 0)
    const maxTier = Object.entries(tierRank).find(([, v]) => v === maxRank)?.[0]

    const terminalNodes = nodes.filter(n => n.outputTier === maxTier)

    const terminalNameByKey = new Map<string, string>()
    terminalNodes.forEach(n => {
      terminalNameByKey.set(n.key, n.outputName || n.outputNames[0] || '')
    })

    const nodeTerminal = new Map<string, string>() // nodeKey → terminalKey
    for (const t of terminalNodes) nodeTerminal.set(t.key, t.key)

    let changed = true
    while (changed) {
      changed = false
      for (const e of edges) {
        if (nodeTerminal.has(e.toKey) && !nodeTerminal.has(e.fromKey)) {
          nodeTerminal.set(e.fromKey, nodeTerminal.get(e.toKey)!)
          changed = true
        }
      }
    }

    const productive = new Set(nodeTerminal.keys())
    // terminalColorByNode kept for arrow coloring — maps nodeKey → character color of that node
    const terminalColorByNode = new Map<string, string>()
    for (const nodeKey of productive) {
      const node = nodeByKey.get(nodeKey)
      if (node) terminalColorByNode.set(nodeKey, charColorByCharId.get(node.characterId) ?? TIER_COLOR[node.outputTier])
    }

    return { productiveNodes: productive, terminalColorByNode, nodeTerminal, terminalNameByKey }
  }, [nodes, edges, charColorByCharId, nodeByKey])

  // Primary consumed outputs: only edges where both nodes feed the same terminal
  const primaryConsumedByNode = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of edges) {
      if (nodeTerminal.get(e.fromKey) === nodeTerminal.get(e.toKey)) {
        if (!m.has(e.fromKey)) m.set(e.fromKey, new Set())
        m.get(e.fromKey)!.add(e.productName)
      }
    }
    return m
  }, [edges, nodeTerminal])

  const maxAssignedCol = nodes.filter(n => !n.unassigned).reduce((m, n) => Math.max(m, n.column), -1)

  // Hover-focus: light the UPSTREAM supply feeding the hovered node — its
  // ancestors back to extraction — and dim the rest. Downstream consumers are
  // deliberately left out (hover them to see their own supply). The single-chain
  // view instead lights the path THROUGH the node since there's only one chain.
  const { fwd, bwd } = useMemo(() => {
    const fwd = new Map<string, Set<string>>()
    const bwd = new Map<string, Set<string>>()
    const add = (m: Map<string, Set<string>>, a: string, b: string) => { if (!m.has(a)) m.set(a, new Set()); m.get(a)!.add(b) }
    for (const e of edges) { add(fwd, e.fromKey, e.toKey); add(bwd, e.toKey, e.fromKey) }
    return { fwd, bwd }
  }, [edges])
  const connectedSet = useMemo(() => {
    if (hoveredKey === null) return null
    if (singleChain) {
      // Path THROUGH the node: its ancestors plus its descendants (no siblings),
      // so hovering a mid node in a one-chain view actually narrows the focus.
      const up = reachClosure([hoveredKey], bwd, new Set([hoveredKey]))
      return reachClosure([hoveredKey], fwd, up)
    }
    // Hover lights only what flows UP INTO this node (its ancestors + self),
    // never what it feeds. To inspect a downstream consumer, hover that node.
    return reachClosure([hoveredKey], bwd, new Set([hoveredKey]))
  }, [hoveredKey, fwd, bwd, singleChain])

  // Legend click-to-pin: clicking an alt in the legend persistently focuses just
  // that alt's sub-chain (its planets plus everything up/downstream they connect
  // to). Hovering a node still overrides it transiently; click the alt again to
  // clear. Cleared automatically if its alt leaves the graph.
  const [pinnedAltId, setPinnedAltId] = useState<number | null>(null)
  const pinnedSet = useMemo(() => {
    if (pinnedAltId == null) return null
    const seeds = nodes.filter(n =>
      n.characterId === pinnedAltId ||
      (n.isCluster ? !!n.clusterMembers?.some(m => m.characterId === pinnedAltId) : false)
    ).map(n => n.key)
    if (seeds.length === 0) return null
    const down = reachClosure(seeds, fwd, new Set(seeds))
    return reachClosure([...down], bwd, new Set(down))
  }, [pinnedAltId, nodes, fwd, bwd])
  useEffect(() => {
    if (pinnedAltId != null && !characters.some(c => c.characterId === pinnedAltId)) setPinnedAltId(null)
  }, [characters, pinnedAltId])

  // Hovering a node spotlights the Issue rows that EXPLAIN its odd-looking arrows —
  // the products it makes or consumes that are out of balance. Connects the visual
  // (a broken or fat arrow) to the "why", in words, on the right-hand panel.
  const hoveredIssueProducts = useMemo(() => {
    if (!hoveredKey) return new Set<string>()
    const n = nodeByKey.get(hoveredKey)
    if (!n) return new Set<string>()
    const owns = (name: string) =>
      n.outputNames.includes(name) || n.inputNames.includes(name) ||
      (n.isCluster ? !!n.clusterMembers?.some(m => m.outputNames.includes(name)) : false)
    return new Set(balanceHints.filter(h => owns(h.productName)).map(h => h.productName))
  }, [hoveredKey, nodeByKey, balanceHints])

  // Reveal + scroll the spotlighted Issue into view so the explanation is never
  // hidden below the fold or inside the collapsed overproduction group.
  useEffect(() => {
    if (hoveredIssueProducts.size === 0) return
    if (excess.some(h => hoveredIssueProducts.has(h.productName))) setShowExcess(true)
    const first = [...hoveredIssueProducts][0]
    hintRefs.current.get(first)?.scrollIntoView({ block: 'nearest' })
  }, [hoveredIssueProducts, excess])

  // Layout math lives in ./chainLayout (pure). These thin closures bind the
  // current node set so call sites stay terse.
  const colCounts = useMemo(() => computeColCounts(nodes), [nodes])
  const vEstColY = (col: number) => vEstColYPure(col, colCounts, maxAssignedCol)
  const getNodeEstPos = (node: ChainNode) => getNodeEstPosPure(node, colCounts, maxAssignedCol)

  // Card-shape signature per node: same outputs ⇒ same rendered size. Clusters are
  // unique (their height depends on their members). Used to measure once per shape.
  const shapeByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of nodes) {
      m.set(n.key, n.isCluster
        ? `C|${n.key}`
        : `${n.unassigned ? 'U' : ''}|${nodeTerminal.get(n.key) !== n.key ? 'F' : ''}|${n.outputNames.join('')}`)
    }
    return m
  }, [nodes, nodeTerminal])

  // Every node's size from the per-shape cache (estimate until its shape is seen).
  const nodeSizes = useMemo(() => {
    const m = new Map<string, { w: number; h: number }>()
    for (const n of nodes) m.set(n.key, sizeByShape.get(shapeByKey.get(n.key)!) ?? { w: NODE_W, h: NODE_H_EST })
    return m
  }, [nodes, sizeByShape, shapeByKey])

  // Band stacking only needs the tallest card per tier, so once every shape is
  // measured the layout is exact even for nodes that were never mounted.
  const nodePos = useMemo(
    () => computeMeasuredPositions(nodes, colCounts, maxAssignedCol, nodeSizes).positions,
    [nodes, colCounts, maxAssignedCol, nodeSizes]
  )
  const getPos = (node: ChainNode) => nodePos.get(node.key) ?? getNodeEstPos(node)

  // Arrows are pure over positions/sizes and view-independent, so they're memoized
  // (NOT recomputed on pan/zoom — only the on-screen subset is re-filtered below).
  const { arrows, svgSize } = useMemo(() => {
    if (nodes.length === 0) return { arrows: [] as ArrowPath[], svgSize: { w: 0, h: 0 } }
    const colorMap = manyAlts ? new Map<string, string>() : terminalColorByNode
    return computeArrows(nodes, edges, nodePos, nodeSizes, { terminalColorByNode: colorMap, tierColor: TIER_COLOR })
  }, [nodes, edges, nodePos, nodeSizes, terminalColorByNode, manyAlts])

  const totalW = computeTotalW(colCounts)
  const totalH = svgSize.h || estimateTotalH(colCounts, maxAssignedCol)

  const { isNarrow, scale } = computeScale(containerW, containerH, totalW, totalH)

  // Past this many nodes we both viewport-cull and stop opening at fit (which
  // would be a microscopic, fan-pegging wall) — instead the default view holds a
  // readable zoom so only a legible slice mounts; the user pans to explore.
  const CULL_MIN = 120
  const MIN_DEFAULT_ZOOM = 0.55
  const bigGraph = nodes.length > CULL_MIN

  // Applied view: the user's pan/zoom when set (wide screens only), else the
  // default. Small graphs default to auto-fit (centered) exactly as before; big
  // graphs default to a readable top-left slice so culling kicks in immediately.
  const defaultZoom = bigGraph ? Math.max(scale, MIN_DEFAULT_ZOOM) : scale
  const fitView = { tx: Math.max(0, (containerW - totalW * defaultZoom) / 2), ty: 0, zoom: defaultZoom }
  const v = (!isNarrow && view) ? view : fitView
  viewRef.current = v
  narrowRef.current = isNarrow

  // Measure any not-yet-seen card shape from whatever is currently mounted, then
  // cache it. Runs after each commit but only sets state while NEW shapes appear,
  // so it converges in a pass or two and stays quiet during pan/zoom.
  useLayoutEffect(() => {
    const zoom = viewRef.current.zoom || 1
    let next: Map<string, { w: number; h: number }> | null = null
    for (const node of nodes) {
      const shp = shapeByKey.get(node.key)!
      if (sizeByShape.has(shp) || next?.has(shp)) continue
      const el = nodeRefs.current.get(node.key)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (!next) next = new Map(sizeByShape)
      next.set(shp, { w: r.width / zoom, h: r.height / zoom })
    }
    if (next) setSizeByShape(next)
    // Unmeasured-shape reps always mount (cull memo guarantees it), so new shapes
    // only appear via these deps — never via pan. Re-runs until sizes converge.
  }, [nodes, shapeByKey, sizeByShape])

  // Viewport culling: past CULL_MIN nodes, render only cards/arrows on screen
  // (+ a ~1.5-card margin). One card per still-unmeasured shape is mounted too,
  // wherever it sits, so sizes converge. Below the threshold, render everything.
  const doCull = !isNarrow && containerW > 0 && bigGraph
  const { renderNodes, visibleKeys } = useMemo(() => {
    if (!doCull) return { renderNodes: nodes, visibleKeys: null as Set<string> | null }
    const pad = NODE_W * 1.5
    const x0 = -v.tx / v.zoom - pad, x1 = (containerW - v.tx) / v.zoom + pad
    const y0 = -v.ty / v.zoom - pad, y1 = (containerH - v.ty) / v.zoom + pad
    const vis = new Set<string>()
    const seenShape = new Set<string>()
    const out: ChainNode[] = []
    for (const n of nodes) {
      const p = nodePos.get(n.key), s = nodeSizes.get(n.key)
      const onScreen = !p || !s ? true : (p.x <= x1 && p.x + s.w >= x0 && p.y <= y1 && p.y + s.h >= y0)
      if (onScreen) vis.add(n.key)
      const shp = shapeByKey.get(n.key)!
      const needMeasure = !sizeByShape.has(shp) && !seenShape.has(shp)
      if (needMeasure) seenShape.add(shp)
      if (onScreen || needMeasure) out.push(n)
    }
    return { renderNodes: out, visibleKeys: vis }
  }, [doCull, nodes, nodePos, nodeSizes, sizeByShape, shapeByKey, v.tx, v.ty, v.zoom, containerW, containerH])

  // Both endpoints must be in the padded viewport: a visible hub (a P1 cluster
  // feeding dozens of P2s) would otherwise drag its whole fan of arrows across an
  // off-screen graph. You see the connections among what's on screen; panning
  // reveals the rest, and the margin keeps edges from popping.
  const renderArrows = (doCull && visibleKeys)
    ? arrows.filter(a => visibleKeys.has(a.fromKey) && visibleKeys.has(a.toKey))
    : arrows

  if (characters.length === 0) {
    return <div className={styles.empty}>Set up your characters first to see the production chain.</div>
  }
  if (nodes.length === 0) {
    return <div className={styles.empty}>Import planets in Setup to build the chain.</div>
  }

  const activeCols = ([0, 1, 2, 3] as const).filter(i => nodes.some(n => n.column === i))

  // Only a SHORTFALL is a genuine fault — the line can't keep up, so its arrow
  // marches broken with a red flash. Overproduction isn't a problem (the surplus
  // just gets sold), so its arrow stays a healthy flow — only fatter + a touch
  // faster, reading as "more than enough coming through" rather than "broken".
  const shortfallProducts = new Set(bottlenecks.map(h => h.productName))
  const surplusProducts = new Set(excess.map(h => h.productName))

  // Warning-chip hover → the nodes that make or consume that product.
  const warnKeys: Set<string> | null = warnProduct
    ? new Set(nodes.filter(n =>
        n.outputNames.includes(warnProduct) || n.inputNames.includes(warnProduct) ||
        (n.isCluster ? !!n.clusterMembers?.some(m => m.outputNames.includes(warnProduct)) : false)
      ).map(n => n.key))
    : null

  // ── Suggestions column (right side) ──────────────────────────────────────────
  // Only suggestions whose ISK/hr would raise income considerably — at least the
  // configured % of current income. (When income is 0 the threshold is 0, so all
  // show.) The panel itself always renders when there are any suggestions, so the
  // threshold control stays reachable even if everything is filtered out.
  const minSuggestIsk = currentIncome * (threshold / 100)
  const shownSuggestions = suggestions.filter(s => s.iskHr >= minSuggestIsk)
  const showSuggestPanel = suggestionsAllowed && suggestions.length > 0

  // Suggestion-row hover → locate the involved existing planets / chain in graph.
  const hoverSuggestion = hoverSuggestKey ? shownSuggestions.find(s => s.key === hoverSuggestKey) : null
  const suggestKeys: Set<string> | null = hoverSuggestion
    ? (() => {
        const names = collectChainNames(hoverSuggestion.prereqFor?.name ?? hoverSuggestion.product.name)
        for (const inp of hoverSuggestion.inputs) names.add(inp.name)
        return new Set(nodes.filter(n =>
          n.outputNames.some(o => names.has(o)) || n.inputNames.some(o => names.has(o)) ||
          (n.isCluster ? !!n.clusterMembers?.some(m => m.outputNames.some(o => names.has(o))) : false)
        ).map(n => n.key))
      })()
    : null

  // What's currently emphasized — a hovered warning or suggestion wins over a
  // hovered node, which in turn wins over a click-pinned alt (the persistent base).
  const highlight = warnKeys ?? suggestKeys ?? connectedSet ?? pinnedSet

  // Alt color for a node key (node border tint + hovered-chain arrow tint at scale).
  const altColorOf = (key: string): string | undefined => {
    const n = nodeByKey.get(key)
    return n ? (charColorByCharId.get(n.characterId) ?? TIER_COLOR[n.outputTier]) : undefined
  }

  // Alts touched by the current highlight (for the at-scale legend on hover).
  const altsInHighlight: StoredCharacter[] = highlight
    ? (() => {
        const ids = new Set<number>()
        for (const n of nodes) {
          if (!highlight.has(n.key)) continue
          if (n.isCluster) n.clusterMembers?.forEach(m => ids.add(m.characterId))
          else if (n.characterId > 0) ids.add(n.characterId)
        }
        return characters.filter(c => ids.has(c.characterId))
      })()
    : []

  const togglePin = (id: number) => setPinnedAltId(prev => (prev === id ? null : id))
  const renderAltRows = (list: StoredCharacter[]) =>
    list.slice()
      .sort((a, b) => (b.piSkills.interplanetaryConsolidation - a.piSkills.interplanetaryConsolidation) || (b.planets.length - a.planets.length))
      .map(c => {
        const color = charColorByCharId.get(c.characterId)
        if (!color) return null
        const pinned = pinnedAltId === c.characterId
        return (
          <button
            key={c.characterId}
            type="button"
            className={`${styles.legendRow} ${styles.legendRowClickable} ${pinned ? styles.legendRowPinned : ''}`}
            onClick={() => togglePin(c.characterId)}
            title={pinned ? 'Click to clear the focus' : `Focus ${c.characterName}'s chain`}
          >
            <span className={styles.legendDot} style={{ background: color }} />
            <span className={styles.legendName}>{c.characterName}</span>
            {pinned && <span className={styles.legendPinMark}>📌</span>}
          </button>
        )
      })

  // Empire stats for the at-scale summary that replaces the rainbow legend.
  const empireStats = (() => {
    let planets = 0, extractors = 0, factories = 0
    for (const c of characters) for (const p of c.planets) {
      planets++
      const tiers = p.outputTiers ?? []
      if (tiers.length === 0 || tiers.every(t => t === 'P1')) extractors++; else factories++
    }
    return { planets, extractors, factories, alts: characters.filter(c => c.planets.length > 0).length }
  })()

  const renderHint = (hint: BalanceHint, idx: number) => {
    const isBottleneck = hint.type === 'bottleneck'
    return (
      <div
        key={`${hint.productName}-${idx}`}
        ref={el => { if (el) hintRefs.current.set(hint.productName, el); else hintRefs.current.delete(hint.productName) }}
        className={`${styles.balanceHint} ${isBottleneck ? styles.balanceHintSevere : ''} ${warnProduct === hint.productName ? styles.balanceHintActive : ''} ${hoveredIssueProducts.has(hint.productName) ? styles.balanceHintSpotlight : ''}`}
        onMouseEnter={() => setWarnProduct(hint.productName)}
        onMouseLeave={() => setWarnProduct(null)}
        title={isBottleneck
          ? `${hint.productName} is needed by ${hint.consumers} planet${hint.consumers !== 1 ? 's' : ''} but only produced by ${hint.producers}. This is costing you output. Hover to locate it; consider adding another extractor.`
          : `${hint.productName} is produced by ${hint.producers} planet${hint.producers !== 1 ? 's' : ''} but only consumed by ${hint.consumers}. The surplus can be sold. Hover to locate it; consider repurposing an extractor.`
        }
      >
        <span className={styles.balanceHintIcon}>{isBottleneck ? '⚡' : '〰'}</span>
        <span className={styles.balanceHintText}>
          <strong>{hint.productName}</strong> {isBottleneck ? 'shortfall' : 'overproduced'} <span className={styles.balanceHintRatio}>×{hint.producers}/{hint.consumers}</span>
        </span>
      </div>
    )
  }

  return (
    <>
    <div className={styles.root}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        {onBack && (
          <button className={styles.dirBtn} onClick={onBack} title="Back to the chain list">
            ← {backLabel}
          </button>
        )}
        {focusTitle && <span className={styles.focusTitle}>{focusTitle}</span>}
        {suggestionsAllowed && (
          <label className={styles.maxSkillsLabel} title="Assume all characters have max PI skills (IPC 5)">
            <input type="checkbox" checked={assumeMaxSkills} onChange={e => setAssumeMaxSkills(e.target.checked)} />
            Max skills
            {systemPlanetsLoading && <span className={styles.suggestLoading}>…</span>}
          </label>
        )}
        {!isNarrow && view && (
          <button className={styles.dirBtn} onClick={() => setView(null)} title="Reset zoom & pan to fit the whole graph">
            Fit · {Math.round(v.zoom * 100)}%
          </button>
        )}
        {onSeeEverything && <SeeEverythingButton onClick={onSeeEverything} />}
      </div>

      <div className={`${styles.canvas} ${isNarrow ? styles.canvasScroll : ''}`} ref={canvasRef}>
        {isNarrow && (
          <div className={styles.mobileHint}>
            Drag to pan · the production chain is best viewed on a wider screen
          </div>
        )}
        {/* Warnings column — pinned right (shifts left when the suggestions column
            shows); hover a row to locate it in the graph. */}
        {balanceHints.length > 0 && (
          <div className={styles.warningsPanel} style={{ right: showSuggestPanel ? 252 : 12 }}>
            <div className={styles.warningsTitle}>
              Issues · {bottlenecks.length ? `${bottlenecks.length} shortfall${bottlenecks.length !== 1 ? 's' : ''}` : 'none critical'}
            </div>
            {/* Shortfalls first — these are actually costing you output. */}
            {bottlenecks.map(renderHint)}
            {/* Overproduction: the surplus can be sold, so it's demoted and
                collapsed by default once there's more than a couple. */}
            {excess.length > 0 && (
              excess.length <= 2 || showExcess ? (
                <>
                  {excess.length > 2 && (
                    <button
                      className={styles.excessToggle}
                      onClick={() => setShowExcess(false)}
                    >
                      ▾ Overproduced · {excess.length} (can be sold)
                    </button>
                  )}
                  {excess.map(renderHint)}
                </>
              ) : (
                <button
                  className={styles.excessToggle}
                  onClick={() => setShowExcess(true)}
                >
                  ▸ Overproduced · {excess.length} (can be sold)
                </button>
              )
            )}
          </div>
        )}
        {/* Suggestions column — second column pinned to the far right (issues sit
            to its left). Always on; hover a row to locate the chain, click to open
            the plan. Filtered to suggestions worth ≥ threshold% of current income. */}
        {showSuggestPanel && (
          <div className={`${styles.warningsPanel} ${styles.suggestPanel}`} style={{ right: 12 }}>
            <div className={styles.suggestHead}>
              <span className={styles.warningsTitle}>
                Suggestions · {shownSuggestions.length}
                {systemPlanetsLoading && <span className={styles.suggestLoading}>…</span>}
              </span>
              <label className={styles.suggestThresh} title="Only show suggestions worth at least this % of your current income/hr">
                ≥
                <input
                  type="number" min={0} max={100} value={threshold}
                  onChange={e => updateThreshold(Number(e.target.value))}
                />
                %
              </label>
            </div>
            {shownSuggestions.length === 0 ? (
              <div className={styles.suggestEmpty}>
                No suggestion clears the {threshold}% bar. Lower it to see smaller wins.
              </div>
            ) : shownSuggestions.map(s => (
              <div
                key={s.key}
                className={`${styles.suggestRow} ${s.blocked ? styles.suggestRowBlocked : ''} ${hoverSuggestKey === s.key ? styles.suggestRowActive : ''}`}
                onMouseEnter={() => setHoverSuggestKey(s.key)}
                onMouseLeave={() => setHoverSuggestKey(null)}
                onClick={() => setSelectedSuggestion(s)}
                title={`${s.product.tier} ${s.product.name} · ≈ +${formatIsk(s.iskHr)}/hr potential. Hover to locate the chain; click for the step-by-step plan.`}
              >
                <span className={styles.suggestIcon}>{s.blocked ? '⚠' : s.prereqFor ? '↻' : '✦'}</span>
                <span className={styles.suggestText}>
                  <span className={styles.suggestName}>
                    <span className={`badge badge-${s.product.tier.toLowerCase()}`} style={{ marginRight: 4, fontSize: 9 }}>{s.product.tier}</span>
                    {s.product.name}
                  </span>
                  <span className={styles.suggestIsk}>+{formatIsk(s.iskHr)}/hr</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Tier band labels — outside canvasInner, pinned to canvas left, Y converted to visual coords */}
        {activeCols.slice().reverse().map(i => {
          const pos = nodePos.get(nodes.find(n => n.column === i)?.key ?? '')
          const canvasY = pos?.y ?? vEstColY(i)
          const top = canvasY * v.zoom + v.ty
          return (
            <div key={i} className={styles.rowHeader} style={{ top }}>
              <span className={styles.colTier} style={{ color: TIER_COLOR[`P${i + 1}` as PITier] }}>P{i + 1}</span>
              <span className={styles.colLabel}>{COL_LABELS[i]}</span>
            </div>
          )
        })}
        <div ref={canvasInnerRef} className={styles.canvasInner} style={{ width: totalW, minHeight: totalH, transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`, transformOrigin: 'top left' }}>
        <svg className={styles.svg} width={svgSize.w || totalW} height={svgSize.h || totalH}>
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {renderArrows.map((a, i) => {
            const isOrphaned = !productiveNodes.has(a.toKey) && !a.ghost
            const resting = highlight === null
            const connected = resting || (highlight.has(a.fromKey) && highlight.has(a.toKey))
            const labelNames = a.label.split(', ')
            const shortfall = !a.ghost && labelNames.some(n => shortfallProducts.has(n))
            const surplus   = !a.ghost && labelNames.some(n => surplusProducts.has(n))
            // "Live" = part of the resting web or the hovered chain. A live arrow
            // is dotted and marching; everything a hover pushes aside collapses to
            // a thin, static, continuous line so only the focus keeps moving.
            const live = resting || connected
            const opacity = !live ? 0.1
              : a.ghost ? 0.5
              : isOrphaned ? 0.12
              : resting ? 0.4
              : 1
            // Health is read from HOW the dashes march — smooth when balanced,
            // stuttering (with a red flash behind it) when there's a shortfall.
            const dashArray = !live ? '0' : a.ghost ? '1 7' : '6 4'
            const flowClass = !live ? undefined
              : a.ghost ? styles.arrowGhost
              : shortfall ? styles.arrowBroken
              : surplus ? styles.arrowSurplus
              : styles.arrowFlow
            const baseWidth = !live ? 1 : (connected && highlight ? 2.5 : 1.5)
            const strokeWidth = !live ? baseWidth
              : shortfall ? baseWidth + 0.75
              : surplus ? baseWidth + 1   // fatter = more flowing through than needed
              : baseWidth
            // At scale the base color is the tier; tint the highlighted chain by alt.
            const stroke = (manyAlts && highlight !== null && connected && !a.ghost)
              ? (altColorOf(a.fromKey) ?? a.color)
              : a.color
            return (
              <g key={i} style={{ transition: 'opacity 0.15s' }} opacity={opacity}>
                {shortfall && live && (
                  <path d={a.d} fill="none" stroke="#d65a5a" className={styles.issueBackdrop} />
                )}
                <path d={a.d} fill="none" stroke={stroke} strokeWidth={strokeWidth}
                  strokeOpacity={!live ? 0.45 : a.ghost ? 0.6 : connected ? 0.85 : 0.5}
                  strokeDasharray={dashArray} color={stroke} markerEnd="url(#arrowhead)"
                  className={flowClass} style={{ transition: 'stroke 0.25s, stroke-width 0.15s' }} />
                {(altHeld || (hoveredKey !== null && connected)) && !a.ghost && (
                  <>
                    <rect x={a.labelX - a.label.length * 3.2 - 6} y={a.labelY - 10}
                      width={a.label.length * 6.4 + 12} height={14}
                      rx={4} fill="var(--bg-deep)" opacity={0.85} />
                    <text x={a.labelX} y={a.labelY} textAnchor="middle"
                      fill={stroke} fontSize={10} fontWeight={700}
                      style={{ userSelect: 'none', fontFamily: 'var(--font)' }}>
                      {a.label}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>

        {renderNodes.map((node) => {
          const pos = getPos(node)
          return (
            <PlanetNode
              key={node.key}
              node={node}
              producedNames={producedNames}
              importedNames={chainModel.importedNames}
              consumedOutputs={primaryConsumedByNode.get(node.key) ?? new Set()}
              feedsLabel={nodeTerminal.get(node.key) !== node.key ? (terminalNameByKey.get(nodeTerminal.get(node.key) ?? '') ?? null) : null}
              x={pos.x}
              y={pos.y}
              hovered={hoveredKey === node.key}
              dimmed={highlight !== null && !highlight.has(node.key)}
              borderColor={
                (manyAlts && !(highlight?.has(node.key)))
                  ? TIER_COLOR[node.outputTier]
                  : (charColorByCharId.get(node.characterId) ?? TIER_COLOR[node.outputTier])
              }
              tierMode={manyAlts && !(highlight?.has(node.key))}
              charColorByCharId={charColorByCharId}
              onHover={setHoveredKey}
              onInputRef={(name, el) => {
                const key = `${node.key}:${name}`
                if (el) inputChipRefs.current.set(key, el)
                else inputChipRefs.current.delete(key)
              }}
              ref={(el) => { if (el) nodeRefs.current.set(node.key, el); else nodeRefs.current.delete(node.key) }}
            />
          )
        })}
        </div>
        {/* Legend (bottom-right, above the templates button). At small scale it's
            the per-alt color key; past ~4 alts that's a rainbow, so we show a
            stats summary instead and reveal just the hovered chain's alts. */}
        {characters.length > 0 && !isNarrow && (
          <div className={styles.legend}>
            {!manyAlts ? (
              renderAltRows(characters)
            ) : highlight && altsInHighlight.length > 0 ? (
              <>
                <div className={styles.legendTitle}>This chain</div>
                {renderAltRows(altsInHighlight)}
              </>
            ) : (
              <div className={styles.legendStats}>
                <div className={styles.legendStatBig}>{empireStats.alts} alts</div>
                <div>{empireStats.planets} planets</div>
                <div>{empireStats.extractors} extractors · {empireStats.factories} factories</div>
                <div className={styles.legendHint}>colored by tier · hover a chain for alts</div>
              </div>
            )}
            {/* Space-gated teaching: a sparse "See everything" graph has room to
                explain its visual language; a dense one stays terse (the stats
                line above already carries the one-line hint). */}
            {!singleChain && nodes.length <= 10 && (
              <div className={styles.legendTeach}>
                <div className={styles.legendTeachRow}>
                  <span className={styles.legendTeachFlow} /> healthy flow
                </div>
                <div className={styles.legendTeachRow}>
                  <span className={styles.legendTeachIssue} /> shortfall — hover the card, see Issues
                </div>
                <p className={styles.legendTeachText}>
                  Cards are planets, arrows point from an input to the planet that uses it.
                  Hover a card to light its whole chain; click an alt above to pin it.
                  Hold <kbd className={styles.legendKbd}>Alt</kbd> to label every arrow.
                </p>
              </div>
            )}
          </div>
        )}
        <TemplateSearch />
      </div>
    </div>
    {selectedSuggestion && (
      <SuggestionPlan
        suggestion={selectedSuggestion}
        characters={characters}
        onClose={() => setSelectedSuggestion(null)}
        onVerified={onRefresh}
      />
    )}
    </>
  )
}

// ── PlanetNode ─────────────────────────────────────────────────────────────────

interface PlanetNodeProps {
  node: ChainNode
  producedNames: Set<string>
  importedNames: Set<string>
  consumedOutputs: Set<string>
  feedsLabel: string | null
  x: number
  y: number
  hovered: boolean
  dimmed: boolean
  borderColor: string
  /** When true (scale view, >4 alts, not in the hovered chain) color by product
   *  tier instead of by alt — clusters honor this too, not just single nodes. */
  tierMode: boolean
  charColorByCharId: Map<number, string>
  onHover: (key: string | null) => void
  onInputRef?: (name: string, el: HTMLSpanElement | null) => void
}

const PlanetNode = React.forwardRef<HTMLDivElement, PlanetNodeProps>(
  function PlanetNode({ node, producedNames, importedNames, consumedOutputs, feedsLabel, x, y, hovered, dimmed, borderColor, tierMode, charColorByCharId, onHover, onInputRef }, ref) {
    const dotColor = PLANET_COLOR[node.planetType] ?? '#404050'

    // Shared input-chip renderer — used by both the normal card and the cluster
    // card (all members of a cluster share the same inputs).
    const renderInput = (name: string) => {
      const covered = producedNames.has(name)
      const isSelfExtracted = PRODUCT_BY_NAME.get(name)?.tier === 'P0'
      // Not produced anywhere, but not a genuine gap either — you buy/haul it in.
      const isImported = !covered && !isSelfExtracted && importedNames.has(name)
      const cls = isSelfExtracted ? styles.nodeInputSelf
        : covered ? styles.nodeInputCovered
        : isImported ? styles.nodeInputImported
        : styles.nodeInputMissing
      const title = isSelfExtracted
        ? `Extracted on this planet (P0 → P1)`
        : covered ? `Supplied by another planet`
        : isImported ? `Imported — bought or hauled in, not produced from your own chain`
        : getMissingInputHint(name)
      return (
        <span key={name} ref={el => onInputRef?.(name, el)}
          className={`${styles.nodeInput} ${cls}`} title={title}>{name}</span>
      )
    }

    // Cluster node: duplicate producers of one product, sub-divided by character.
    if (node.isCluster && node.clusterMembers) {
      // Group members by character in order of first appearance
      const charOrder: number[] = []
      const byChar = new Map<number, ClusterMember[]>()
      for (const m of node.clusterMembers) {
        if (!byChar.has(m.characterId)) { byChar.set(m.characterId, []); charOrder.push(m.characterId) }
        byChar.get(m.characterId)!.push(m)
      }
      // In tier-mode the cluster colors by its product tier like every other node;
      // otherwise it keeps the per-alt look (single alt → that alt's color,
      // multiple → neutral border + a rainbow stripe of the contributing alts).
      const clusterBorder = tierMode
        ? borderColor
        : (charOrder.length === 1 ? (charColorByCharId.get(charOrder[0]) ?? 'var(--border)') : 'var(--border)')
      const clusterStripe = tierMode
        ? borderColor
        : `linear-gradient(90deg, ${charOrder.map(id => charColorByCharId.get(id) ?? '#aaa').join(', ')})`

      // Cap the member list so a huge cluster (e.g. Precious Metals ×40) stays a
      // readable card; the rest collapse into a "+N more" line.
      const MEMBER_CAP = 12
      let budget = MEMBER_CAP
      const cappedGroups: { id: number; members: ClusterMember[] }[] = []
      for (const id of charOrder) {
        if (budget <= 0) break
        const slice = byChar.get(id)!.slice(0, budget)
        budget -= slice.length
        cappedGroups.push({ id, members: slice })
      }
      const overflow = node.clusterMembers.length - (MEMBER_CAP - budget)

      return (
        <div ref={ref}
          className={`${styles.node} ${styles.nodeCluster} ${hovered ? styles.nodeHovered : ''} ${dimmed ? styles.nodeDimmed : ''}`}
          style={{ left: x, top: y, width: NODE_W,
            '--node-glow': clusterBorder,
            '--node-border': clusterBorder,
          } as React.CSSProperties}
          onMouseEnter={() => onHover(node.key)}
          onMouseLeave={() => onHover(null)}
        >
          <div className={styles.nodeTierStripe} style={{ background: clusterStripe }} />
          <div className={styles.nodeClusterHeader}>
            <span className={styles.nodeClusterBadge}>{node.outputTier}</span>
            <span className={styles.nodeClusterTitle}>{node.outputName || node.outputNames.join(', ')}</span>
            <span className={styles.nodeClusterCount}>×{node.clusterMembers.length}</span>
          </div>
          {feedsLabel && <div className={styles.nodeChainLabel}>→ {feedsLabel}</div>}
          <div className={styles.nodeClusterRows}>
            {cappedGroups.map(({ id, members }) => {
              const color = charColorByCharId.get(id) ?? '#aaa'
              return (
                <div key={id} className={styles.nodeClusterOwnerGroup} style={{ '--owner-color': color } as React.CSSProperties}>
                  <span className={styles.nodeClusterOwnerName}>{members[0].characterName}</span>
                  {members.map((m, i) => (
                    <div key={i} className={styles.nodeClusterRow}>
                      <span className={styles.nodeClusterChar}>{m.planetName}</span>
                    </div>
                  ))}
                </div>
              )
            })}
            {overflow > 0 && (
              <div className={styles.nodeClusterMore}>+{overflow} more planet{overflow !== 1 ? 's' : ''}</div>
            )}
          </div>
          {node.inputNames.length > 0 && (
            <div className={styles.nodeInputs}>
              {node.inputNames.map(n => renderInput(n))}
            </div>
          )}
        </div>
      )
    }

    // Top stripe gradient from output tier colors (visual hint, separate from border)
    const uniqueTiers = Array.from(new Set(node.outputTiers))
    const tierColors = uniqueTiers.map(t => TIER_COLOR[t as PITier]).filter(Boolean)
    const stripeStyle = tierColors.length === 0 ? undefined
      : { background: tierColors.length === 1 ? tierColors[0] : `linear-gradient(90deg, ${tierColors.join(', ')})` }

    return (
      <div ref={ref}
        className={`${styles.node} ${node.unassigned ? styles.nodeUnassigned : ''} ${hovered ? styles.nodeHovered : ''} ${dimmed ? styles.nodeDimmed : ''}`}
        style={{ left: x, top: y, width: NODE_W,
          '--node-glow': borderColor,
          '--node-border': borderColor,
        } as React.CSSProperties}
        onMouseEnter={() => onHover(node.key)}
        onMouseLeave={() => onHover(null)}
      >
        {stripeStyle && (
          <div className={styles.nodeTierStripe} style={stripeStyle} />
        )}
        <div className={styles.nodeHeader}>
          <span className={styles.nodeDot} style={{ background: dotColor }} title={node.planetType} />
          <span className={styles.nodePlanetName}>{node.planetName}</span>
          {!node.unassigned && node.outputNames.some(n => !consumedOutputs.has(n)) && (
            <span
              className={styles.nodeBrokenChain}
              title="Some outputs aren't consumed by any other planet — this is fine for end products (P3/P4) you sell directly, but may indicate a missing downstream factory."
            >⛓</span>
          )}
          <span className={styles.nodeChar}>{node.characterName}</span>
        </div>
        {node.unassigned ? (
          <div className={styles.nodeOutputs}>
            <span className={styles.nodeUnassignedLabel}>No output assigned</span>
          </div>
        ) : (() => {
          const allInputs = Array.from(new Set(
            node.outputNames.flatMap(n => SCHEMATIC_INPUTS_BY_NAME.get(n) ?? [])
          ))

          const renderChip = (n: string, i: number) => {
            const tier = node.outputTiers[i]
            return (
              <span key={n} className={styles.nodeOutputChip}
                style={{ '--tier-color': TIER_COLOR[tier] } as React.CSSProperties}>
                <span className={styles.nodeTierBadge}>{tier}</span>{n}
              </span>
            )
          }

          return (
            <>
              {feedsLabel && <div className={styles.nodeChainLabel}>→ {feedsLabel}</div>}
              <div className={styles.nodeOutputs}>
                {node.outputNames.map((n, i) => renderChip(n, i))}
              </div>
              {allInputs.length > 0 && (
                <div className={styles.nodeInputs}>
                  {allInputs.map(n => renderInput(n))}
                </div>
              )}
            </>
          )
        })()}
      </div>
    )
  }
)
