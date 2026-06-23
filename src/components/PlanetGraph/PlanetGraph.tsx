import React, { useLayoutEffect, useRef, useState, useMemo } from 'react'
import type { StoredCharacter } from '../../types/api'
import { PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT } from '../../data/schematics'
import { PLANET_LABEL, PLANET_COLOR } from '../../data/planetColors'
import styles from './PlanetGraph.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode {
  key: string
  planetId: number
  planetName: string
  planetType: string
  characterName: string
  output: number | null       // type ID this planet produces
  outputTier: number          // 0–4
  inputs: number[]            // type IDs this planet needs as factory inputs
  colIdx: number
  x: number
  y: number
}

interface GraphEdge {
  fromKey: string
  toKey: string
  typeId: number
  tier: number
}

// ── Layout ────────────────────────────────────────────────────────────────────

const NODE_W  = 196
const NODE_H  = 100
const COL_GAP = 160
const ROW_GAP = 16
const PAD_X   = 48
const PAD_Y   = 48

const TIER_COLOR: Record<number, string> = {
  0: '#708070', 1: '#4a90c8', 2: '#8060c0', 3: '#c06040', 4: '#c09020'
}

// ── Graph computation ─────────────────────────────────────────────────────────

function buildGraph(characters: StoredCharacter[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []

  for (const char of characters) {
    for (const planet of char.planets) {
      const outputProduct = planet.output != null ? PRODUCT_BY_TYPE_ID.get(planet.output) : undefined
      const outputTier = outputProduct ? parseInt(outputProduct.tier.charAt(1)) : 0

      // Derive what inputs this planet needs from the schematic for its output
      const inputs: number[] = []
      if (planet.output != null) {
        const schematic = SCHEMATIC_BY_OUTPUT.get(planet.output)
        if (schematic) {
          for (const inp of schematic.inputs) inputs.push(inp.typeId)
        }
      }

      nodes.push({
        key: `${char.characterId}:${planet.planetId}`,
        planetId: planet.planetId,
        planetName: planet.name,
        planetType: planet.type,
        characterName: char.characterName,
        output: planet.output,
        outputTier,
        inputs,
        colIdx: 0,
        x: 0,
        y: 0
      })
    }
  }

  // Assign columns and rows
  const tierCount = new Map<number, number>()
  for (const node of nodes) {
    const idx = tierCount.get(node.outputTier) ?? 0
    node.colIdx = idx
    tierCount.set(node.outputTier, idx + 1)
  }

  // Compute positions
  const maxRows = Math.max(...Array.from(tierCount.values()), 1)
  for (const node of nodes) {
    const total = tierCount.get(node.outputTier) ?? 1
    const startY = ((maxRows - total) / 2) * (NODE_H + ROW_GAP)
    node.x = PAD_X + node.outputTier * (NODE_W + COL_GAP)
    node.y = PAD_Y + startY + node.colIdx * (NODE_H + ROW_GAP)
  }

  // Build output → node key map
  const outputToKey = new Map<number, string>()
  for (const node of nodes) {
    if (node.output != null) outputToKey.set(node.output, node.key)
  }

  // Build edges: for each node, connect each needed input to the node that produces it
  const edges: GraphEdge[] = []
  const edgeSet = new Set<string>()
  for (const consumer of nodes) {
    for (const inputTid of consumer.inputs) {
      const srcKey = outputToKey.get(inputTid)
      if (!srcKey || srcKey === consumer.key) continue
      const edgeKey = `${srcKey}→${consumer.key}:${inputTid}`
      if (edgeSet.has(edgeKey)) continue
      edgeSet.add(edgeKey)
      const p = PRODUCT_BY_TYPE_ID.get(inputTid)
      edges.push({
        fromKey: srcKey,
        toKey: consumer.key,
        typeId: inputTid,
        tier: p ? parseInt(p.tier.charAt(1)) : 0
      })
    }
  }

  return { nodes, edges }
}

// Which nodes have at least one unsatisfied input
function getUnsatisfied(nodes: GraphNode[]): Set<string> {
  const allOutputs = new Set(nodes.map((n) => n.output).filter((t): t is number => t != null))
  const result = new Set<string>()
  for (const node of nodes) {
    if (node.inputs.some((tid) => !allOutputs.has(tid))) {
      result.add(node.key)
    }
  }
  return result
}

// ── SVG bezier ────────────────────────────────────────────────────────────────

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`
}

// ── Planet node ───────────────────────────────────────────────────────────────

interface NodeProps {
  node: GraphNode
  unsatisfied: boolean
  nodeRef: (el: HTMLDivElement | null) => void
}

function PlanetNode({ node, unsatisfied, nodeRef }: NodeProps) {
  const typeColor = PLANET_COLOR[node.planetType] ?? '#666'
  const outputProduct = node.output != null ? PRODUCT_BY_TYPE_ID.get(node.output) : null
  const tierColor = outputProduct ? TIER_COLOR[node.outputTier] : undefined

  return (
    <div
      ref={nodeRef}
      className={`${styles.node} ${unsatisfied ? styles.nodeError : ''} ${!outputProduct ? styles.nodeEmpty : ''}`}
      style={{ left: node.x, top: node.y, '--type-color': typeColor } as React.CSSProperties}
    >
      <div className={styles.nodeHeader}>
        <span className={styles.nodeDot} style={{ background: typeColor }} />
        <span className={styles.nodeName}>{node.planetName}</span>
        <span className={styles.nodeChar}>{node.characterName}</span>
      </div>
      <div className={styles.nodeType}>{PLANET_LABEL[node.planetType] ?? node.planetType}</div>

      {outputProduct ? (
        <div className={styles.nodeOutput} style={{ '--tier-color': tierColor } as React.CSSProperties}>
          <span className={styles.nodeTierBadge}>{outputProduct.tier}</span>
          <span className={styles.nodeOutputName}>{outputProduct.name}</span>
        </div>
      ) : (
        <div className={styles.nodeNoOutput}>no output set</div>
      )}

      {unsatisfied && <div className={styles.errorFlag}>⚠ missing input</div>}
    </div>
  )
}

// ── PlanetGraph ───────────────────────────────────────────────────────────────

interface Props {
  characters: StoredCharacter[]
}

export function PlanetGraph({ characters }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(characters), [characters])
  const unsatisfiedKeys = useMemo(() => getUnsatisfied(nodes), [nodes])

  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [arrows, setArrows] = useState<{ d: string; tier: number; key: string }[]>([])
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 700 })

  useLayoutEffect(() => {
    if (nodes.length === 0) return
    const container = nodeRefs.current.values().next().value?.offsetParent as HTMLElement | null
    if (!container) return
    const cRect = container.getBoundingClientRect()

    const rects = new Map<string, DOMRect>()
    for (const [key, el] of nodeRefs.current) rects.set(key, el.getBoundingClientRect())

    let maxW = 0, maxH = 0
    for (const [, r] of rects) {
      const rx = r.right - cRect.left, ry = r.bottom - cRect.top
      if (rx > maxW) maxW = rx
      if (ry > maxH) maxH = ry
    }

    const newArrows = edges.map((edge) => {
      const src = rects.get(edge.fromKey)
      const dst = rects.get(edge.toKey)
      if (!src || !dst) return null
      const x1 = src.right - cRect.left
      const y1 = src.top - cRect.top + src.height / 2
      const x2 = dst.left - cRect.left
      const y2 = dst.top - cRect.top + dst.height / 2
      return { d: bezier(x1, y1, x2, y2), tier: edge.tier, key: `${edge.fromKey}→${edge.toKey}:${edge.typeId}` }
    }).filter((a): a is NonNullable<typeof a> => a != null)

    setArrows(newArrows)
    setCanvasSize({ w: maxW + PAD_X, h: maxH + PAD_Y })
  }, [nodes, edges])

  const allPlanets = characters.flatMap((c) => c.planets)

  if (characters.length === 0) {
    return <div className={styles.empty}><p>No characters yet — go to <strong>Setup</strong> to get started.</p></div>
  }
  if (allPlanets.length === 0) {
    return <div className={styles.empty}><p>No planets assigned — add some in <strong>Setup</strong>.</p></div>
  }

  const activeTiers = [...new Set(nodes.map((n) => n.outputTier))].sort()
  const w = Math.max(canvasSize.w, PAD_X * 2 + 5 * (NODE_W + COL_GAP))
  const h = Math.max(canvasSize.h, 500)

  return (
    <div className={styles.canvas}>
      {/* Tier column headers */}
      {activeTiers.map((tier) => (
        <div key={tier} className={styles.tierLabel}
          style={{ left: PAD_X + tier * (NODE_W + COL_GAP), color: TIER_COLOR[tier] }}>
          {tier === 0 ? 'P0 → P1' : `P${tier - 1} → P${tier}`}
        </div>
      ))}

      {/* SVG edge layer */}
      <svg className={styles.svg} width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
        <defs>
          {Object.entries(TIER_COLOR).map(([tier, color]) => (
            <marker key={tier} id={`arr-${tier}`} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill={color} opacity="0.65" />
            </marker>
          ))}
        </defs>
        {arrows.map((a) => (
          <path key={a.key} d={a.d} fill="none"
            stroke={TIER_COLOR[a.tier] ?? '#888'}
            strokeWidth="1.5" strokeOpacity="0.5"
            markerEnd={`url(#arr-${a.tier})`}
          />
        ))}
      </svg>

      {/* Planet nodes */}
      {nodes.map((node) => (
        <PlanetNode
          key={node.key}
          node={node}
          unsatisfied={unsatisfiedKeys.has(node.key)}
          nodeRef={(el) => { if (el) nodeRefs.current.set(node.key, el); else nodeRefs.current.delete(node.key) }}
        />
      ))}
    </div>
  )
}
