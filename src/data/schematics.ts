// Static PI production chain data.
// TypeIds verified against EVE ESI /universe/types/{id}/ and everef.net group pages.
// Recipes verified against EVE University Planetary Commodities wiki.

export type PITier = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export interface PIProduct {
  typeId: number
  name: string
  tier: PITier
}

export interface PISchematic {
  schematicId: number
  output: { typeId: number; quantity: number }
  inputs: { typeId: number; quantity: number }[]
  cycleTime: number
}

// ── P0 raw resources ──────────────────────────────────────────────────────────
// Verified via everef.net groups 1032 (solid), 1033 (liquid-gas), 1035 (organic)
// + remaining confirmed via ESI type lookups

export const P0_RESOURCES: PIProduct[] = [
  { typeId: 2268, name: 'Aqueous Liquids',   tier: 'P0' },
  { typeId: 2305, name: 'Autotrophs',         tier: 'P0' },
  { typeId: 2267, name: 'Base Metals',        tier: 'P0' },
  { typeId: 2288, name: 'Carbon Compounds',   tier: 'P0' },
  { typeId: 2287, name: 'Complex Organisms',  tier: 'P0' },
  { typeId: 2307, name: 'Felsic Magma',       tier: 'P0' },
  { typeId: 2272, name: 'Heavy Metals',       tier: 'P0' },
  { typeId: 2309, name: 'Ionic Solutions',    tier: 'P0' },
  { typeId: 2073, name: 'Microorganisms',     tier: 'P0' },
  { typeId: 2310, name: 'Noble Gas',          tier: 'P0' },
  { typeId: 2270, name: 'Noble Metals',       tier: 'P0' },
  { typeId: 2306, name: 'Non-CS Crystals',    tier: 'P0' },
  { typeId: 2286, name: 'Planktic Colonies',  tier: 'P0' },
  { typeId: 2311, name: 'Reactive Gas',       tier: 'P0' },
  { typeId: 2308, name: 'Suspended Plasma',   tier: 'P0' },
]

// ── P1 processed materials ────────────────────────────────────────────────────
// Verified via everef.net group 1042 (Basic Commodities - Tier 1)

export const P1_PRODUCTS: PIProduct[] = [
  { typeId: 2393, name: 'Bacteria',           tier: 'P1' },
  { typeId: 2396, name: 'Biofuels',           tier: 'P1' },
  { typeId: 3779, name: 'Biomass',            tier: 'P1' },
  { typeId: 2401, name: 'Chiral Structures',  tier: 'P1' },
  { typeId: 2390, name: 'Electrolytes',       tier: 'P1' },
  { typeId: 2397, name: 'Industrial Fibers',  tier: 'P1' },
  { typeId: 2392, name: 'Oxidizing Compound', tier: 'P1' },
  { typeId: 3683, name: 'Oxygen',             tier: 'P1' },
  { typeId: 2389, name: 'Plasmoids',          tier: 'P1' },
  { typeId: 2399, name: 'Precious Metals',    tier: 'P1' },
  { typeId: 2395, name: 'Proteins',           tier: 'P1' },
  { typeId: 2398, name: 'Reactive Metals',    tier: 'P1' },
  { typeId: 9828, name: 'Silicon',            tier: 'P1' },
  { typeId: 2400, name: 'Toxic Metals',       tier: 'P1' },
  { typeId: 3645, name: 'Water',              tier: 'P1' },
]

// ── P2 refined commodities ────────────────────────────────────────────────────
// Verified via everef.net group 1034 (Refined Commodities - Tier 2)

