// Static PI planet resource data. Source: EVE University Planetary Resources wiki.

// Planet category → command center item name (for buying at market)
export const CATEGORY_COMMAND_CENTER: Record<string, string> = {
  temperate: 'Temperate Command Center',
  barren:    'Barren Command Center',
  oceanic:   'Oceanic Command Center',
  ice:       'Ice Command Center',
  gas:       'Gas Command Center',
  lava:      'Lava Command Center',
  storm:     'Storm Command Center',
  plasma:    'Plasma Command Center',
}

// Planet body type IDs (from EVE SDE invTypes, groupId=7) → category string
// These match the type_id returned by ESI GET /universe/planets/{id}/
export const PLANET_BODY_TYPE_TO_CATEGORY: Record<number, string> = {
  11: 'temperate',
  12: 'ice',
  13: 'gas',
  2014: 'oceanic',
  2015: 'lava',
  2016: 'barren',
  2017: 'storm',
  2063: 'plasma',
}

// P0 resource names harvestable per planet type
export const PLANET_TYPE_P0: Record<string, string[]> = {
  temperate: ['Aqueous Liquids', 'Autotrophs', 'Carbon Compounds', 'Complex Organisms', 'Microorganisms'],
  barren:    ['Base Metals', 'Carbon Compounds', 'Microorganisms', 'Non-CS Crystals', 'Suspended Plasma'],
  oceanic:   ['Aqueous Liquids', 'Complex Organisms', 'Ionic Solutions', 'Microorganisms', 'Planktic Colonies'],
  ice:       ['Aqueous Liquids', 'Base Metals', 'Heavy Metals', 'Microorganisms', 'Noble Gas'],
  gas:       ['Aqueous Liquids', 'Base Metals', 'Ionic Solutions', 'Noble Gas', 'Reactive Gas'],
  lava:      ['Base Metals', 'Felsic Magma', 'Heavy Metals', 'Non-CS Crystals', 'Suspended Plasma'],
  storm:     ['Aqueous Liquids', 'Base Metals', 'Ionic Solutions', 'Noble Gas', 'Suspended Plasma'],
  plasma:    ['Base Metals', 'Felsic Magma', 'Heavy Metals', 'Non-CS Crystals', 'Suspended Plasma'],
}

// P0 resource name → P1 product name it extracts into
export const P0_TO_P1: Record<string, string> = {
  'Microorganisms':    'Bacteria',
  'Carbon Compounds':  'Biofuels',
  'Planktic Colonies': 'Biomass',
  'Non-CS Crystals':   'Chiral Structures',
  'Ionic Solutions':   'Electrolytes',
  'Autotrophs':        'Industrial Fibers',
  'Reactive Gas':      'Oxidizing Compound',
  'Noble Gas':         'Oxygen',
  'Suspended Plasma':  'Plasmoids',
  'Noble Metals':      'Precious Metals',
  'Complex Organisms': 'Proteins',
  'Base Metals':       'Reactive Metals',
  'Felsic Magma':      'Silicon',
  'Heavy Metals':      'Toxic Metals',
  'Aqueous Liquids':   'Water',
}

// Derived: P1 name → P0 resource it comes from
export const P1_TO_P0: Record<string, string> = {}
for (const [p0, p1] of Object.entries(P0_TO_P1)) P1_TO_P0[p1] = p0

// Derived: P1 name → planet category that can extract it
export const P1_TO_PLANET_CATEGORIES: Record<string, string[]> = {}
for (const [cat, p0list] of Object.entries(PLANET_TYPE_P0)) {
  for (const p0 of p0list) {
    const p1 = P0_TO_P1[p0]
    if (p1) {
      if (!P1_TO_PLANET_CATEGORIES[p1]) P1_TO_PLANET_CATEGORIES[p1] = []
      if (!P1_TO_PLANET_CATEGORIES[p1].includes(cat)) P1_TO_PLANET_CATEGORIES[p1].push(cat)
    }
  }
}
