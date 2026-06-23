import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain web build. `api/` (Vercel serverless functions) is excluded from the
// client bundle — Vercel builds those separately.
export default defineConfig({
  plugins: [react()],
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
