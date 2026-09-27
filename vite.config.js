import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.STIGMERGY_API_URL || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/openapi.json': apiTarget,
      '/healthz': apiTarget,
      '/readyz': apiTarget,
      '/api': apiTarget,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/openapi.json': apiTarget,
      '/healthz': apiTarget,
      '/readyz': apiTarget,
      '/api': apiTarget,
    },
  },
})
