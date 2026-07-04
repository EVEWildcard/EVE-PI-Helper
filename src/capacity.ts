// Supported empire ceiling.
//
// We designed (and perf-tuned) the tool for up to MAX_ACCOUNTS EVE accounts, each
// with the full ALTS_PER_ACCOUNT characters. Past that we don't pretend to scale
// forever — the app shows a friendly "we didn't expect this many, tell us" prompt
// (App.tsx) instead of silently degrading. Kept in its own tiny module (no dev
// or data deps) so production code can read the ceiling without pulling in the
// dev-only empire seeder.

export const MAX_ACCOUNTS = 30
export const ALTS_PER_ACCOUNT = 3
export const MAX_SUPPORTED_CHARACTERS = MAX_ACCOUNTS * ALTS_PER_ACCOUNT // 90

// ── Complexity mode (simple vs. complex) ────────────────────────────────────
//
// The app adapts its UI to empire size. Up to POWER_USER_ACCOUNTS accounts the
// user is on "simple" mode (small empire: show everything, no filtering);
// past it they're a power user and the app switches to "complex" mode (hide
// views that don't scale, default to filtered/summarized presentations).
// The mode is INTERNAL — never shown to users as a label. Accounts are derived
// from character count (ALTS_PER_ACCOUNT alts each, rounded up).
export const POWER_USER_ACCOUNTS = 3 // > this many accounts → complex mode

export type ComplexityMode = 'simple' | 'complex'

export function complexityMode(characterCount: number): ComplexityMode {
  const accounts = Math.ceil(characterCount / ALTS_PER_ACCOUNT)
  return accounts > POWER_USER_ACCOUNTS ? 'complex' : 'simple'
}
