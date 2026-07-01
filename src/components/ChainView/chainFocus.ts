// Single-chain focus helper: restrict the roster to just the planets (and the
// outputs on those planets) that belong to one terminal's chain. Pure, so it's
// unit-testable without the React view.

import type { StoredCharacter } from '../../types/api'
import { PRODUCT_BY_TYPE_ID } from '../../data/schematics'
import type { buildChainModel } from './chainModel'

/**
 * Restrict a character roster to only the planets that feed `terminalTypeId`,
 * AND trim each kept planet's outputs to just this chain's products.
 *
 * A planet that makes both this chain's product AND an unrelated one (a shared
 * factory) would otherwise drag the other product's outputs + inputs into the
 * focused view — surfacing phantom "missing" inputs that belong to a different
 * chain. Trimming the parallel arrays (outputs / outputNames / outputTiers) by
 * index keeps them aligned.
 */
export function filterToChain(
  characters: StoredCharacter[],
  model: ReturnType<typeof buildChainModel>,
  terminalTypeId: number,
): StoredCharacter[] {
  const terminal = model.terminals.find(t => t.product.typeId === terminalTypeId)
  if (!terminal) return characters
  const chainNames = new Set<string>([terminal.product.name, ...terminal.upstreamProducts])
  const keys = new Set<string>()
  for (const f of model.flows.values()) {
    if (chainNames.has(f.name)) for (const k of f.producerKeys) keys.add(k)
  }

  const trimToChain = (p: StoredCharacter['planets'][number]): StoredCharacter['planets'][number] => {
    const keepIdx = (p.outputs ?? []).map((tid, i) => {
      const prod = PRODUCT_BY_TYPE_ID.get(tid)
      return prod && chainNames.has(prod.name) ? i : -1
    }).filter(i => i >= 0)
    if (keepIdx.length === (p.outputs?.length ?? 0)) return p
    return {
      ...p,
      outputs: keepIdx.map(i => p.outputs[i]),
      ...(p.outputNames ? { outputNames: keepIdx.map(i => p.outputNames![i]) } : {}),
      ...(p.outputTiers ? { outputTiers: keepIdx.map(i => p.outputTiers![i]) } : {}),
    }
  }

  return characters
    .map(c => ({
      ...c,
      planets: c.planets
        .filter(p => keys.has(`${c.characterId}:${p.planetId}`))
        .map(trimToChain),
    }))
    .filter(c => c.planets.length > 0)
}
