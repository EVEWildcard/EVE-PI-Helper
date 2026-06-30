import { useMemo } from 'react'
import type { StoredCharacter, Planet } from '../types/api'
import {
  PRODUCT_BY_TYPE_ID, PRODUCT_BY_NAME, SCHEMATIC_INPUTS_BY_NAME,
  P1_TO_P2_SCHEMATICS, P2_TO_P3_SCHEMATICS, P3_TO_P4_SCHEMATICS,
} from '../data/schematics'
import type { PIProduct, PISchematic } from '../data/schematics'
import { P1_TO_PLANET_CATEGORIES, P1_TO_P0, CATEGORY_COMMAND_CENTER } from '../data/planetResources'
import type { SystemPlanetsMap } from './useSystemPlanets'

export type SuggestionInputStatus = 'available' | 'needsFactory' | 'needsExtractor' | 'unavailable'

export interface SuggestionInput {
  name: string
  status: SuggestionInputStatus
  slotsNeeded: number
}

export interface RepurposeInfo {
  planet: Planet
  characterName: string
  currentOutputNames: string[]
}

// A single planet to add as part of the plan
export interface ChainStep {
  role: 'extractor' | 'factory'
  planetCategory: string        // e.g. 'barren'
  characterName: string
  characterId: number
  systemId?: number             // preferred system (where char already operates)
  produces: string              // P1 for extractors, P2/P3/P4 for factories
  extractsP0?: string           // only for extractors
  factoryInputs?: string[]      // only for factories
  commandCenter: string         // item name to buy
}

export interface BlockedInfo {
  extraSlotsNeeded: number
  // Approximate training time to unlock enough slots (Interplanetary Consolidation)
  trainFromLevel: number
  trainToLevel: number
  trainTimeHours: number        // rough estimate
}

export interface ChainSuggestion {
  key: string
  product: PIProduct
  schematic?: PISchematic
  inputs: SuggestionInput[]
  characterName: string
  characterId: number
  slotsNeeded: number
  slotsAvailable: number
  iskHr: number
  chainSteps: ChainStep[]       // full ordered plan: extractors first, then factories
  repurposes?: RepurposeInfo
  blocked?: BlockedInfo         // present when current skills are insufficient
  /** When this suggestion is a prerequisite step, this is the end-goal product it unlocks */
  prereqFor?: PIProduct
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FACTORY_COUNT_ESTIMATE = 5
const MAX_SLOTS_TO_SUGGEST = 6
const TIER_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }

// Interplanetary Consolidation: max planets = 1 + skill level (up to level 5 → 6 planets)
// Approximate training hours per level (Omega, typical ~2700 SP/hr, multiplier 3)
const IC_TRAIN_HOURS: Record<number, number> = {
  1: 0.1,   // L0→L1: ~6 min
  2: 0.5,   // L1→L2: ~30 min
  3: 3,     // L2→L3: ~3 hr
  4: 16,    // L3→L4: ~16 hr
  5: 90,    // L4→L5: ~4 days
}

function formatTrainTime(hours: number): string {
  if (hours < 1) return `~${Math.round(hours * 60)}m`
  if (hours < 24) return `~${Math.round(hours)}h`
  return `~${Math.round(hours / 24)}d`
}

// ── Recursive input evaluator ─────────────────────────────────────────────────

function evalInput(
  name: string,
  produced: Set<string>,
  charAvailableCategories: Map<number, Map<string, number>>,
  charsWithSlots: { char: StoredCharacter; slots: number }[],
  depth = 0
): SuggestionInput {
  if (produced.has(name)) return { name, status: 'available', slotsNeeded: 0 }

  const product = PRODUCT_BY_NAME.get(name)
  const tier = product?.tier ?? 'P1'

  if (tier === 'P1') {
    const cats = P1_TO_PLANET_CATEGORIES[name] ?? []
    const extractable = charsWithSlots.some(({ char }) => {
      const avail = charAvailableCategories.get(char.characterId)
      return avail && cats.some(cat => (avail.get(cat) ?? 0) > 0)
    })
    return { name, status: extractable ? 'needsExtractor' : 'unavailable', slotsNeeded: extractable ? 1 : 0 }
  }

  if (depth >= 3) return { name, status: 'unavailable', slotsNeeded: 0 }

  const subInputNames = SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []
  const subEvals = subInputNames.map(n => evalInput(n, produced, charAvailableCategories, charsWithSlots, depth + 1))

  if (subEvals.some(s => s.status === 'unavailable')) {
    return { name, status: 'unavailable', slotsNeeded: 0 }
  }

  const allAvailable = subEvals.every(s => s.status === 'available')
  const totalSubSlots = subEvals.reduce((s, e) => s + e.slotsNeeded, 0)

  return {
    name,
    status: allAvailable ? 'needsFactory' : 'needsExtractor',
    slotsNeeded: 1 + totalSubSlots,
  }
}

