import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// Plain web build. `api/` (Vercel serverless functions) is excluded from the
// client bundle — Vercel builds those separately.
export default defineConfig({
  plugins: [react()],
  // package.json is the single source of truth for the app version (semver)
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  server: {
    port: 5173,
    // Proxy serverless routes to `vercel dev` (running on 3000) during local dev
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
