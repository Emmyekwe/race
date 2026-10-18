import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The root-level .env is shared by the server and the Vite dev proxy.
// A server-local .env is also honoured; values already set are never overridden.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

const isProd = process.env.NODE_ENV === 'production'

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production')
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export const config = Object.freeze({
  isProd,
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/racing_game',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  // On Render, RENDER_EXTERNAL_URL is the service's public URL (e.g. https://arcade-racer.onrender.com).
  clientOrigin: process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
  tickRate: clamp(Number(process.env.TICK_RATE) || 30, 10, 60),
})