// ── Full chain step builder ───────────────────────────────────────────────────
// Walks the schematic tree and emits a ChainStep for every planet that needs to be added.
// Returns steps in dependency order (extractors → lower factories → final factory).

function buildChainSteps(
  productName: string,
  produced: Set<string>,
  charAvailableCategories: Map<number, Map<string, number>>,
  charsWithSlots: { char: StoredCharacter; slots: number }[],
  characters: StoredCharacter[],
  allSchematics: typeof P1_TO_P2_SCHEMATICS,
): ChainStep[] {
  const steps: ChainStep[] = []

  function walk(name: string) {
    if (produced.has(name)) return

    const product = PRODUCT_BY_NAME.get(name)
    const tier = product?.tier ?? 'P1'

    if (tier === 'P1') {
      // Need an extractor planet for this P1
      const cats = P1_TO_PLANET_CATEGORIES[name] ?? []
      const p0 = P1_TO_P0[name]

      // Find best character + system: prefer char who already has planets in a system
      // that has the right planet type available
      let bestChar = charsWithSlots[0]?.char
      let bestSystemId: number | undefined
      for (const { char } of charsWithSlots) {
        const avail = charAvailableCategories.get(char.characterId)
        if (!avail) continue
        const hasCat = cats.some(cat => (avail.get(cat) ?? 0) > 0)
        if (!hasCat) continue
        bestChar = char
        // Pick the first system of this char that has an available matching planet
        for (const planet of char.planets) {
          if (!planet.systemId) continue
          // avail already accounts for occupied planets, so just pick the char's primary system
          bestSystemId = planet.systemId
          break
        }
        break
      }

      const cat = cats.find(c => {
        if (!bestChar) return false
        const avail = charAvailableCategories.get(bestChar.characterId)
        return avail && (avail.get(c) ?? 0) > 0
      }) ?? cats[0] ?? 'barren'

      steps.push({
        role: 'extractor',
        planetCategory: cat,
        characterName: bestChar?.characterName ?? '?',
        characterId: bestChar?.characterId ?? 0,
        systemId: bestSystemId,
        produces: name,
        extractsP0: p0,
        commandCenter: CATEGORY_COMMAND_CENTER[cat] ?? `${cat} Command Center`,
      })
      return
    }

    // Factory tier — recurse into inputs first
    const sch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === name)
    if (!sch) return

    const inputNames = sch.inputs.map(i => PRODUCT_BY_TYPE_ID.get(i.typeId)?.name ?? '')
    for (const inp of inputNames) if (inp) walk(inp)

    // Then emit the factory step
    const bestChar = charsWithSlots[0]?.char ?? characters[0]
    steps.push({
      role: 'factory',
      planetCategory: 'barren',   // factories work on any planet type
      characterName: bestChar?.characterName ?? '?',
      characterId: bestChar?.characterId ?? 0,
      produces: name,
      factoryInputs: inputNames.filter(Boolean),
      commandCenter: 'Barren Command Center',
    })
  }

  walk(productName)
  return steps
}

// ── Main hook ─────────────────────────────────────────────────────────────────