export const P2_PRODUCTS: PIProduct[] = [
  { typeId: 2329,  name: 'Biocells',                    tier: 'P2' },
  { typeId: 3828,  name: 'Construction Blocks',          tier: 'P2' },
  { typeId: 9836,  name: 'Consumer Electronics',         tier: 'P2' },
  { typeId: 9832,  name: 'Coolant',                      tier: 'P2' },
  { typeId: 44,    name: 'Enriched Uranium',              tier: 'P2' },
  { typeId: 3693,  name: 'Fertilizer',                   tier: 'P2' },
  { typeId: 15317, name: 'Genetically Enhanced Livestock',tier: 'P2' },
  { typeId: 3725,  name: 'Livestock',                    tier: 'P2' },
  { typeId: 3689,  name: 'Mechanical Parts',             tier: 'P2' },
  { typeId: 2327,  name: 'Microfiber Shielding',         tier: 'P2' },
  { typeId: 9842,  name: 'Miniature Electronics',        tier: 'P2' },
  { typeId: 2463,  name: 'Nanites',                      tier: 'P2' },
  { typeId: 2317,  name: 'Oxides',                       tier: 'P2' },
  { typeId: 2321,  name: 'Polyaramids',                  tier: 'P2' },
  { typeId: 3695,  name: 'Polytextiles',                 tier: 'P2' },
  { typeId: 9830,  name: 'Rocket Fuel',                  tier: 'P2' },
  { typeId: 3697,  name: 'Silicate Glass',               tier: 'P2' },
  { typeId: 9838,  name: 'Superconductors',              tier: 'P2' },
  { typeId: 2312,  name: 'Supertensile Plastics',        tier: 'P2' },
  { typeId: 3691,  name: 'Synthetic Oil',                tier: 'P2' },
  { typeId: 2319,  name: 'Test Cultures',                tier: 'P2' },
  { typeId: 9840,  name: 'Transmitter',                  tier: 'P2' },
  { typeId: 3775,  name: 'Viral Agent',                  tier: 'P2' },
  { typeId: 2328,  name: 'Water-Cooled CPU',             tier: 'P2' },
]

// ── P3 specialized commodities ────────────────────────────────────────────────
// Verified via everef.net group 1040 (Specialized Commodities - Tier 3)

export const P3_PRODUCTS: PIProduct[] = [
  { typeId: 2358,  name: 'Biotech Research Reports',     tier: 'P3' },
  { typeId: 2345,  name: 'Camera Drones',                tier: 'P3' },
  { typeId: 2344,  name: 'Condensates',                  tier: 'P3' },
  { typeId: 2367,  name: 'Cryoprotectant Solution',      tier: 'P3' },
  { typeId: 17392, name: 'Data Chips',                   tier: 'P3' },
  { typeId: 2348,  name: 'Gel-Matrix Biopaste',          tier: 'P3' },
  { typeId: 9834,  name: 'Guidance Systems',             tier: 'P3' },
  { typeId: 2366,  name: 'Hazmat Detection Systems',     tier: 'P3' },
  { typeId: 2361,  name: 'Hermetic Membranes',           tier: 'P3' },
  { typeId: 17898, name: 'High-Tech Transmitters',       tier: 'P3' },
  { typeId: 2360,  name: 'Industrial Explosives',        tier: 'P3' },
  { typeId: 2354,  name: 'Neocoms',                      tier: 'P3' },
  { typeId: 2352,  name: 'Nuclear Reactors',             tier: 'P3' },
  { typeId: 9846,  name: 'Planetary Vehicles',           tier: 'P3' },
  { typeId: 9848,  name: 'Robotics',                     tier: 'P3' },
  { typeId: 2351,  name: 'Smartfab Units',               tier: 'P3' },
  { typeId: 2349,  name: 'Supercomputers',               tier: 'P3' },
  { typeId: 2346,  name: 'Synthetic Synapses',           tier: 'P3' },
  { typeId: 12836, name: 'Transcranial Microcontrollers',tier: 'P3' },
  { typeId: 17136, name: 'Ukomi Superconductors',        tier: 'P3' },
  { typeId: 28974, name: 'Vaccines',                     tier: 'P3' },
]

// ── P4 advanced commodities ───────────────────────────────────────────────────
// Verified via everef.net group 1041 (Advanced Commodities - Tier 4)

