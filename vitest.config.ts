import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit tests run through Vite's transform pipeline (so `.module.css` imports and TSX
// resolve), in a plain Node environment — the tests exercise pure logic, not the DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
