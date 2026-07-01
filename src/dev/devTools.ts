// Runtime gate for the dev-only empire seeder / scale controls.
//
// Local `npm run dev` (import.meta.env.DEV) always shows them. On a deployed
// build they're revealed only while `?dev` is present in the current URL, so
// Production can stay on `main` (auto-deploy, always latest) without ever
// exposing the tools to normal visitors and without needing a separate preview
// branch / build-time env var:
//   ?dev (or ?dev=1)  → on for this load only; drop the param and they're gone
//   ?dev=0            → off
// Nothing is persisted — a plain reload without the param hides them again.
// The only cost is the seeder no longer tree-shakes out of the prod bundle
// (~6 KB gzipped) — negligible for this tool.

function readFlag(): boolean {
  if (import.meta.env.DEV) return true
  try {
    const q = new URLSearchParams(window.location.search)
    return q.has('dev') && q.get('dev') !== '0'
  } catch {
    return false
  }
}

// Evaluated once at module load. Not persisted — presence of `?dev` gates it.
export const DEV_TOOLS = readFlag()

// Dev mode is a fully isolated sandbox: its character/planet data lives under a
// SEPARATE localStorage key so seeded test empires never touch your real account.
// Real site (no `?dev`)  → 'evepi.store'
// Dev / `?dev`           → 'evepi.store.dev'
// Flip `?dev` on/off to switch between the two instantly; neither clobbers the
// other. (Local `npm run dev` is always the sandbox — a different origin from the
// deployed site anyway, so its localStorage is already separate.)
export const STORE_KEY = DEV_TOOLS ? 'evepi.store.dev' : 'evepi.store'