export const P4_PRODUCTS: PIProduct[] = [
  { typeId: 2867, name: 'Broadcast Node',              tier: 'P4' },
  { typeId: 2868, name: 'Integrity Response Drones',   tier: 'P4' },
  { typeId: 2869, name: 'Nano-Factory',                tier: 'P4' },
  { typeId: 2870, name: 'Organic Mortar Applicators',  tier: 'P4' },
  { typeId: 2871, name: 'Recursive Computing Module',  tier: 'P4' },
  { typeId: 2872, name: 'Self-Harmonizing Power Core', tier: 'P4' },
  { typeId: 2875, name: 'Sterile Conduits',            tier: 'P4' },
  { typeId: 2876, name: 'Wetware Mainframe',           tier: 'P4' },
]

export const ALL_PRODUCTS: PIProduct[] = [
  ...P0_RESOURCES,
  ...P1_PRODUCTS,
  ...P2_PRODUCTS,
  ...P3_PRODUCTS,
  ...P4_PRODUCTS,
]

export const PRODUCT_BY_TYPE_ID = new Map<number, PIProduct>(
  ALL_PRODUCTS.map((p) => [p.typeId, p])
)

export const PRODUCT_BY_NAME = new Map<string, PIProduct>(
  ALL_PRODUCTS.map((p) => [p.name, p])
)

// ── P0 → P1 schematics ────────────────────────────────────────────────────────
// 3000 P0 → 20 P1, 30 min cycle

export const P0_TO_P1_SCHEMATICS: PISchematic[] = [
  { schematicId:  1, output: { typeId: 2393, quantity: 20 }, inputs: [{ typeId: 2073, quantity: 3000 }], cycleTime: 1800 }, // Bacteria        ← Microorganisms
  { schematicId:  2, output: { typeId: 2396, quantity: 20 }, inputs: [{ typeId: 2288, quantity: 3000 }], cycleTime: 1800 }, // Biofuels        ← Carbon Compounds
  { schematicId:  3, output: { typeId: 3779, quantity: 20 }, inputs: [{ typeId: 2286, quantity: 3000 }], cycleTime: 1800 }, // Biomass         ← Planktic Colonies
  { schematicId:  4, output: { typeId: 2401, quantity: 20 }, inputs: [{ typeId: 2306, quantity: 3000 }], cycleTime: 1800 }, // Chiral Structures← Non-CS Crystals
  { schematicId:  5, output: { typeId: 2390, quantity: 20 }, inputs: [{ typeId: 2309, quantity: 3000 }], cycleTime: 1800 }, // Electrolytes    ← Ionic Solutions
  { schematicId:  6, output: { typeId: 2397, quantity: 20 }, inputs: [{ typeId: 2305, quantity: 3000 }], cycleTime: 1800 }, // Industrial Fibers← Autotrophs
  { schematicId:  7, output: { typeId: 2392, quantity: 20 }, inputs: [{ typeId: 2311, quantity: 3000 }], cycleTime: 1800 }, // Oxidizing Compound← Reactive Gas
  { schematicId:  8, output: { typeId: 3683, quantity: 20 }, inputs: [{ typeId: 2310, quantity: 3000 }], cycleTime: 1800 }, // Oxygen          ← Noble Gas
  { schematicId:  9, output: { typeId: 2389, quantity: 20 }, inputs: [{ typeId: 2308, quantity: 3000 }], cycleTime: 1800 }, // Plasmoids       ← Suspended Plasma
  { schematicId: 10, output: { typeId: 2399, quantity: 20 }, inputs: [{ typeId: 2270, quantity: 3000 }], cycleTime: 1800 }, // Precious Metals ← Noble Metals
  { schematicId: 11, output: { typeId: 2395, quantity: 20 }, inputs: [{ typeId: 2287, quantity: 3000 }], cycleTime: 1800 }, // Proteins        ← Complex Organisms
  { schematicId: 12, output: { typeId: 2398, quantity: 20 }, inputs: [{ typeId: 2267, quantity: 3000 }], cycleTime: 1800 }, // Reactive Metals ← Base Metals
  { schematicId: 13, output: { typeId: 9828, quantity: 20 }, inputs: [{ typeId: 2307, quantity: 3000 }], cycleTime: 1800 }, // Silicon         ← Felsic Magma
  { schematicId: 14, output: { typeId: 2400, quantity: 20 }, inputs: [{ typeId: 2272, quantity: 3000 }], cycleTime: 1800 }, // Toxic Metals    ← Heavy Metals
  { schematicId: 15, output: { typeId: 3645, quantity: 20 }, inputs: [{ typeId: 2268, quantity: 3000 }], cycleTime: 1800 }, // Water           ← Aqueous Liquids
]

