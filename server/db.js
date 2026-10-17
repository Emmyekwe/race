import mongoose from 'mongoose'
import { config } from './config.js'

mongoose.set('strictQuery', true)

let listenersAttached = false

function attachConnectionListeners() {
  if (listenersAttached) return
  listenersAttached = true
  const conn = mongoose.connection
  conn.on('connected', () => {
    console.log(`[db] connected to mongodb://${conn.host}:${conn.port}/${conn.name}`)
  })
  conn.on('disconnected', () => console.warn('[db] disconnected'))
  conn.on('reconnected', () => console.log('[db] reconnected'))
  conn.on('error', (err) => console.error('[db] connection error:', err.message))
}

/**
 * Connects Mongoose to MongoDB. With the default URI this is the local server
 * you browse in MongoDB Compass at mongodb://localhost:27017 (database: racing_game).
 */
export async function connectDB(uri = config.mongoUri) {
  attachConnectionListeners()
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: true,
  })
  return mongoose.connection
}

export async function disconnectDB() {
  await mongoose.disconnect()
}
