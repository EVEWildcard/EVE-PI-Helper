// Product-level overview graph (level-of-detail for large empires).
//
// The planet graph renders one card per planet, so it grows without bound: at
// ~10 accounts it's thousands of DOM nodes and an unreadable wall. The product
// graph collapses every planet making the same product into ONE node. Because
// EVE has a fixed, small set of PI products (~66 across P1..P4), this graph's
// node count is BOUNDED regardless of empire size — more planets only change a
// node's count badge and throughput, never how many nodes exist.
//
// It's a pure projection of the ChainModel `flows` map (already computed): each
// flow becomes a node, and product→product edges come from the schematics. No
// React, no DOM — the component owns rendering and color policy.

import { PRODUCT_BY_TYPE_ID, SCHEMATIC_BY_OUTPUT, type PITier } from '../../data/schematics'
import type { ChainModel, ProductFlow } from './chainModel'
import type { ChainNode, ChainEdge } from './chainLayout'

const TIER_COL: Partial<Record<PITier, number>> = { P1: 0, P2: 1, P3: 2, P4: 3 }

/** Stable node key for a product node. */
export function productKey(typeId: number): string {
  return `product:${typeId}`
}

export interface ProductGraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
  /** node.key → the ProductFlow it represents (display data for the card). */
  flowByKey: Map<string, ProductFlow>
}

/**
 * Project the ChainModel into a product-level graph. One node per produced or
 * required product (P1..P4); edges run input → output via the schematics, drawn
 * only out of products you actually produce (an imported product is bought
 * finished, so its own inputs aren't part of your chain).
 */
export function buildProductGraph(model: ChainModel): ProductGraph {
  const flowByKey = new Map<string, ProductFlow>()
  const nodes: ChainNode[] = []

  for (const f of model.flows.values()) {
    if (f.tier === 'P0') continue
    const col = TIER_COL[f.tier] ?? 0
    const key = productKey(f.typeId)
    flowByKey.set(key, f)
    nodes.push({
      key,
      planetId: -1,
      planetName: '',
      planetType: '',
      characterId: -1,
      characterName: '',
      outputTypeIds: [f.typeId],
      outputNames: [f.name],
      outputTiers: [f.tier],
      outputName: f.name,
      outputTier: f.tier,
      inputNames: [],
      unassigned: false,
      column: col,
      row: 0,
      isProduct: true,
    })
  }

  // Edges: for each PRODUCED product, one edge per produced/required input that
  // is itself a node. `supply > 0` distinguishes "you make this" from a leaf you
  // only buy/haul (imported/missing) — we don't draw a bought product's inputs.
  const nodeKeys = new Set(nodes.map(n => n.key))
  const edges: ChainEdge[] = []
  for (const f of model.flows.values()) {
    if (f.tier === 'P0' || f.supply <= 0) continue
    const sch = SCHEMATIC_BY_OUTPUT.get(f.typeId)
    if (!sch) continue
    for (const inp of sch.inputs) {
      const ip = PRODUCT_BY_TYPE_ID.get(inp.typeId)
      if (!ip || ip.tier === 'P0') continue
      const fromKey = productKey(inp.typeId)
      if (!nodeKeys.has(fromKey)) continue
      edges.push({ fromKey, toKey: productKey(f.typeId), productName: ip.name, tier: ip.tier })
    }
  }

  assignRows(nodes, edges)
  return { nodes, edges, flowByKey }
}

/**
 * Top-down row assignment (same idea as the planet graph's clustering): order
 * the highest tier, then place each lower tier's suppliers grouped under the
 * consumers they feed, so arrows stay short and the columns read cleanly.
 */
function assignRows(nodes: ChainNode[], edges: ChainEdge[]) {
  const byColumn = new Map<number, ChainNode[]>()
  for (const n of nodes) {
    const arr = byColumn.get(n.column) ?? []
    arr.push(n)
    byColumn.set(n.column, arr)
  }
  const cols = [...byColumn.keys()].filter(c => c >= 0)
  if (cols.length === 0) return
  const maxCol = Math.max(...cols)

  // Index consumers-of-a-supplier for the clustering pass.
  const consumersOf = new Map<string, string[]>()
  for (const e of edges) {
    const arr = consumersOf.get(e.fromKey) ?? []
    arr.push(e.toKey)
    consumersOf.set(e.fromKey, arr)
  }

  // Top tier: most valuable / highest-throughput first, then by name.
  const top = byColumn.get(maxCol) ?? []
  top.sort((a, b) => a.outputName.localeCompare(b.outputName))
  top.forEach((n, i) => { n.row = i })

  for (let col = maxCol - 1; col >= 0; col--) {
    const suppliers = byColumn.get(col) ?? []
    const consumers = (byColumn.get(col + 1) ?? []).slice().sort((a, b) => a.row - b.row)
    if (suppliers.length === 0) continue
    const placed = new Set<string>()
    const ordered: ChainNode[] = []
    for (const consumer of consumers) {
      const feeders = suppliers
        .filter(s => !placed.has(s.key) && (consumersOf.get(s.key) ?? []).includes(consumer.key))
        .sort((a, b) => a.outputName.localeCompare(b.outputName))
      for (const s of feeders) { ordered.push(s); placed.add(s.key) }
    }
    for (const s of suppliers) if (!placed.has(s.key)) ordered.push(s)
    ordered.forEach((n, i) => { n.row = i })
  }
}