// ── P1 → P2 schematics ────────────────────────────────────────────────────────
// 40 P1 + 40 P1 → 5 P2, 1 hr cycle

export const P1_TO_P2_SCHEMATICS: PISchematic[] = [
  { schematicId: 16, output: { typeId: 2329,  quantity: 5 }, inputs: [{ typeId: 2399, quantity: 40 }, { typeId: 2396, quantity: 40 }], cycleTime: 3600 }, // Biocells                    ← Precious Metals + Biofuels
  { schematicId: 17, output: { typeId: 3828,  quantity: 5 }, inputs: [{ typeId: 2400, quantity: 40 }, { typeId: 2398, quantity: 40 }], cycleTime: 3600 }, // Construction Blocks         ← Toxic Metals + Reactive Metals
  { schematicId: 18, output: { typeId: 9836,  quantity: 5 }, inputs: [{ typeId: 2401, quantity: 40 }, { typeId: 2400, quantity: 40 }], cycleTime: 3600 }, // Consumer Electronics        ← Chiral Structures + Toxic Metals
  { schematicId: 19, output: { typeId: 9832,  quantity: 5 }, inputs: [{ typeId: 3645, quantity: 40 }, { typeId: 2390, quantity: 40 }], cycleTime: 3600 }, // Coolant                     ← Water + Electrolytes
  { schematicId: 20, output: { typeId: 44,    quantity: 5 }, inputs: [{ typeId: 2400, quantity: 40 }, { typeId: 2399, quantity: 40 }], cycleTime: 3600 }, // Enriched Uranium            ← Toxic Metals + Precious Metals
  { schematicId: 21, output: { typeId: 3693,  quantity: 5 }, inputs: [{ typeId: 2395, quantity: 40 }, { typeId: 2393, quantity: 40 }], cycleTime: 3600 }, // Fertilizer                  ← Proteins + Bacteria
  { schematicId: 22, output: { typeId: 15317, quantity: 5 }, inputs: [{ typeId: 3779, quantity: 40 }, { typeId: 2395, quantity: 40 }], cycleTime: 3600 }, // Genetically Enhanced Livestock← Biomass + Proteins
  { schematicId: 23, output: { typeId: 3725,  quantity: 5 }, inputs: [{ typeId: 2396, quantity: 40 }, { typeId: 2395, quantity: 40 }], cycleTime: 3600 }, // Livestock                   ← Biofuels + Proteins
  { schematicId: 24, output: { typeId: 3689,  quantity: 5 }, inputs: [{ typeId: 2399, quantity: 40 }, { typeId: 2398, quantity: 40 }], cycleTime: 3600 }, // Mechanical Parts            ← Precious Metals + Reactive Metals
  { schematicId: 25, output: { typeId: 2327,  quantity: 5 }, inputs: [{ typeId: 9828, quantity: 40 }, { typeId: 2397, quantity: 40 }], cycleTime: 3600 }, // Microfiber Shielding        ← Silicon + Industrial Fibers
  { schematicId: 26, output: { typeId: 9842,  quantity: 5 }, inputs: [{ typeId: 9828, quantity: 40 }, { typeId: 2401, quantity: 40 }], cycleTime: 3600 }, // Miniature Electronics       ← Silicon + Chiral Structures
  { schematicId: 27, output: { typeId: 2463,  quantity: 5 }, inputs: [{ typeId: 2398, quantity: 40 }, { typeId: 2393, quantity: 40 }], cycleTime: 3600 }, // Nanites                     ← Reactive Metals + Bacteria
  { schematicId: 28, output: { typeId: 2317,  quantity: 5 }, inputs: [{ typeId: 3683, quantity: 40 }, { typeId: 2392, quantity: 40 }], cycleTime: 3600 }, // Oxides                      ← Oxygen + Oxidizing Compound
  { schematicId: 29, output: { typeId: 2321,  quantity: 5 }, inputs: [{ typeId: 2397, quantity: 40 }, { typeId: 2392, quantity: 40 }], cycleTime: 3600 }, // Polyaramids                 ← Industrial Fibers + Oxidizing Compound
  { schematicId: 30, output: { typeId: 3695,  quantity: 5 }, inputs: [{ typeId: 2397, quantity: 40 }, { typeId: 2396, quantity: 40 }], cycleTime: 3600 }, // Polytextiles                ← Industrial Fibers + Biofuels
  { schematicId: 31, output: { typeId: 9830,  quantity: 5 }, inputs: [{ typeId: 2390, quantity: 40 }, { typeId: 2389, quantity: 40 }], cycleTime: 3600 }, // Rocket Fuel                 ← Electrolytes + Plasmoids
  { schematicId: 32, output: { typeId: 3697,  quantity: 5 }, inputs: [{ typeId: 9828, quantity: 40 }, { typeId: 2392, quantity: 40 }], cycleTime: 3600 }, // Silicate Glass              ← Silicon + Oxidizing Compound
  { schematicId: 33, output: { typeId: 9838,  quantity: 5 }, inputs: [{ typeId: 3645, quantity: 40 }, { typeId: 2389, quantity: 40 }], cycleTime: 3600 }, // Superconductors             ← Water + Plasmoids
  { schematicId: 34, output: { typeId: 2312,  quantity: 5 }, inputs: [{ typeId: 3779, quantity: 40 }, { typeId: 3683, quantity: 40 }], cycleTime: 3600 }, // Supertensile Plastics       ← Biomass + Oxygen
  { schematicId: 35, output: { typeId: 3691,  quantity: 5 }, inputs: [{ typeId: 3683, quantity: 40 }, { typeId: 2390, quantity: 40 }], cycleTime: 3600 }, // Synthetic Oil               ← Oxygen + Electrolytes
  { schematicId: 36, output: { typeId: 2319,  quantity: 5 }, inputs: [{ typeId: 3645, quantity: 40 }, { typeId: 2393, quantity: 40 }], cycleTime: 3600 }, // Test Cultures               ← Water + Bacteria
  { schematicId: 37, output: { typeId: 9840,  quantity: 5 }, inputs: [{ typeId: 2401, quantity: 40 }, { typeId: 2389, quantity: 40 }], cycleTime: 3600 }, // Transmitter                 ← Chiral Structures + Plasmoids
  { schematicId: 38, output: { typeId: 3775,  quantity: 5 }, inputs: [{ typeId: 3779, quantity: 40 }, { typeId: 2393, quantity: 40 }], cycleTime: 3600 }, // Viral Agent                 ← Biomass + Bacteria
  { schematicId: 39, output: { typeId: 2328,  quantity: 5 }, inputs: [{ typeId: 3645, quantity: 40 }, { typeId: 2398, quantity: 40 }], cycleTime: 3600 }, // Water-Cooled CPU            ← Water + Reactive Metals
]

