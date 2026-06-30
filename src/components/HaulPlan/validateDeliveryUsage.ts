// B7 — delivery↔usage validation.
//
// The haul plan is a hand-off graph: an alt DEPOSITS a material into the shared PI
// container "for" some other alts, and those alts later DELIVER that material into
// their factories as an input. The two sides are computed independently in
// `computeSteps` (deposits from each producer's `neededByChar` view, deliveries from
// each consumer's per-planet schematic inputs), so they CAN drift — e.g. an alt is
// told to "leave X and Y for your alt" while the receiving alt only ever lists X as a
// factory input. This validator asserts the two sides agree, so a regression that
// breaks the hand-off model is caught instead of silently shipping a confusing plan.

import type { AltStep } from './HaulPlan'

export type DeliveryUsageViolationKind = 'unconsumed-delivery' | 'unsourced-consumption'

export interface DeliveryUsageViolation {
  kind: DeliveryUsageViolationKind
  material: string
  /** Producer alt that deposits the material (only on 'unconsumed-delivery'). */
  producer?: string
  /** Consumer alt the material is meant for. */
  consumer: string
  message: string
}

/**
 * Returns every delivery↔usage mismatch in a computed plan. An empty array means the
 * plan is consistent: every deposited material is consumed by each alt it's left for,
 * and every container-sourced factory input has an alt depositing it.
 */
export function validateDeliveryUsage(steps: AltStep[]): DeliveryUsageViolation[] {
  // consumer name → materials it pulls FROM the container (non-self factory inputs).
  // A return visit carries the same consumer's deferred inputs, so scanning every
  // step (primary + return) captures the full consumption picture.
  const consumedExternal = new Map<string, Set<string>>()
  for (const s of steps) {
    const name = s.char.characterName
    for (const stop of s.stops)
      for (const inp of stop.inputs) {
        if (inp.self) continue // produced on the consumer's own planet — no hand-off
        if (!consumedExternal.has(name)) consumedExternal.set(name, new Set())
        consumedExternal.get(name)!.add(inp.material)
      }
  }

  // consumer name → materials some alt deposits FOR it.
  const depositedFor = new Map<string, Set<string>>()
  for (const s of steps)
    for (const d of s.deposits)
      for (const to of d.toNames) {
        if (!depositedFor.has(to)) depositedFor.set(to, new Set())
        depositedFor.get(to)!.add(d.material)
      }

  const violations: DeliveryUsageViolation[] = []

  // 1. Every deposited material must actually be consumed by each alt it's left for.
  for (const s of steps) {
    const producer = s.char.characterName
    for (const d of s.deposits)
      for (const to of d.toNames)
        if (!consumedExternal.get(to)?.has(d.material))
          violations.push({
            kind: 'unconsumed-delivery',
            material: d.material,
            producer,
            consumer: to,
            message: `${producer} is told to leave ${d.material} for ${to}, but ${to} never lists ${d.material} as a factory input.`,
          })
  }

  // 2. Every container-sourced input must have an alt depositing it.
  for (const [consumer, mats] of consumedExternal)
    for (const material of mats)
      if (!depositedFor.get(consumer)?.has(material))
        violations.push({
          kind: 'unsourced-consumption',
          material,
          consumer,
          message: `${consumer} needs ${material} from the container, but no alt is told to deposit ${material} for ${consumer}.`,
        })

  return violations
}
