import React, { useLayoutEffect, useRef, useState, useMemo, useEffect } from 'react'
import type { StoredCharacter } from '../../types/api'
import { PRODUCT_BY_TYPE_ID, PRODUCT_BY_NAME, SCHEMATIC_INPUTS_BY_NAME } from '../../data/schematics'
import type { PITier } from '../../data/schematics'
import { PLANET_COLOR } from '../../data/planetColors'
import { useChainSuggestions, useBalanceHints, formatTrainTime, type ChainSuggestion } from '../../hooks/useChainSuggestions'
import { useSystemPlanets } from '../../hooks/useSystemPlanets'
import { SuggestionPlan } from '../SuggestionPlan/SuggestionPlan'
import { TemplateSearch } from '../TemplateSearch/TemplateSearch'
import {
  NODE_W,
  computeColCounts, computeTotalW, estimateTotalH, computeScale,
  computeMeasuredPositions, computeArrows,
  vEstColY as vEstColYPure, getNodeEstPos as getNodeEstPosPure,
  type ClusterMember, type ChainNode, type ChainEdge, type ArrowPath,
} from './chainLayout'
import styles from './ChainView.module.css'

// ── constants ─────────────────────────────────────────────────────────────────
// Geometry constants + the layout math live in ./chainLayout. Color/label maps
// stay here (TIER_COLOR is passed into the arrow builder as a param so the layout
// module carries no color policy).