// ── P2 → P3 schematics ────────────────────────────────────────────────────────
// 10 P2 (×2 or ×3) → 3 P3, 1 hr cycle

export const P2_TO_P3_SCHEMATICS: PISchematic[] = [
  { schematicId: 40, output: { typeId: 2358,  quantity: 3 }, inputs: [{ typeId: 2463, quantity: 10 }, { typeId: 3725, quantity: 10 }, { typeId: 3828, quantity: 10 }], cycleTime: 3600 }, // Biotech Research Reports     ← Nanites + Livestock + Construction Blocks
  { schematicId: 41, output: { typeId: 2345,  quantity: 3 }, inputs: [{ typeId: 3697, quantity: 10 }, { typeId: 9830, quantity: 10 }], cycleTime: 3600 },                                  // Camera Drones                ← Silicate Glass + Rocket Fuel
  { schematicId: 42, output: { typeId: 2344,  quantity: 3 }, inputs: [{ typeId: 2317, quantity: 10 }, { typeId: 9832, quantity: 10 }], cycleTime: 3600 },                                  // Condensates                  ← Oxides + Coolant
  { schematicId: 43, output: { typeId: 2367,  quantity: 3 }, inputs: [{ typeId: 2319, quantity: 10 }, { typeId: 3691, quantity: 10 }, { typeId: 3693, quantity: 10 }], cycleTime: 3600 }, // Cryoprotectant Solution      ← Test Cultures + Synthetic Oil + Fertilizer
  { schematicId: 44, output: { typeId: 17392, quantity: 3 }, inputs: [{ typeId: 2312, quantity: 10 }, { typeId: 2327, quantity: 10 }], cycleTime: 3600 },                                  // Data Chips                   ← Supertensile Plastics + Microfiber Shielding
  { schematicId: 45, output: { typeId: 2348,  quantity: 3 }, inputs: [{ typeId: 2317, quantity: 10 }, { typeId: 2329, quantity: 10 }, { typeId: 9838, quantity: 10 }], cycleTime: 3600 }, // Gel-Matrix Biopaste          ← Oxides + Biocells + Superconductors
  { schematicId: 46, output: { typeId: 9834,  quantity: 3 }, inputs: [{ typeId: 2328, quantity: 10 }, { typeId: 9840, quantity: 10 }], cycleTime: 3600 },                                  // Guidance Systems             ← Water-Cooled CPU + Transmitter
  { schematicId: 47, output: { typeId: 2366,  quantity: 3 }, inputs: [{ typeId: 3695, quantity: 10 }, { typeId: 3775, quantity: 10 }, { typeId: 9840, quantity: 10 }], cycleTime: 3600 }, // Hazmat Detection Systems     ← Polytextiles + Viral Agent + Transmitter
  { schematicId: 48, output: { typeId: 2361,  quantity: 3 }, inputs: [{ typeId: 2321, quantity: 10 }, { typeId: 15317, quantity: 10 }], cycleTime: 3600 },                                 // Hermetic Membranes           ← Polyaramids + Genetically Enhanced Livestock
  { schematicId: 49, output: { typeId: 17898, quantity: 3 }, inputs: [{ typeId: 2321, quantity: 10 }, { typeId: 9840, quantity: 10 }], cycleTime: 3600 },                                  // High-Tech Transmitters       ← Polyaramids + Transmitter
  { schematicId: 50, output: { typeId: 2360,  quantity: 3 }, inputs: [{ typeId: 3693, quantity: 10 }, { typeId: 3695, quantity: 10 }], cycleTime: 3600 },                                  // Industrial Explosives        ← Fertilizer + Polytextiles
  { schematicId: 51, output: { typeId: 2354,  quantity: 3 }, inputs: [{ typeId: 2329, quantity: 10 }, { typeId: 3697, quantity: 10 }], cycleTime: 3600 },                                  // Neocoms                      ← Biocells + Silicate Glass
  { schematicId: 52, output: { typeId: 2352,  quantity: 3 }, inputs: [{ typeId: 2327, quantity: 10 }, { typeId: 44,   quantity: 10 }], cycleTime: 3600 },                                  // Nuclear Reactors             ← Microfiber Shielding + Enriched Uranium
  { schematicId: 53, output: { typeId: 9846,  quantity: 3 }, inputs: [{ typeId: 2312, quantity: 10 }, { typeId: 3689, quantity: 10 }, { typeId: 9842, quantity: 10 }], cycleTime: 3600 }, // Planetary Vehicles           ← Supertensile Plastics + Mechanical Parts + Miniature Electronics
  { schematicId: 54, output: { typeId: 9848,  quantity: 3 }, inputs: [{ typeId: 3689, quantity: 10 }, { typeId: 9836, quantity: 10 }], cycleTime: 3600 },                                  // Robotics                     ← Mechanical Parts + Consumer Electronics
  { schematicId: 55, output: { typeId: 2351,  quantity: 3 }, inputs: [{ typeId: 3828, quantity: 10 }, { typeId: 9842, quantity: 10 }], cycleTime: 3600 },                                  // Smartfab Units               ← Construction Blocks + Miniature Electronics
  { schematicId: 56, output: { typeId: 2349,  quantity: 3 }, inputs: [{ typeId: 2328, quantity: 10 }, { typeId: 9832, quantity: 10 }, { typeId: 9836, quantity: 10 }], cycleTime: 3600 }, // Supercomputers               ← Water-Cooled CPU + Coolant + Consumer Electronics
  { schematicId: 57, output: { typeId: 2346,  quantity: 3 }, inputs: [{ typeId: 2312, quantity: 10 }, { typeId: 2319, quantity: 10 }], cycleTime: 3600 },                                  // Synthetic Synapses           ← Supertensile Plastics + Test Cultures
  { schematicId: 58, output: { typeId: 12836, quantity: 3 }, inputs: [{ typeId: 2329, quantity: 10 }, { typeId: 2463, quantity: 10 }], cycleTime: 3600 },                                  // Transcranial Microcontrollers← Biocells + Nanites
  { schematicId: 59, output: { typeId: 17136, quantity: 3 }, inputs: [{ typeId: 3691, quantity: 10 }, { typeId: 9838, quantity: 10 }], cycleTime: 3600 },                                  // Ukomi Superconductors        ← Synthetic Oil + Superconductors
  { schematicId: 60, output: { typeId: 28974, quantity: 3 }, inputs: [{ typeId: 3725, quantity: 10 }, { typeId: 3775, quantity: 10 }], cycleTime: 3600 },                                  // Vaccines                     ← Livestock + Viral Agent
]

