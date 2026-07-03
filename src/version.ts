// Single source of truth is package.json's "version" (semver: breaking=major,
// feature=minor, fix=patch). Bump it there — `__APP_VERSION__` is injected by
// Vite `define` (see vite.config.ts); never hardcode a version here.
export const APP_VERSION = __APP_VERSION__

// One-line blurb shown next to the version in the bottom status bar.
// HARD RULE: keep it VERY short (≤ 80 chars) and do NOT prefix it with the
// version — the version renders separately. Enforced by src/version.test.ts.
export const LATEST_CHANGE = 'Plans suggest planet swaps when the needed category is taken'