const TIER_COLOR: Record<PITier, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}
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

  // Top-down clustering: assign rows starting from the highest tier.
  // For each tier, group supplier nodes under their consumers (already row-ordered).
  function clusterUnderConsumers(supplierNodes: ChainNode[], consumerNodes: ChainNode[]) {
    const consumersSorted = consumerNodes.slice().sort((a, b) => a.row - b.row)
    const placed = new Set<string>()
    const ordered: ChainNode[] = []
    for (const consumer of consumersSorted) {
      const feeders = supplierNodes
        .filter(s => !placed.has(s.key) && earlyEdges.some(e => e.fromKey === s.key && e.toKey === consumer.key))
        .sort((a, b) => a.characterName.localeCompare(b.characterName))
      for (const n of feeders) { ordered.push(n); placed.add(n.key) }
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

// ── P1 cluster merging ────────────────────────────────────────────────────────
// One cluster per P2 consumer. Inside each cluster, members are sub-grouped by character.

function clusterP1Nodes(nodes: ChainNode[], edges: ChainEdge[]): { nodes: ChainNode[], edges: ChainEdge[] } {
  const p1Nodes = nodes.filter(n => n.column === 0)
  const otherNodes = nodes.filter(n => n.column !== 0)

  // Map each P1 node to its first P2 consumer
  const p1ToP2 = new Map<string, string>()
  for (const e of edges) {
    const from = nodes.find(n => n.key === e.fromKey)
    const to   = nodes.find(n => n.key === e.toKey)
    if (from?.column === 0 && to?.column === 1 && !p1ToP2.has(e.fromKey))
      p1ToP2.set(e.fromKey, e.toKey)
  }

  // Group P1 nodes by their P2 consumer
  const byP2 = new Map<string, ChainNode[]>()
  const orphanP1: ChainNode[] = []
  for (const p1 of p1Nodes) {
    const p2Key = p1ToP2.get(p1.key)
    if (p2Key) {
      if (!byP2.has(p2Key)) byP2.set(p2Key, [])
      byP2.get(p2Key)!.push(p1)
    } else {
      orphanP1.push(p1)
    }
  }

  // Build cluster nodes and a key-remap table
  const clusterNodes: ChainNode[] = []
  const keyRemap = new Map<string, string>()  // old p1 key → cluster key

  for (const [p2Key, members] of byP2) {
    const clusterKey = `cluster:${p2Key}`
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

    clusterNodes.push({
      key: clusterKey,
      planetId: -1,
      planetName: '',
      planetType: '',
      characterId: members[0].characterId,
      characterName: '',
      outputTypeIds: members.flatMap(m => m.outputTypeIds),
      outputNames:   members.flatMap(m => m.outputNames),
      outputTiers:   members.flatMap(m => m.outputTiers),
      outputName:    members[0].outputName,
      outputTier:    'P1',
      inputNames:    [],
      unassigned:    false,
      column:        0,
      row:           members[0].row,
      isCluster:     true,
      clusterMembers: sortedMembers,
    })
  }

  // Reassign cluster rows sequentially; orphan P1s continue after clusters
  clusterNodes.sort((a, b) => a.row - b.row).forEach((n, i) => { n.row = i })
  orphanP1.sort((a, b) => a.row - b.row).forEach((n, i) => { n.row = clusterNodes.length + i })

  // Remap edges and deduplicate
  const seen = new Set<string>()
  const newEdges = edges
    .map(e => ({ ...e, fromKey: keyRemap.get(e.fromKey) ?? e.fromKey }))
    .filter(e => {
      const k = `${e.fromKey}→${e.toKey}:${e.productName}`
      if (seen.has(k)) return false
      seen.add(k); return true
    })

  return { nodes: [...otherNodes, ...clusterNodes, ...orphanP1], edges: newEdges }
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
  const [arrows, setArrows] = useState<ArrowPath[]>([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })
  const [nodePos, setNodePos] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [nodeSizes, setNodeSizes] = useState<Map<string, { w: number; h: number }>>(new Map())
  // center-x of each input chip in CSS canvas space, keyed `${nodeKey}:${inputName}`
  const [inputChipCX, setInputChipCX] = useState<Map<string, number>>(new Map())
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // Set while hovering a balance-warning chip → locates the responsible nodes.
  const [warnProduct, setWarnProduct] = useState<string | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true) }
    const up   = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  const [showSuggestions, setShowSuggestions] = useState(
    () => suggestionsAllowed && localStorage.getItem('chainView.suggestions') === 'true'
  )
  const [assumeMaxSkills, setAssumeMaxSkills] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<ChainSuggestion | null>(null)
  function toggleSuggestions(v: boolean) {
    localStorage.setItem('chainView.suggestions', String(v))
    setShowSuggestions(v)
  }

  const { systemPlanets, loading: systemPlanetsLoading } = useSystemPlanets(characters)
  const suggestions = useChainSuggestions(characters, prices, assumeMaxSkills, systemPlanets)
  const balanceHints = useBalanceHints(characters)

  const { nodes: rawNodes, edges: rawEdges, producedNames } = useMemo(() => buildGraph(characters), [characters])
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => clusterP1Nodes(rawNodes, rawEdges), [rawNodes, rawEdges])

  // ── Ghost nodes from suggestions ────────────────────────────────────────────
  const { nodes, edges } = useMemo(() => {
    if (!showSuggestions || suggestions.length === 0) return { nodes: baseNodes, edges: baseEdges }

    const colRowCount = new Map<number, number>()
    for (const n of baseNodes) colRowCount.set(n.column, (colRowCount.get(n.column) ?? 0) + 1)

    // Build a lookup of what each base node produces
    const baseProducedBy = new Map<string, ChainNode>()
    for (const n of baseNodes) for (const name of n.outputNames) baseProducedBy.set(name, n)

    const ghostNodes: ChainNode[] = []
    const ghostEdges: ChainEdge[] = []

    for (const s of suggestions) {
      // ── Main suggestion node (the final product) ──────────────────────────
      const mainCol = TIER_COL[s.product.tier] ?? 0
      const mainRow = colRowCount.get(mainCol) ?? 0
      colRowCount.set(mainCol, mainRow + 1)
      ghostNodes.push({
        key: s.key,
        planetId: -1,
        planetName: `Suggested: ${s.product.name}`,
        planetType: '',
        characterId: s.characterId,
        characterName: s.characterName,
        outputTypeIds: [s.product.typeId],
        outputNames: [s.product.name],
        outputTiers: [s.product.tier as PITier],
        outputName: s.product.name,
        outputTier: s.product.tier as PITier,
        inputNames: s.inputs.map(i => i.name),
        unassigned: false,
        column: mainCol,
        row: mainRow,
        suggested: true,
        suggestion: s,
      })

      // ── Step ghost nodes for each new planet needed ───────────────────────
      // chainSteps only lists items not already produced, in dependency order
      const stepKeyByProduct = new Map<string, string>([[s.product.name, s.key]])

      for (const step of s.chainSteps) {
        if (step.produces === s.product.name) continue // main node covers this
        const stepTier = (PRODUCT_BY_NAME.get(step.produces)?.tier ?? 'P1') as PITier
        const stepCol = TIER_COL[stepTier] ?? 0
        const stepRow = colRowCount.get(stepCol) ?? 0
        colRowCount.set(stepCol, stepRow + 1)
        const stepKey = `${s.key}:step:${step.produces}`
        stepKeyByProduct.set(step.produces, stepKey)
        const inputNames = step.role === 'extractor'
          ? (step.extractsP0 ? [step.extractsP0] : [])
          : (step.factoryInputs ?? [])
        ghostNodes.push({
          key: stepKey,
          planetId: -1,
          planetName: step.role === 'extractor' ? `New ${step.planetCategory} planet` : 'New factory planet',
          planetType: step.planetCategory,
          characterId: step.characterId,
          characterName: step.characterName,
          outputTypeIds: [],
          outputNames: [step.produces],
          outputTiers: [stepTier],
          outputName: step.produces,
          outputTier: stepTier,
          inputNames,
          unassigned: false,
          column: stepCol,
          row: stepRow,
          suggested: true,
          isStep: true,
          suggestion: s,
        })
      }

      // ── Edges for all ghost nodes in this suggestion ──────────────────────
      const ghostKeysInSuggestion = new Set(stepKeyByProduct.values())
      for (const [product, fromKey] of stepKeyByProduct) {
        const tier = (PRODUCT_BY_NAME.get(product)?.tier ?? 'P1') as PITier
        // Ghost → ghost
        for (const [, toKey] of stepKeyByProduct) {
          if (fromKey === toKey) continue
          const toNode = ghostNodes.find(n => n.key === toKey)
          if (toNode?.inputNames.includes(product))
            ghostEdges.push({ fromKey, toKey, productName: product, tier })
        }
        // Ghost → base node
        for (const base of baseNodes) {
          if (base.inputNames.includes(product))
            ghostEdges.push({ fromKey, toKey: base.key, productName: product, tier })
        }
      }
      // Base → ghost step node
      for (const ghostKey of ghostKeysInSuggestion) {
        const ghostNode = ghostNodes.find(n => n.key === ghostKey)
        if (!ghostNode) continue
        for (const inputName of ghostNode.inputNames) {
          const base = baseProducedBy.get(inputName)
          if (base) ghostEdges.push({ fromKey: base.key, toKey: ghostKey, productName: inputName, tier: base.outputTier })
        }
      }
    }

    return { nodes: [...baseNodes, ...ghostNodes], edges: [...baseEdges, ...ghostEdges] }
  }, [baseNodes, baseEdges, suggestions, showSuggestions])

  // Character color palette — distinct from TIER_COLOR values (P1=#4a90c8, P2=#8060c0, P3=#c06040, P4=#c09020)
  const CHAR_PALETTE = [
    '#3cc8a0', '#e05880', '#a0c840', '#d070e0', '#40c0e0', '#e09040', '#60d090', '#e06098'
  ]
  const charColorByCharId = useMemo(() => {
    const seen: number[] = []
    for (const n of nodes) {
      if (n.characterId > 0 && !seen.includes(n.characterId)) seen.push(n.characterId)
    }
    const m = new Map<number, string>()
    seen.forEach((id, i) => m.set(id, CHAR_PALETTE[i % CHAR_PALETTE.length]))
    return m
  }, [nodes])

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
      const node = nodes.find(n => n.key === nodeKey)
      if (node) terminalColorByNode.set(nodeKey, charColorByCharId.get(node.characterId) ?? TIER_COLOR[node.outputTier])
    }

    return { productiveNodes: productive, terminalColorByNode, nodeTerminal, terminalNameByKey }
  }, [nodes, edges, charColorByCharId])

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

  const hasUnassigned = nodes.some(n => n.unassigned)
  const maxAssignedCol = nodes.filter(n => !n.unassigned).reduce((m, n) => Math.max(m, n.column), -1)

  // Hover-focus: highlight the WHOLE chain the hovered node participates in, dim
  // the rest. Walk DOWN to every terminal it feeds (descendants), then back UP
  // from those to extraction (ancestors) — so a mid/high node lights just its
  // chain, while a genuinely shared input lights every terminal it contributes
  // to. (Plain undirected reachability over-merges via shared P1s.)
  const { fwd, bwd } = useMemo(() => {
    const fwd = new Map<string, Set<string>>()
    const bwd = new Map<string, Set<string>>()
    const add = (m: Map<string, Set<string>>, a: string, b: string) => { if (!m.has(a)) m.set(a, new Set()); m.get(a)!.add(b) }
    for (const e of edges) { add(fwd, e.fromKey, e.toKey); add(bwd, e.toKey, e.fromKey) }
    return { fwd, bwd }
  }, [edges])
  const connectedSet = useMemo(() => {
    if (hoveredKey === null) return null
    const closure = (start: string[], adj: Map<string, Set<string>>, seed: Set<string>) => {
      const seen = seed
      const stack = [...start]
      while (stack.length) {
        const k = stack.pop()!
        for (const n of adj.get(k) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) }
      }
      return seen
    }
    if (singleChain) {
      // Path THROUGH the node: its ancestors plus its descendants (no siblings),
      // so hovering a mid node in a one-chain view actually narrows the focus.
      const up = closure([hoveredKey], bwd, new Set([hoveredKey]))
      return closure([hoveredKey], fwd, up)
    }
    const down = closure([hoveredKey], fwd, new Set([hoveredKey])) // descendants + self
    return closure([...down], bwd, new Set(down))                  // + all their ancestors
  }, [hoveredKey, fwd, bwd, singleChain])

  // Layout math lives in ./chainLayout (pure). These thin closures bind the
  // current node set so call sites stay terse.
  const colCounts = useMemo(() => computeColCounts(nodes), [nodes])
  const vEstColY = (col: number) => vEstColYPure(col, colCounts, maxAssignedCol)
  const getNodeEstPos = (node: ChainNode) => getNodeEstPosPure(node, colCounts, maxAssignedCol)
  const getPos = (node: ChainNode) => nodePos.get(node.key) ?? getNodeEstPos(node)

  const totalW = computeTotalW(colCounts)
  const totalH = svgSize.h || estimateTotalH(colCounts, maxAssignedCol)

  const { isNarrow, scale } = computeScale(containerW, containerH, totalW, totalH)

  // Pass 1: measure actual node sizes → compute real positions
  useLayoutEffect(() => {
    if (nodes.length === 0) { setNodePos(new Map()); setNodeSizes(new Map()); setArrows([]); return }

    // getBoundingClientRect returns screen pixels (post-scale); divide by scale to get CSS pixels
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

    // Measure input chip center-x values for per-input arrow anchoring
    const canvasInner = canvasInnerRef.current
    if (canvasInner) {
      const canvasRect = canvasInner.getBoundingClientRect()
      const chipCX = new Map<string, number>()
      for (const [key, el] of inputChipRefs.current) {
        const r = el.getBoundingClientRect()
        chipCX.set(key, (r.left + r.width / 2 - canvasRect.left) / currentScale)
      }
      setInputChipCX(chipCX)
    }
  }, [nodes, containerW])

  // Pass 2: draw arrows after positions are settled. At scale, pass an empty
  // color map so arrows fall back to TIER colors; otherwise color by alt.
  useLayoutEffect(() => {
    if (nodes.length === 0 || nodePos.size === 0 || nodeSizes.size === 0) return
    const colorMap = manyAlts ? new Map<string, string>() : terminalColorByNode
    const { arrows: newArrows, svgSize: newSvgSize } =
      computeArrows(nodes, edges, nodePos, nodeSizes, { terminalColorByNode: colorMap, tierColor: TIER_COLOR })
    setSvgSize(newSvgSize)
    setArrows(newArrows)
  }, [nodes, edges, nodePos, nodeSizes, terminalColorByNode, inputChipCX, manyAlts])

  if (characters.length === 0) {
    return <div className={styles.empty}>Set up your characters first to see the production chain.</div>
  }
  if (nodes.length === 0) {
    return <div className={styles.empty}>Import planets in Setup to build the chain.</div>
  }

  const activeCols = ([0, 1, 2, 3] as const).filter(i => nodes.some(n => n.column === i))

  // Products with a balance problem → their arrows render dotted (vs solid healthy).
  const problemProducts = new Set(balanceHints.map(h => h.productName))

  // Warning-chip hover → the nodes that make or consume that product.
  const warnKeys: Set<string> | null = warnProduct
    ? new Set(nodes.filter(n =>
        n.outputNames.includes(warnProduct) || n.inputNames.includes(warnProduct) ||
        (n.isCluster ? !!n.clusterMembers?.some(m => m.outputNames.includes(warnProduct)) : false)
      ).map(n => n.key))
    : null

  // What's currently emphasized — a hovered warning wins over a hovered node.
  const highlight = warnKeys ?? connectedSet

  // Alt color for a node key (node border tint + hovered-chain arrow tint at scale).
  const altColorOf = (key: string): string | undefined => {
    const n = nodes.find(nn => nn.key === key)
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

  const renderAltRows = (list: StoredCharacter[]) =>
    list.slice()
      .sort((a, b) => (b.piSkills.interplanetaryConsolidation - a.piSkills.interplanetaryConsolidation) || (b.planets.length - a.planets.length))
      .map(c => {
        const color = charColorByCharId.get(c.characterId)
        if (!color) return null
        return (
          <div key={c.characterId} className={styles.legendRow}>
            <span className={styles.legendDot} style={{ background: color }} />
            <span className={styles.legendName}>{c.characterName}</span>
          </div>
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
        {onSeeEverything && (
          <button className={styles.dirBtn} onClick={onSeeEverything} title="Render the full combined production graph">
            See everything <span style={{ fontSize: 14 }}>⊞</span>
          </button>
        )}
        {focusTitle && <span className={styles.focusTitle}>{focusTitle}</span>}
        {suggestionsAllowed && (
          <button
            className={`${styles.suggestToggle} ${showSuggestions ? styles.suggestToggleActive : ''}`}
            onClick={() => toggleSuggestions(!showSuggestions)}
            title="Show chain suggestions"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2"/>
              <path d="M7 4v3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
            </svg>
            Suggestions
            {systemPlanetsLoading && <span className={styles.suggestLoading}>…</span>}
          </button>
        )}
        {suggestionsAllowed && showSuggestions && (
          <label className={styles.maxSkillsLabel} title="Assume all characters have max PI skills (IPC 5)">
            <input type="checkbox" checked={assumeMaxSkills} onChange={e => setAssumeMaxSkills(e.target.checked)} />
            Max skills
          </label>
        )}
      </div>

      <div className={`${styles.canvas} ${isNarrow ? styles.canvasScroll : ''}`} ref={canvasRef}>
        {isNarrow && (
          <div className={styles.mobileHint}>
            Drag to pan · the production chain is best viewed on a wider screen
          </div>
        )}
        {/* Warnings column — pinned right; hover a row to locate it in the graph. */}
        {balanceHints.length > 0 && (
          <div className={styles.warningsPanel}>
            <div className={styles.warningsTitle}>Issues · {balanceHints.length}</div>
            {balanceHints.map((hint, idx) => {
              const isBottleneck = hint.type === 'bottleneck'
              return (
                <div
                  key={`${hint.productName}-${idx}`}
                  className={`${styles.balanceHint} ${warnProduct === hint.productName ? styles.balanceHintActive : ''}`}
                  onMouseEnter={() => setWarnProduct(hint.productName)}
                  onMouseLeave={() => setWarnProduct(null)}
                  title={isBottleneck
                    ? `${hint.productName} is needed by ${hint.consumers} planet${hint.consumers !== 1 ? 's' : ''} but only produced by ${hint.producers}. Hover to locate it; consider adding another extractor.`
                    : `${hint.productName} is produced by ${hint.producers} planet${hint.producers !== 1 ? 's' : ''} but only consumed by ${hint.consumers}. Hover to locate it; consider repurposing an extractor.`
                  }
                >
                  <span className={styles.balanceHintIcon}>{isBottleneck ? '⚡' : '〰'}</span>
                  <span className={styles.balanceHintText}>
                    <strong>{hint.productName}</strong> {isBottleneck ? 'bottleneck' : 'overproduced'} <span className={styles.balanceHintRatio}>×{hint.producers}/{hint.consumers}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {/* Tier band labels — outside canvasInner, pinned to canvas left, Y converted to visual coords */}
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
        <div ref={canvasInnerRef} className={styles.canvasInner} style={{ width: totalW, minHeight: totalH, transform: `translateX(${Math.max(0, (containerW - totalW * scale) / 2)}px) scale(${scale})`, transformOrigin: 'top left' }}>
        <svg className={styles.svg} width={svgSize.w || totalW} height={svgSize.h || totalH}>
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const isOrphaned = !productiveNodes.has(a.toKey) && !a.ghost
            const connected = highlight === null || (highlight.has(a.fromKey) && highlight.has(a.toKey))
            const opacity = a.ghost ? 0.55 : isOrphaned ? 0.18 : connected ? 1 : 0.08
            // Healthy arrows keep the marching dashed flow (reads as "flowing");
            // issue arrows go SOLID + a touch wider with a pulsing red backdrop so
            // the problem grabs the eye instead of fading into a thin dotted line.
            const problem = !a.ghost && a.label.split(', ').some(n => problemProducts.has(n))
            const dashArray = a.ghost ? '4 6' : problem ? '0' : '6 4'
            const baseWidth = connected && highlight ? 2.5 : 1.5
            const strokeWidth = problem ? baseWidth + 1 : baseWidth
            // At scale the base color is the tier; tint the highlighted chain by alt.
            const stroke = (manyAlts && highlight !== null && connected && !a.ghost)
              ? (altColorOf(a.fromKey) ?? a.color)
              : a.color
            return (
              <g key={i} style={{ transition: 'opacity 0.15s' }} opacity={opacity}>
                {problem && (
                  <path d={a.d} fill="none" stroke="#ff4d4d" className={styles.issueBackdrop} />
                )}
                <path d={a.d} fill="none" stroke={stroke} strokeWidth={strokeWidth}
                  strokeOpacity={connected ? (a.ghost ? 0.6 : 0.8) : 0.5}
                  strokeDasharray={dashArray} color={stroke} markerEnd="url(#arrowhead)"
                  className={styles.arrowPath} style={{ transition: 'stroke 0.25s, stroke-width 0.15s' }} />
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

        {nodes.map((node) => {
          const pos = getPos(node)
          return (
            <PlanetNode
              key={node.key}
              node={node}
              producedNames={producedNames}
              consumedOutputs={primaryConsumedByNode.get(node.key) ?? new Set()}
              feedsLabel={nodeTerminal.get(node.key) !== node.key ? (terminalNameByKey.get(nodeTerminal.get(node.key) ?? '') ?? null) : null}
              x={pos.x}
              y={pos.y}
              hovered={hoveredKey === node.key}
              dimmed={highlight !== null && !highlight.has(node.key)}
              borderColor={
                node.suggested ? '#4ab095'
                : (manyAlts && !(highlight?.has(node.key)))
                  ? TIER_COLOR[node.outputTier]
                  : (charColorByCharId.get(node.characterId) ?? TIER_COLOR[node.outputTier])
              }
              charColorByCharId={charColorByCharId}
              onHover={setHoveredKey}
              onSelectSuggestion={setSelectedSuggestion}
              characters={characters}
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
  consumedOutputs: Set<string>
  feedsLabel: string | null
  x: number
  y: number
  hovered: boolean
  dimmed: boolean
  borderColor: string
  charColorByCharId: Map<number, string>
  onHover: (key: string | null) => void
  onSelectSuggestion?: (s: ChainSuggestion) => void
  characters: StoredCharacter[]
  onInputRef?: (name: string, el: HTMLSpanElement | null) => void
}

const PlanetNode = React.forwardRef<HTMLDivElement, PlanetNodeProps>(
  function PlanetNode({ node, producedNames, consumedOutputs, feedsLabel, x, y, hovered, dimmed, borderColor, charColorByCharId, onHover, onSelectSuggestion, characters, onInputRef }, ref) {
    const dotColor = PLANET_COLOR[node.planetType] ?? '#404050'

    // P1 cluster node: grouped by P2 consumer, sub-divided by character inside
    if (node.isCluster && node.clusterMembers) {
      // Group members by character in order of first appearance
      const charOrder: number[] = []
      const byChar = new Map<number, ClusterMember[]>()
      for (const m of node.clusterMembers) {
        if (!byChar.has(m.characterId)) { byChar.set(m.characterId, []); charOrder.push(m.characterId) }
        byChar.get(m.characterId)!.push(m)
      }
      return (
        <div ref={ref}
          className={`${styles.node} ${styles.nodeCluster} ${hovered ? styles.nodeHovered : ''} ${dimmed ? styles.nodeDimmed : ''}`}
          style={{ left: x, top: y, width: NODE_W,
            '--node-glow': charOrder.length === 1 ? (charColorByCharId.get(charOrder[0]) ?? 'var(--border)') : 'var(--border)',
            '--node-border': charOrder.length === 1 ? (charColorByCharId.get(charOrder[0]) ?? 'var(--border)') : 'var(--border)',
          } as React.CSSProperties}
          onMouseEnter={() => onHover(node.key)}
          onMouseLeave={() => onHover(null)}
        >
          <div className={styles.nodeTierStripe} style={{ background: `linear-gradient(90deg, ${charOrder.map(id => charColorByCharId.get(id) ?? '#aaa').join(', ')})` }} />
          <div className={styles.nodeClusterHeader}>
            <span className={styles.nodeClusterBadge}>P1</span>
            <span className={styles.nodeClusterTitle}>Extractors ×{node.clusterMembers.length}</span>
          </div>
          <div className={styles.nodeClusterRows}>
            {charOrder.map((charId, ci) => {
              const members = byChar.get(charId)!
              const color = charColorByCharId.get(charId) ?? '#aaa'
              return (
                <div key={charId} className={styles.nodeClusterOwnerGroup} style={{ '--owner-color': color } as React.CSSProperties}>
                  <span className={styles.nodeClusterOwnerName}>{members[0].characterName}</span>
                  {members.map((m, i) => (
                    <div key={i} className={styles.nodeClusterRow}>
                      <span className={styles.nodeClusterOutput}>{m.outputNames.join(', ')}</span>
                      <span className={styles.nodeClusterChar}>{m.planetName}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    // Step ghost node: a new extractor or factory planet needed by a suggestion
    if (node.suggested && node.isStep) {
      const tierColor = TIER_COLOR[node.outputTier]
      return (
        <div ref={ref}
          className={`${styles.node} ${styles.nodeGhost} ${hovered ? styles.nodeGhostHovered : ''} ${dimmed ? styles.nodeDimmed : ''}`}
          style={{ left: x, top: y, width: NODE_W, cursor: 'pointer' }}
          onMouseEnter={() => onHover(node.key)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onSelectSuggestion?.(node.suggestion!)}
          title="Click to open plan"
        >
          <div className={styles.nodeGhostStripe} />
          <div className={styles.nodeHeader}>
            <span className={styles.nodeDot} style={{ background: dotColor }} />
            <span className={styles.nodePlanetName}>{node.planetName}</span>
            <span className={styles.nodeChar}>{node.characterName}</span>
          </div>
          <div className={styles.nodeOutputs}>
            <span className={styles.nodeOutputChip} style={{ '--tier-color': tierColor } as React.CSSProperties}>
              <span className={styles.nodeTierBadge}>{node.outputTier}</span>{node.outputName}
            </span>
          </div>
          {node.inputNames.length > 0 && (
            <div className={styles.nodeInputs}>
              {node.inputNames.map(n => (
                <span key={n} className={`${styles.nodeInput} ${styles.nodeInputSelf}`}>{n}</span>
              ))}
            </div>
          )}
        </div>
      )
    }

    // Main suggestion ghost node: full suggestion card
    if (node.suggested && node.suggestion) {
      const s = node.suggestion
      const slotCount = s.slotsNeeded
      return (
        <div ref={ref}
          className={`${styles.node} ${styles.nodeGhost} ${s.blocked ? styles.nodeGhostBlocked : ''} ${hovered ? styles.nodeGhostHovered : ''} ${dimmed ? styles.nodeDimmed : ''}`}
          style={{ left: x, top: y, width: NODE_W, cursor: 'pointer' }}
          onMouseEnter={() => onHover(node.key)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onSelectSuggestion?.(s)}
          title="Click to open plan"
        >
          <div className={styles.nodeGhostStripe} />
          <div className={styles.nodeHeader}>
            <span className={`${styles.nodeGhostBadge} ${s.blocked ? styles.nodeGhostBadgeBlocked : ''}`}>
              {s.blocked ? '⚠ Blocked' : s.prereqFor ? '↻ Complete' : '✦ Suggest'}
            </span>
            <span className={styles.nodeGhostTitle}>
              <span className={`badge badge-${s.product.tier.toLowerCase()}`} style={{ marginRight: 5, fontSize: 10 }}>{s.product.tier}</span>
              {s.product.name}
            </span>
            <span className={styles.nodeGhostChar}>{s.characterName}</span>
          </div>
          {/* Inputs section — reuse nodeOutputs layout */}
          <div className={styles.nodeOutputs}>
            {s.inputs.map(inp => {
              const cls = inp.status === 'available' ? styles.nodeInputCovered : styles.nodeInputMissing
              const title = inp.status === 'available' ? 'Already produced' : 'Needs new planet(s)'
              return (
                <span key={inp.name} className={`${styles.nodeInput} ${cls}`} title={title}>
                  {inp.name}
                </span>
              )
            })}
          </div>
          {s.prereqFor && (
            <div className={styles.nodeGhostIsk} style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              → completes <span className={`badge badge-${s.prereqFor.tier.toLowerCase()}`} style={{ fontSize: 9 }}>{s.prereqFor.tier}</span> {s.prereqFor.name}
            </div>
          )}
          <div className={styles.nodeGhostIsk}>≈ {formatIsk(s.iskHr)}/hr potential</div>
          {s.blocked && (() => {
            const assignedChar = characters.find(c => c.characterName === s.characterName)
            const t = assignedChar?.skillTraining?.interplanetaryConsolidation
            const training = t?.toLevel === s.blocked.trainToLevel ? t : undefined
            const timeLeft = training ? Math.max(0, new Date(training.finishDate).getTime() - Date.now()) : 0
            const tlH = Math.floor(timeLeft / 3600_000)
            const tlM = Math.floor((timeLeft % 3600_000) / 60_000)
            return (
              <div className={styles.nodeGhostBlockedRow}>
                Needs {s.blocked.extraSlotsNeeded} more slot{s.blocked.extraSlotsNeeded !== 1 ? 's' : ''} — train IC {s.blocked.trainFromLevel}→{s.blocked.trainToLevel} ({formatTrainTime(s.blocked.trainTimeHours)})
                {training && (
                  <span className={styles.nodeGhostTraining}>
                    {' '}· {s.characterName} training now — {tlH > 0 ? `${tlH}h ${tlM}m` : `${tlM}m`} left
                  </span>
                )}
              </div>
            )
          })()}
          {s.repurposes ? (
            <div className={styles.nodeGhostRepurposeBlock}>
              <div className={styles.nodeGhostRepurposeHeader}>
                ↺ Repurpose {s.repurposes.planet.name}
                {s.repurposes.characterName !== s.characterName && (
                  <span className={styles.nodeGhostRepurposeChar}> · {s.repurposes.characterName}</span>
                )}
              </div>
              <div className={styles.nodeGhostRepurposeDetail}>
                Currently making <span className={styles.nodeGhostRepurposeLoses}>{s.repurposes.currentOutputNames.join(', ')}</span>
                {' '}— not feeding any chain, safe to repurpose.
              </div>
              <div className={styles.nodeGhostSlots}>{slotCount} new slot{slotCount !== 1 ? 's' : ''} needed (repurposing frees one)</div>
            </div>
          ) : (
            <div className={styles.nodeGhostSlots}>{slotCount} new slot{slotCount !== 1 ? 's' : ''} needed</div>
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

          const renderInput = (name: string) => {
            const covered = producedNames.has(name)
            const isSelfExtracted = PRODUCT_BY_NAME.get(name)?.tier === 'P0'
            const cls = isSelfExtracted ? styles.nodeInputSelf : covered ? styles.nodeInputCovered : styles.nodeInputMissing
            const title = isSelfExtracted
              ? `Extracted on this planet (P0 → P1)`
              : covered ? `Supplied by another planet` : getMissingInputHint(name)
            return (
              <span key={name} ref={el => onInputRef?.(name, el)}
                className={`${styles.nodeInput} ${cls}`} title={title}>{name}</span>
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
