import React from 'react'
import type { PISkillLevels } from '../../types/api'

export interface SkillMeta {
  key: keyof PISkillLevels
  name: string
  description: string
  levelLabels: string[]
  icon: React.ReactNode
}

export const PI_SKILLS: SkillMeta[] = [
  {
    key: 'interplanetaryConsolidation',
    name: 'Interplanetary Consolidation',
    description: 'Each level lets you manage one additional planet, up to 6 at level V.',
    levelLabels: ['Not trained', '2 planets', '3 planets', '4 planets', '5 planets', '6 planets'],
    icon: (
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
        <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
        <ellipse cx="5.5" cy="5.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      </svg>
    ),
  },
  {
    key: 'commandCenterUpgrades',
    name: 'Command Center Upgrades',
    description: "Sets your command center's CPU & powergrid — limits how many facilities and which tiers you can run.",
    levelLabels: ['Not trained', 'Extractors only', 'Basic factories', 'Standard factories', 'Advanced factories', 'Unrestricted'],
    icon: (
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
        <path d="M6.5 1.5 L4 6h3L4.5 10 L9 4.5H6L8 1.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
  },
  {
    key: 'remoteSensing',
    name: 'Remote Sensing',
    description: 'Lets you survey planets without traveling to them — range scales with skill level.',
    levelLabels: ['Same system only', '1 jump', '3 jumps', '5 jumps', '7 jumps', '9 jumps'],
    icon: (
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
        <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/>
        <path d="M3 3 Q5.5 1 8 3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <path d="M1.5 1.5 Q5.5 -1 9.5 1.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5"/>
        <path d="M3 8 Q5.5 10 8 8" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <path d="M1.5 9.5 Q5.5 12 9.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5"/>
      </svg>
    ),
  },
  {
    key: 'planetology',
    name: 'Planetology',
    description: 'Improves resource scan accuracy — better hotspot locations mean more efficient extractor placement.',
    levelLabels: ['Not trained', 'Rough accuracy', 'Basic accuracy', 'Good accuracy', 'High accuracy', 'Max accuracy'],
    icon: (
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
        <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="6.8" y1="6.8" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <line x1="4.5" y1="2.5" x2="4.5" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
        <line x1="2.5" y1="4.5" x2="6.5" y2="4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
      </svg>
    ),
  },
  {
    key: 'advancedPlanetology',
    name: 'Advanced Planetology',
    description: 'Further refines survey accuracy beyond Planetology — requires Planetology IV.',
    levelLabels: ['Not trained', 'Minor boost', 'Moderate boost', 'Notable boost', 'Expert accuracy', 'Perfect scans'],
    icon: (
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
        <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="6.8" y1="6.8" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <line x1="4.5" y1="2.5" x2="4.5" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
        <line x1="2.5" y1="4.5" x2="6.5" y2="4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
        <circle cx="4.5" cy="4.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
]
