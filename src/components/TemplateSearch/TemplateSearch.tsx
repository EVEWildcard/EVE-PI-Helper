import React, { useState, useRef, useEffect } from 'react'
import { ALL_PRODUCTS } from '../../data/schematics'
import type { PIProduct } from '../../data/schematics'
import styles from './TemplateSearch.module.css'

const TEMPLATE_BASE = 'https://raw.githubusercontent.com/DalShooth/EVE_PI_Templates/8b141a8a321005bc18e1eb31645ce316f016fbd7/PlanetaryInteractionTemplates'
const FILENAME_FIXES: Record<string, string> = { 'Chiral Structures': 'Chiral Stuctures' }

function templateUrl(role: 'factory' | 'miner', name: string) {
  const fixed = FILENAME_FIXES[name] ?? name
  const prefix = role === 'factory' ? 'Factory' : 'Miner - 00'
  return `${TEMPLATE_BASE}/${encodeURIComponent(`${prefix} - ${fixed}.json`)}`
}

const TIER_COLOR: Record<string, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}

const FAB_HINT =
  'Search a PI product and copy a ready-made setup to your clipboard, then paste it into the in-game Planetary Interaction screen. “Mine” = a P1 extractor layout, “Factory” = a P2+ factory layout.'

type CopyState = 'idle' | 'copying' | 'copied' | 'error'

export function TemplateSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else setQuery('')
  }, [open])

  const results: PIProduct[] = query.trim().length < 1 ? [] :
    ALL_PRODUCTS.filter(p => p.tier !== 'P0' && p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12)

  async function copy(key: string, url: string) {
    setCopyStates(s => ({ ...s, [key]: 'copying' }))
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      await navigator.clipboard.writeText(await res.text())
      setCopyStates(s => ({ ...s, [key]: 'copied' }))
      setTimeout(() => setCopyStates(s => ({ ...s, [key]: 'idle' })), 2000)
    } catch {
      setCopyStates(s => ({ ...s, [key]: 'error' }))
      setTimeout(() => setCopyStates(s => ({ ...s, [key]: 'idle' })), 2000)
    }
  }

  return (
    <div className={styles.root}>
      {open && (
        <div className={styles.panel}>
          <div className={styles.searchRow}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className={styles.searchIcon}>
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M9.5 9.5 L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              className={styles.searchInput}
              placeholder="Search templates…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className={styles.clearBtn} onClick={() => setQuery('')}>✕</button>
            )}
          </div>
          {results.length > 0 && (
            <div className={styles.results}>
              {results.map(p => {
                const isP1 = p.tier === 'P1'
                const minerKey = `miner:${p.name}`
                const factKey = `factory:${p.name}`
                const mc = copyStates[minerKey] ?? 'idle'
                const fc = copyStates[factKey] ?? 'idle'
                return (
                  <div key={p.typeId} className={styles.row}>
                    <span className={styles.tier} style={{ color: TIER_COLOR[p.tier] }}>{p.tier}</span>
                    <span className={styles.name}>{p.name}</span>
                    <div className={styles.btns}>
                      {isP1 ? (
                        <button
                          className={`${styles.btn} ${mc === 'copied' ? styles.btnOk : mc === 'error' ? styles.btnErr : ''}`}
                          disabled={mc === 'copying'}
                          onClick={() => copy(minerKey, templateUrl('miner', p.name))}
                          title="Copy extractor template"
                        >
                          {mc === 'copied' ? '✓' : mc === 'error' ? '✗' : mc === 'copying' ? '…' : 'Mine'}
                        </button>
                      ) : (
                        <button
                          className={`${styles.btn} ${fc === 'copied' ? styles.btnOk : fc === 'error' ? styles.btnErr : ''}`}
                          disabled={fc === 'copying'}
                          onClick={() => copy(factKey, templateUrl('factory', p.name))}
                          title="Copy factory template"
                        >
                          {fc === 'copied' ? '✓' : fc === 'error' ? '✗' : fc === 'copying' ? '…' : 'Factory'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {query.trim().length > 0 && results.length === 0 && (
            <div className={styles.empty}>No products match</div>
          )}
        </div>
      )}
      <div className={styles.fabWrap} title={FAB_HINT}>
        <button
          className={`${styles.fab} ${open ? styles.fabOpen : ''}`}
          onClick={() => setOpen(v => !v)}
          aria-label={FAB_HINT}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="2" y="7.25" width="8" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="2" y="11.5" width="5" height="1.5" rx="0.75" fill="currentColor"/>
            <circle cx="12.5" cy="11.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M14.2 13.2 L15.5 14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
        <span className={styles.fabLabel}>Copy PI templates</span>
      </div>
    </div>
  )
}
