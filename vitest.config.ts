import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// Unit tests run through Vite's transform pipeline (so `.module.css` imports and TSX
// resolve), in a plain Node environment — the tests exercise pure logic, not the DOM.
export default defineConfig({
  plugins: [react()],
  // Keep in sync with vite.config.ts: version injected from package.json
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
