// Runtime gate for the dev-only empire seeder / scale controls.
//
// Local `npm run dev` (import.meta.env.DEV) always shows them. On a deployed
// build they're revealed per-browser via a URL flag, so Production can stay on
// `main` (auto-deploy, always latest) without ever exposing the tools to normal
// visitors and without needing a separate preview branch / build-time env var:
//   ?dev=1  → turn on  (persisted to localStorage)
//   ?dev=0  → turn off (persisted)
// The only cost is the seeder no longer tree-shakes out of the prod bundle
// (~6 KB gzipped) — negligible for this tool.

const STORAGE_KEY = 'devTools'

function readFlag(): boolean {
  if (import.meta.env.DEV) return true
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.has('dev')) {
      const on = q.get('dev') !== '0'
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
      return on
    }
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Evaluated once at module load. `?dev=1` persists, so a plain reload keeps it on.
export const DEV_TOOLS = readFlag()
