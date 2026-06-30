// Tier → color map, shared across the chain/haul/setup views.
// Typed Record<string, string> so it accepts both PITier-keyed lookups
// (ChainGraph, ChainTerminalList) and plain string tier values (HaulPlan,
// SetupView, TemplateSearch). Assignable to Record<PITier, string> where needed.
export const TIER_COLOR: Record<string, string> = {
  P0: '#708070', P1: '#4a90c8', P2: '#8060c0', P3: '#c06040', P4: '#c09020'
}