// Pure core of the suggestion engine, extracted from the hook so it can be unit-tested
// without a React renderer. The hook is a thin `useMemo` wrapper around this.
export function computeChainSuggestions(
  characters: StoredCharacter[],
  prices: Record<number, number>,
  assumeMaxSkills: boolean,
  systemPlanets: SystemPlanetsMap,
  maxSuggestions = 1
): ChainSuggestion[] {
    if (characters.length === 0 || Object.keys(prices).length === 0) return []

    const allSchematics = [...P1_TO_P2_SCHEMATICS, ...P2_TO_P3_SCHEMATICS, ...P3_TO_P4_SCHEMATICS]

    const produced = new Set<string>()
    for (const char of characters) {
      for (const planet of char.planets) {
        for (const name of planet.outputNames ?? []) if (name) produced.add(name)
      }
    }

    // Highest tier currently produced — only suggest at or above this tier
    let highestTierRank = 0
    for (const name of produced) {
      const rank = TIER_RANK[PRODUCT_BY_NAME.get(name)?.tier ?? ''] ?? 0
      if (rank > highestTierRank) highestTierRank = rank
    }

    // Effective IC: real skill, OR fake skillup planned, OR actively training — whichever is highest
    function effectiveIC(char: StoredCharacter): number {
      const real = char.piSkills.interplanetaryConsolidation
      const override = char.skillOverrides?.interplanetaryConsolidation ?? 0
      const training = char.skillTraining?.interplanetaryConsolidation?.toLevel ?? 0
      return assumeMaxSkills ? 5 : Math.max(real, override, training)
    }

    // Configured planets = have outputs; empty = colonized but unconfigured (free to repurpose)
    const charsWithSlots = characters
      .map(c => {
        const maxPlanets = 1 + effectiveIC(c)
        const emptyPlanets = c.planets.filter(p => (p.outputs?.length ?? 0) === 0).length
        const newSlots = Math.max(0, maxPlanets - c.planets.length)
        return { char: c, slots: newSlots + emptyPlanets }
      })
      .filter(c => c.slots > 0)
      .sort((a, b) => b.slots - a.slots)

    const totalSlotsAvailable = charsWithSlots.reduce((s, c) => s + c.slots, 0)

    const charAvailableCategories = new Map<number, Map<string, number>>()
    for (const char of characters) {
      const catCount = new Map<string, number>()
      for (const planet of char.planets) {
        if (!planet.systemId) continue
        for (const sp of systemPlanets.get(planet.systemId) ?? []) {
          catCount.set(sp.category, (catCount.get(sp.category) ?? 0) + 1)
        }
      }
      for (const planet of char.planets) {
        if (planet.type) catCount.set(planet.type, Math.max(0, (catCount.get(planet.type) ?? 0) - 1))
      }
      charAvailableCategories.set(char.characterId, catCount)
    }

    // Consumed names: products fed as input to another planet
    const consumedNames = new Set<string>()
    for (const char of characters) {
      for (const planet of char.planets) {
        for (const sch of allSchematics) {
          const outName = PRODUCT_BY_TYPE_ID.get(sch.output.typeId)?.name
          if (outName && (planet.outputNames ?? []).includes(outName)) {
            for (const inp of sch.inputs) {
              const n = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name
              if (n) consumedNames.add(n)
            }
          }
        }
      }
    }

    // Orphaned factory planets: all outputs unconsumed AND planet doesn't receive chain inputs
    interface OrphanedPlanet { planet: Planet; char: StoredCharacter; outputNames: string[] }
    const orphanedFactories: OrphanedPlanet[] = []
    for (const char of characters) {
      for (const planet of char.planets) {
        const outputs = planet.outputNames ?? []
        if (outputs.length === 0) continue
        const isFactory = (planet.outputTiers ?? []).some(t => t !== 'P1')
        if (!isFactory) continue

        const allOutputsUnconsumed = outputs.every(name => {
          const p = PRODUCT_BY_NAME.get(name)
          return p && p.tier !== 'P1' && !consumedNames.has(name)
        })
        if (!allOutputsUnconsumed) continue

        // Don't repurpose if this planet is being fed by other chain planets
        const planetInputNames = new Set<string>()
        for (const outName of outputs) {
          for (const sch of allSchematics) {
            if (PRODUCT_BY_TYPE_ID.get(sch.output.typeId)?.name === outName) {
              for (const inp of sch.inputs) {
                const n = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name
                if (n) planetInputNames.add(n)
              }
            }
          }
        }
        if (Array.from(planetInputNames).some(n => produced.has(n))) continue

        orphanedFactories.push({ planet, char, outputNames: outputs })
      }
    }

    const candidates: ChainSuggestion[] = []
    const seen = new Set<number>()

    for (const sch of allSchematics) {
      const product = PRODUCT_BY_TYPE_ID.get(sch.output.typeId)
      if (!product || seen.has(product.typeId)) continue
      if (produced.has(product.name)) continue
      if ((TIER_RANK[product.tier] ?? 0) < highestTierRank) continue

      const price = prices[product.typeId] ?? 0
      if (!price) continue

      const inputs = sch.inputs.map(inp => {
        const name = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name ?? String(inp.typeId)
        return evalInput(name, produced, charAvailableCategories, charsWithSlots)
      })

      if (inputs.some(i => i.status === 'unavailable')) continue

      const inputSlots = inputs.reduce((s, i) => s + i.slotsNeeded, 0)
      const slotsNeeded = 1 + inputSlots

      if (slotsNeeded > MAX_SLOTS_TO_SUGGEST) continue

      const repurpose = orphanedFactories.find(o =>
        o.outputNames.every(n => {
          const p = PRODUCT_BY_NAME.get(n)
          return p && p.tier === product.tier
        })
      )

      const effectiveSlotsNeeded = repurpose ? slotsNeeded - 1 : slotsNeeded
      const effectiveSlotsAvailable = totalSlotsAvailable + (repurpose ? 1 : 0)
      const achievable = effectiveSlotsAvailable >= effectiveSlotsNeeded

      // Determine blocked info if not achievable even with overrides/training
      let blocked: BlockedInfo | undefined
      if (!achievable && !assumeMaxSkills) {
        const extra = effectiveSlotsNeeded - effectiveSlotsAvailable
        // Pick the char with the most room to grow (lowest real IC)
        let bestChar = characters[0]
        for (const c of characters) {
          if (c.piSkills.interplanetaryConsolidation < (bestChar?.piSkills.interplanetaryConsolidation ?? 0))
            bestChar = c
        }
        const curLevel = bestChar?.piSkills.interplanetaryConsolidation ?? 0
        const targetLevel = Math.min(5, curLevel + extra)
        let trainHours = 0
        for (let lv = curLevel + 1; lv <= targetLevel; lv++) {
          trainHours += IC_TRAIN_HOURS[lv] ?? 0
        }
        blocked = {
          extraSlotsNeeded: extra,
          trainFromLevel: curLevel,
          trainToLevel: targetLevel,
          trainTimeHours: trainHours,
        }
      }

      // Build chain steps for the plan
      const chainSteps = buildChainSteps(
        product.name, produced, charAvailableCategories, charsWithSlots, characters, allSchematics
      )

      const bestChar = repurpose?.char ?? charsWithSlots[0]?.char ?? characters[0]
      const iskHr = (sch.output.quantity / sch.cycleTime) * 3600 * FACTORY_COUNT_ESTIMATE * price

      seen.add(product.typeId)
      candidates.push({
        key: `suggested:${product.typeId}`,
        product,
        schematic: sch,
        inputs,
        characterName: bestChar.characterName,
        characterId: bestChar.characterId,
        slotsNeeded,
        slotsAvailable: effectiveSlotsAvailable,
        iskHr,
        chainSteps,
        ...(repurpose ? {
          repurposes: {
            planet: repurpose.planet,
            characterName: repurpose.char.characterName,
            currentOutputNames: repurpose.outputNames,
          }
        } : {}),
        ...(blocked ? { blocked } : {}),
      })
    }

    // PRIORITY 1: Incomplete chains — planets already producing a high-tier product
    // but whose full input tree isn't satisfied (recursively).
    // e.g. P3 is being produced, P2 inputs exist, but a P1 feeder for one of those P2s is missing.

    // Returns true only if the product AND its entire input tree are in `produced`
    const chainCompleteCache = new Map<string, boolean>()
    function isChainComplete(name: string): boolean {
      const cached = chainCompleteCache.get(name)
      if (cached !== undefined) return cached
      if (!produced.has(name)) { chainCompleteCache.set(name, false); return false }
      const sch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === name)
      if (!sch) { chainCompleteCache.set(name, true); return true }  // P1 — in produced = complete
      const complete = sch.inputs.every(inp => {
        const n = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name
        return !n || isChainComplete(n)
      })
      chainCompleteCache.set(name, complete)
      return complete
    }

    // Walk down the chain to find the first product that is NOT in produced
    function findFirstMissing(name: string): string | null {
      if (!produced.has(name)) return name
      const sch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === name)
      if (!sch) return null
      for (const inp of sch.inputs) {
        const n = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name
        if (n) { const m = findFirstMissing(n); if (m) return m }
      }
      return null
    }

    interface IncompleteChainEntry {
      outputProduct: PIProduct
      outputChar: StoredCharacter
      missingInputName: string
      iskHr: number
    }
    const incompleteChains: IncompleteChainEntry[] = []
    for (const char of characters) {
      for (const planet of char.planets) {
        for (const outputName of planet.outputNames ?? []) {
          const outputProduct = PRODUCT_BY_NAME.get(outputName)
          if (!outputProduct || (TIER_RANK[outputProduct.tier] ?? 0) < 2) continue
          if (isChainComplete(outputName)) continue  // fully satisfied — nothing to do

          const sch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === outputName)
          if (!sch) continue
          const price = prices[outputProduct.typeId] ?? 0
          const iskHr = price ? (sch.output.quantity / sch.cycleTime) * 3600 * FACTORY_COUNT_ESTIMATE * price : 0

          // Find the deepest actually-missing input in the tree
          const missingInputName = sch.inputs
            .map(inp => PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name)
            .filter((n): n is string => !!n && !isChainComplete(n))
            .map(n => findFirstMissing(n))
            .find((n): n is string => !!n)

          if (missingInputName) {
            incompleteChains.push({ outputProduct, outputChar: char, missingInputName, iskHr })
          }
        }
      }
    }

    if (incompleteChains.length > 0) {
      // Recurse through the chain tree to find all products that are NOT in `produced`.
      // Unlike findFirstMissing, this walks through items that ARE produced but whose
      // sub-chain is still missing (e.g., Superconductors is produced but needs Oxidizing Compound).
      function findAllMissingLeaves(name: string, visited: Set<string>): string[] {
        if (visited.has(name)) return []
        visited.add(name)
        if (!produced.has(name)) return [name]
        const sch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === name)
        if (!sch) return []  // P1 in produced = complete
        const missing: string[] = []
        for (const inp of sch.inputs) {
          const n = PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name
          if (n && !isChainComplete(n)) missing.push(...findAllMissingLeaves(n, visited))
        }
        return missing
      }

      // Deduplicate by output product — one suggestion per incomplete chain top
      incompleteChains.sort((a, b) => b.iskHr - a.iskHr)
      const seenOutputs = new Set<number>()
      const completionSuggestions: ChainSuggestion[] = []

      for (const entry of incompleteChains) {
        if (seenOutputs.has(entry.outputProduct.typeId)) continue
        seenOutputs.add(entry.outputProduct.typeId)

        const outputSch = allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === entry.outputProduct.name)
        const bestChar = charsWithSlots[0]?.char ?? entry.outputChar
        if (!outputSch) continue

        const incompleteInputNames = outputSch.inputs
          .map(inp => PRODUCT_BY_TYPE_ID.get(inp.typeId)?.name)
          .filter((n): n is string => !!n && !isChainComplete(n))
        if (incompleteInputNames.length === 0) continue

        // Find all truly-missing leaf products across all incomplete branches.
        // findAllMissingLeaves digs through items in `produced` whose sub-chain is missing.
        const visitedLeaves = new Set<string>()
        const allMissingLeaves = incompleteInputNames.flatMap(n => findAllMissingLeaves(n, visitedLeaves))
        const uniqueLeaves = [...new Set(allMissingLeaves)]

        // Build chain steps for each missing leaf; track a virtual produced set so
        // shared sub-inputs across branches aren't duplicated
        const stepProduced = new Set<string>()
        const allChainSteps: ChainStep[] = []
        for (const leaf of uniqueLeaves) {
          if (stepProduced.has(leaf)) continue
          const steps = buildChainSteps(leaf, new Set([...produced, ...stepProduced]), charAvailableCategories, charsWithSlots, characters, allSchematics)
          allChainSteps.push(...steps)
          for (const step of steps) stepProduced.add(step.produces)
        }

        if (allChainSteps.length === 0) continue

        const allInputs = uniqueLeaves.map(leaf =>
          evalInput(leaf, produced, charAvailableCategories, charsWithSlots)
        )

        const firstMissingProduct = PRODUCT_BY_NAME.get(uniqueLeaves[0])
        const firstMissingSch = firstMissingProduct
          ? allSchematics.find(s => PRODUCT_BY_TYPE_ID.get(s.output.typeId)?.name === firstMissingProduct.name)
          : undefined

        completionSuggestions.push({
          key: `complete:${entry.outputProduct.typeId}`,
          product: firstMissingProduct ?? entry.outputProduct,
          schematic: firstMissingSch,
          inputs: allInputs,
          characterName: bestChar.characterName,
          characterId: bestChar.characterId,
          slotsNeeded: allChainSteps.length,
          slotsAvailable: totalSlotsAvailable,
          iskHr: entry.iskHr,
          chainSteps: allChainSteps,
          prereqFor: entry.outputProduct,
        })
      }

      // Deduplicate: if two incomplete chains need the exact same missing steps,
      // only show the highest-ISK one (adding the steps fixes all of them).
      const stepSig = (s: ChainSuggestion) => s.chainSteps.map(st => st.produces).sort().join('|')
      const bestBySteps = new Map<string, ChainSuggestion>()
      for (const s of completionSuggestions) {
        const sig = stepSig(s)
        const prev = bestBySteps.get(sig)
        if (!prev || s.iskHr > prev.iskHr) bestBySteps.set(sig, s)
      }

      // Always return here — even empty — so we never mix completion mode with new suggestions
      return [...bestBySteps.values()].sort((a, b) => b.iskHr - a.iskHr)
    }

    // PRIORITY 2: New high-value additions (only reached when all chains are complete)
    return candidates
      .sort((a, b) => {
        if (!!a.blocked !== !!b.blocked) return a.blocked ? 1 : -1
        const tierA = TIER_RANK[a.product.tier] ?? 0
        const tierB = TIER_RANK[b.product.tier] ?? 0
        if (tierB !== tierA) return tierB - tierA
        if (a.slotsNeeded !== b.slotsNeeded) return a.slotsNeeded - b.slotsNeeded
        return b.iskHr - a.iskHr
      })
      .slice(0, maxSuggestions)
}