// ── P3 → P4 schematics ────────────────────────────────────────────────────────
// 6 P3 (×2 or ×3, mixed with P1) → 1 P4, 1 hr cycle

export const P3_TO_P4_SCHEMATICS: PISchematic[] = [
  { schematicId: 61, output: { typeId: 2867, quantity: 1 }, inputs: [{ typeId: 2354,  quantity: 6 }, { typeId: 17392, quantity: 6 }, { typeId: 17898, quantity: 6 }], cycleTime: 3600 }, // Broadcast Node              ← Neocoms + Data Chips + High-Tech Transmitters
  { schematicId: 62, output: { typeId: 2868, quantity: 1 }, inputs: [{ typeId: 2348,  quantity: 6 }, { typeId: 2366,  quantity: 6 }, { typeId: 9846,  quantity: 6 }], cycleTime: 3600 }, // Integrity Response Drones   ← Gel-Matrix Biopaste + Hazmat Detection Systems + Planetary Vehicles
  { schematicId: 63, output: { typeId: 2869, quantity: 1 }, inputs: [{ typeId: 2360,  quantity: 6 }, { typeId: 17136, quantity: 6 }, { typeId: 2398,  quantity: 40 }], cycleTime: 3600 }, // Nano-Factory               ← Industrial Explosives + Ukomi Superconductors + Reactive Metals (P1)
  { schematicId: 64, output: { typeId: 2870, quantity: 1 }, inputs: [{ typeId: 2344,  quantity: 6 }, { typeId: 9848,  quantity: 6 }, { typeId: 2393,  quantity: 40 }], cycleTime: 3600 }, // Organic Mortar Applicators ← Condensates + Robotics + Bacteria (P1)
  { schematicId: 65, output: { typeId: 2871, quantity: 1 }, inputs: [{ typeId: 2346,  quantity: 6 }, { typeId: 9834,  quantity: 6 }, { typeId: 12836, quantity: 6 }], cycleTime: 3600 }, // Recursive Computing Module  ← Synthetic Synapses + Guidance Systems + Transcranial Microcontrollers
  { schematicId: 66, output: { typeId: 2872, quantity: 1 }, inputs: [{ typeId: 2345,  quantity: 6 }, { typeId: 2352,  quantity: 6 }, { typeId: 2361,  quantity: 6 }], cycleTime: 3600 }, // Self-Harmonizing Power Core ← Camera Drones + Nuclear Reactors + Hermetic Membranes
  { schematicId: 67, output: { typeId: 2875, quantity: 1 }, inputs: [{ typeId: 2351,  quantity: 6 }, { typeId: 28974, quantity: 6 }, { typeId: 3645,  quantity: 40 }], cycleTime: 3600 }, // Sterile Conduits           ← Smartfab Units + Vaccines + Water (P1)
  { schematicId: 68, output: { typeId: 2876, quantity: 1 }, inputs: [{ typeId: 2349,  quantity: 6 }, { typeId: 2358,  quantity: 6 }, { typeId: 2367,  quantity: 6 }], cycleTime: 3600 }, // Wetware Mainframe           ← Supercomputers + Biotech Research Reports + Cryoprotectant Solution
]

