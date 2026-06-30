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
