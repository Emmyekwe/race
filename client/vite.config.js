import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Read PORT / CLIENT_PORT from the shared root-level .env.
const rootDir = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  const apiTarget = `http://localhost:${env.PORT || 4000}`

  return {
    plugins: [react()],
    server: {
      port: Number(env.CLIENT_PORT) || 5173,
      strictPort: true,
      // The browser talks to one origin; Vite forwards REST and WebSocket traffic to the game server.
      proxy: {
        '/api': apiTarget,
        '/socket.io': { target: apiTarget, ws: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
  }
})
