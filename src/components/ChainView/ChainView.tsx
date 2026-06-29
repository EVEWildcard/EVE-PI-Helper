import React, { useMemo, useState } from 'react'
import type { StoredCharacter } from '../../types/api'
import { ChainGraph } from './ChainGraph'
import { ChainTerminalList } from './ChainTerminalList'
import { buildChainModel } from './chainModel'
import styles from './ChainView.module.css'

// Container for the Production Chain tab. Default view is the ISK-ranked
// chain-terminal LIST (design v2); the full combined graph is the "see
// everything" escape hatch; clicking a terminal drills into that one chain.

type ViewMode = 'chains' | 'graph'

interface Props {
  characters: StoredCharacter[]
  prices: Record<number, number>
  onRefresh?: () => Promise<void>
}

function formatIsk(isk: number): string {
  if (isk >= 1_000_000_000) return `${(isk / 1_000_000_000).toFixed(2)}B`
  if (isk >= 1_000_000) return `${(isk / 1_000_000).toFixed(1)}M`
  if (isk >= 1_000) return `${(isk / 1_000).toFixed(0)}K`
  return `${Math.round(isk)}`
}

/** Restrict a character roster to only the planets that feed `terminalTypeId`. */
function filterToChain(
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
  return characters
    .map(c => ({ ...c, planets: c.planets.filter(p => keys.has(`${c.characterId}:${p.planetId}`)) }))
    .filter(c => c.planets.length > 0)
}

export function ChainView({ characters, prices, onRefresh }: Props) {
  const [mode, setMode] = useState<ViewMode>(
    () => (localStorage.getItem('chainView.mode') as ViewMode) ?? 'chains'
  )
  const [focusTypeId, setFocusTypeId] = useState<number | null>(null)

  function go(next: ViewMode) {
    localStorage.setItem('chainView.mode', next)
    setMode(next)
  }

  const model = useMemo(() => buildChainModel(characters, prices), [characters, prices])

  if (characters.length === 0) {
    return <div className={styles.empty}>Set up your characters first to see the production chain.</div>
  }

  // Chain focus — one terminal's upstream graph only.
  if (focusTypeId != null) {
    const terminal = model.terminals.find(t => t.product.typeId === focusTypeId)
    const focused = filterToChain(characters, model, focusTypeId)
    const title = terminal ? (
      <>
        {terminal.product.tier} {terminal.product.name}
        {terminal.price > 0 && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
            {' '}· ≈ {formatIsk(terminal.broken ? terminal.iskHrIntended : terminal.iskHrNow)}/hr
            {terminal.broken ? ' if fixed' : ''}
          </span>
        )}
      </>
    ) : 'Chain'
    return (
      <ChainGraph
        characters={focused}
        prices={prices}
        onRefresh={onRefresh}
        onBack={() => setFocusTypeId(null)}
        backLabel="All chains"
        focusTitle={title}
        suggestionsAllowed={false}
      />
    )
  }

  // Escape hatch — the full combined graph (today's view).
  if (mode === 'graph') {
    return (
      <ChainGraph
        characters={characters}
        prices={prices}
        onRefresh={onRefresh}
        onBack={() => go('chains')}
        backLabel="Chains"
      />
    )
  }

  // Default — ISK-ranked chain-terminal list.
  return (
    <ChainTerminalList
      characters={characters}
      prices={prices}
      onFocusChain={setFocusTypeId}
      onSeeEverything={() => go('graph')}
    />
  )
}