export function useChainSuggestions(
  characters: StoredCharacter[],
  prices: Record<number, number>,
  assumeMaxSkills: boolean,
  systemPlanets: SystemPlanetsMap,
  maxSuggestions = 1
): ChainSuggestion[] {
  return useMemo(
    () => computeChainSuggestions(characters, prices, assumeMaxSkills, systemPlanets, maxSuggestions),
    [characters, prices, assumeMaxSkills, systemPlanets, maxSuggestions],
  )
}

export { formatTrainTime }

// ── Balance hints ─────────────────────────────────────────────────────────────

export interface BalanceHint {
  type: 'bottleneck' | 'excess'
  productName: string
  producers: number   // planets producing this
  consumers: number   // planets consuming this as input
}

// Pure core, extracted for unit testing (see `computeChainSuggestions`).
export function computeBalanceHints(characters: StoredCharacter[]): BalanceHint[] {
    if (characters.length === 0) return []

    // Count how many planets produce each product
    const producerCount = new Map<string, number>()
    // Count how many planets consume each product as a schematic input
    const consumerCount = new Map<string, number>()

    for (const char of characters) {
      for (const planet of char.planets) {
        const outputs = planet.outputNames ?? []
        for (const name of outputs) {
          if (!name) continue
          producerCount.set(name, (producerCount.get(name) ?? 0) + 1)
          // Infer inputs from this planet's outputs via schematics
          for (const inputName of SCHEMATIC_INPUTS_BY_NAME.get(name) ?? []) {
            consumerCount.set(inputName, (consumerCount.get(inputName) ?? 0) + 1)
          }
        }
      }
    }

    const hints: BalanceHint[] = []

    for (const [name, producers] of producerCount) {
      const consumers = consumerCount.get(name) ?? 0
      if (consumers === 0) continue  // end product sold directly — not an imbalance

      if (consumers > producers) {
        hints.push({ type: 'bottleneck', productName: name, producers, consumers })
      } else if (producers > consumers) {
        hints.push({ type: 'excess', productName: name, producers, consumers })
      }
    }

    // Surface the most extreme imbalance first
    return hints.sort((a, b) => Math.abs(b.consumers - b.producers) - Math.abs(a.consumers - a.producers))
}

export function useBalanceHints(characters: StoredCharacter[]): BalanceHint[] {
  return useMemo(() => computeBalanceHints(characters), [characters])
}