export const ALL_SCHEMATICS: PISchematic[] = [
  ...P0_TO_P1_SCHEMATICS,
  ...P1_TO_P2_SCHEMATICS,
  ...P2_TO_P3_SCHEMATICS,
  ...P3_TO_P4_SCHEMATICS,
]

export const SCHEMATIC_BY_OUTPUT = new Map<number, PISchematic>(
  ALL_SCHEMATICS.map((s) => [s.output.typeId, s])
)

export const SCHEMATIC_INPUTS_BY_NAME = new Map<string, string[]>(
  ALL_SCHEMATICS.map((s) => {
    const outputName = PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name ?? ''
    const inputNames = s.inputs.map((i) => PRODUCT_BY_TYPE_ID.get(i.typeId)?.name).filter(Boolean) as string[]
    return [outputName, inputNames] as [string, string[]]
  }).filter(([name]) => name !== '')
)

// ── Planet → P0 resource map ──────────────────────────────────────────────────
// Verified via EVE University Planetary Commodities wiki

export const PLANET_RESOURCES: Record<string, number[]> = {
  temperate: [2073, 2288, 2305, 2287, 2268],          // Microorganisms, Carbon Compounds, Autotrophs, Complex Organisms, Aqueous Liquids
  barren:    [2073, 2288, 2306, 2267, 2270, 2272, 2268], // + Non-CS Crystals, Base Metals, Noble Metals, Heavy Metals
  oceanic:   [2073, 2288, 2286, 2287, 2268],           // Microorganisms, Carbon Compounds, Planktic Colonies, Complex Organisms, Aqueous Liquids
  ice:       [2073, 2286, 2310, 2272, 2268],           // Microorganisms, Planktic Colonies, Noble Gas, Heavy Metals, Aqueous Liquids
  gas:       [2309, 2311, 2310, 2267, 2268],           // Ionic Solutions, Reactive Gas, Noble Gas, Base Metals, Aqueous Liquids
  lava:      [2306, 2307, 2267, 2272, 2308],           // Non-CS Crystals, Felsic Magma, Base Metals, Heavy Metals, Suspended Plasma
  storm:     [2309, 2310, 2267, 2308, 2268],           // Ionic Solutions, Noble Gas, Base Metals, Suspended Plasma, Aqueous Liquids
  plasma:    [2306, 2267, 2270, 2308],                 // Non-CS Crystals, Base Metals, Noble Metals, Suspended Plasma
}
