// Types shared between renderer and preload bridge

export interface PISkillLevels {
  commandCenterUpgrades: number
  interplanetaryConsolidation: number
  remoteSensing: number
  planetology: number
  advancedPlanetology: number
}

export const DEFAULT_PI_SKILLS: PISkillLevels = {
  commandCenterUpgrades: 0,
  interplanetaryConsolidation: 0,
  remoteSensing: 0,
  planetology: 0,
  advancedPlanetology: 0
}

export const MAX_PI_SKILLS: PISkillLevels = {
  commandCenterUpgrades: 5,
  interplanetaryConsolidation: 5,
  remoteSensing: 5,
  planetology: 5,
  advancedPlanetology: 5
}

export const PLANET_TYPES = [
  'temperate', 'barren', 'oceanic', 'ice', 'gas', 'lava', 'storm', 'plasma'
] as const

export type PlanetType = typeof PLANET_TYPES[number]

export interface Planet {
  planetId: number
  esiPlanetId?: number
  systemId?: number
  type: string
  name: string
  outputs: number[]          // type IDs of all products this planet makes
  outputNames?: string[]     // cached names from ESI (parallel array)
  outputTiers?: string[]     // cached tiers from ESI (parallel array)
  ccu?: number
  extractorCount?: number
  factoryCount?: number
  /** Launchpads on the colony, counted in creation order (ascending pin_id) —
      the same order the in-game transfer dropdown lists them. */
  launchpadCount?: number
  /** 0-based position of the launchpad whose routes feed the factories; the pad
      hauled inputs must be transferred to. Unset when ambiguous. */
  launchpadInputIndex?: number
  /** Measured extractor yield from ESI: P0 typeId → units/hr (sum of that
      product's extractor programs). Caps the planet's P1 output estimate. */
  extractionRates?: Record<number, number>
  expiryTime?: string
}

export interface SkillTrainingEntry {
  toLevel: number
  finishDate: string
  startDate?: string
  /** SP the character had when this queue slot began */
  trainingSP?: number
  /** SP required to start this level */
  levelStartSP?: number
  /** SP required to complete this level */
  levelEndSP?: number
}

export interface StoredCharacter {
  characterId: number
  characterName: string
  piSkills: PISkillLevels
  planets: Planet[]
  // keyed by PISkillLevels field name; present if that skill is in the queue
  skillTraining?: Partial<Record<keyof PISkillLevels, SkillTrainingEntry>>
  /** @deprecated use skillTraining.interplanetaryConsolidation */
  icTraining?: SkillTrainingEntry
  /** Locally planned upskill levels — only stored when > real piSkills level */
  skillOverrides?: Partial<Record<keyof PISkillLevels, number>>
}

export interface ExtractorExpiry {
  characterId: number
  characterName: string
  planetId: number
  planetType: string
  expiresAt: Date
  isExpired: boolean
  hoursRemaining: number
}

export interface ProductionSummary {
  characterId: number
  characterName: string
  planetId: number
  planetType: string
  extracts: number[]
  produces: number[]
}

export interface GapItem {
  typeId: number
  typeName: string
  tier: string
  neededBy: { typeId: number; name: string }[]
  producedBy: { characterId: number; characterName: string; planetId: number }[]
}

export interface HaulTask {
  typeId: number
  typeName: string
  fromCharacterId: number
  fromCharacterName: string
  fromPlanetId: number
  toCharacterId: number
  toCharacterName: string
  toPlanetId: number
}

declare global {
  interface Window {
    api: {
      getCharacters: () => Promise<StoredCharacter[]>
      addCharacter: () => Promise<StoredCharacter>
      removeCharacter: (characterId: number) => Promise<boolean>
      renameCharacter: (characterId: number, name: string) => Promise<boolean>
      updatePISkills: (characterId: number, skills: PISkillLevels) => Promise<boolean>
      setSkillOverrides: (characterId: number, overrides: Partial<Record<keyof PISkillLevels, number>>) => Promise<StoredCharacter | null>
      clearSkillOverrides: (characterId: number) => Promise<StoredCharacter | null>
      removePlanet: (characterId: number, planetId: number) => Promise<boolean>
      renamePlanet: (characterId: number, planetId: number, name: string) => Promise<boolean>
      setPlanetOutputs: (characterId: number, planetId: number, typeIds: number[]) => Promise<boolean>
      getSchematic: (schematicId: number) => Promise<unknown>
      getPlanetInfo: (planetId: number) => Promise<{ name: string; planet_id: number; system_id: number; type_id: number }>
      getSystemPlanets: (systemId: number) => Promise<{ planetId: number; category: string }[]>
      getSchematicsBatch: (ids: number[]) => Promise<Record<string, { cycle_time: number; schematic_name: string; pins: { type_id: number; quantity: number; is_input: boolean }[] }>>
      getMarketPrices: (typeIds: number[]) => Promise<Record<number, number>>
      getClientId: () => Promise<string>
      setClientId: (clientId: string) => Promise<boolean>
      importCharacter: (clientId: string) => Promise<StoredCharacter>
      refreshAllCharacters: () => Promise<StoredCharacter[]>
    }
  }
}
