import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { rateLimit } from 'express-rate-limit'
import { Server } from 'socket.io'

import { config } from './config.js'
import { connectDB, disconnectDB } from './db.js'
import User, { USERNAME_COLLATION } from './models/User.js'
import Garage, {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_CAR_COLOR,
  HEX_COLOR_RE,
  TOP_SPEED_MODIFIER_MAX,
  TOP_SPEED_MODIFIER_MIN,
} from './models/Garage.js'
import RaceRecord from './models/RaceRecord.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Game rules (keep in sync with client/src/game/constants.js)
// ---------------------------------------------------------------------------
const TRACK_NAME = 'oval-speedway'
const TOTAL_LAPS = 3
const MAX_PLAYERS = 6
const COUNTDOWN_MS = 3000
// Track is ~491 m; even the fastest garage setup needs > 10 s per lap.
const MIN_LAP_MS = 8000
const MAX_LAP_MS = 10 * 60 * 1000
// Allowed drift between the client-measured lap and the server's own clock.
const LAP_TIME_TOLERANCE_MS = 1500
// After the first finisher, stragglers get this long before the race closes.
const FINISH_GRACE_MS = 30000
const EMPTY_ROOM_TTL_MS = 60000
const MIN_TRANSFORM_INTERVAL_MS = 1000 / 70
// Room chat: messages live in memory with the room and are replayed to players who join later.
const CHAT_MAX_LENGTH = 200
const CHAT_HISTORY = 50
const CHAT_RATE_WINDOW_MS = 10000
const CHAT_RATE_MAX = 5

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const PASSWORD_MIN = 6
const PASSWORD_MAX = 128
const BCRYPT_ROUNDS = 10
// Compared against when a username doesn't exist so login timing doesn't leak which names are taken.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

class GameError extends Error {}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), username: user.username }, config.jwtSecret, {
    expiresIn: '7d',
  })
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('missing token')
  const payload = jwt.verify(token, config.jwtSecret)
  return { id: payload.sub, username: payload.username }
}

function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  try {
    req.user = verifyToken(token)
    return next()
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' })
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers or underscores'
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`
  }
  return null
}

function serializeGarage(garage) {
  return {
    selectedCarColor: garage.selectedCarColor,
    accentColor: garage.accentColor ?? DEFAULT_ACCENT_COLOR,
    topSpeedModifier: garage.topSpeedModifier,
  }
}

function sessionPayload(user, garage) {
  return {
    token: signToken(user),
    user: { id: user._id.toString(), username: user.username },
    garage: serializeGarage(garage),
  }
}

function getOrCreateGarage(userId) {
  return Garage.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        selectedCarColor: DEFAULT_CAR_COLOR,
        accentColor: DEFAULT_ACCENT_COLOR,
        topSpeedModifier: 1,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
}

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

// ---------------------------------------------------------------------------
// Express app (REST API)
// ---------------------------------------------------------------------------
const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: config.clientOrigin, credentials: true }))
app.use(express.json({ limit: '10kb' }))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    rooms: rooms.size,
    uptimeSec: Math.round(process.uptime()),
  })
})

app.post(
  '/api/auth/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {}
    const validationError = validateCredentials(username, password)
    if (validationError) return res.status(400).json({ error: validationError })

    const existing = await User.findOne({ username }).collation(USERNAME_COLLATION).lean()
    if (existing) return res.status(409).json({ error: 'Username is already taken' })

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    let user
    try {
      user = await User.create({ username, passwordHash })
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: 'Username is already taken' })
      throw err
    }
    const garage = await getOrCreateGarage(user._id)
    return res.status(201).json(sessionPayload(user, garage))
  }),
)

app.post(
  '/api/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const user = await User.findOne({ username: username.trim() })
      .collation(USERNAME_COLLATION)
      .select('+passwordHash')
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }
    const garage = await getOrCreateGarage(user._id)
    return res.json(sessionPayload(user, garage))
  }),
)

app.get(
  '/api/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean()
    if (!user) return res.status(401).json({ error: 'Account no longer exists' })
    const garage = await getOrCreateGarage(user._id)
    return res.json({
      user: { id: user._id.toString(), username: user.username },
      garage: serializeGarage(garage),
    })
  }),
)

app.get(
  '/api/garage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const garage = await getOrCreateGarage(req.user.id)
    res.json({ garage: serializeGarage(garage) })
  }),
)

app.put(
  '/api/garage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { selectedCarColor, accentColor, topSpeedModifier } = req.body ?? {}
    const updates = {}

    for (const [field, value] of Object.entries({ selectedCarColor, accentColor })) {
      if (value === undefined) continue
      if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
        return res.status(400).json({ error: `${field} must be a hex colour like #ff0055` })
      }
      updates[field] = value.toLowerCase()
    }
    if (topSpeedModifier !== undefined) {
      const n = Number(topSpeedModifier)
      if (!Number.isFinite(n) || n < TOP_SPEED_MODIFIER_MIN || n > TOP_SPEED_MODIFIER_MAX) {
        return res.status(400).json({
          error: `topSpeedModifier must be between ${TOP_SPEED_MODIFIER_MIN} and ${TOP_SPEED_MODIFIER_MAX}`,
        })
      }
      updates.topSpeedModifier = Math.round(n * 100) / 100
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' })
    }

    const garage = await Garage.findOneAndUpdate(
      { userId: req.user.id },
      { $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
    return res.json({ garage: serializeGarage(garage) })
  }),
)

app.get(
  '/api/leaderboard',
  asyncHandler(async (req, res) => {
    const rawTrack = typeof req.query.track === 'string' ? req.query.track.trim() : ''
    const trackName = rawTrack ? rawTrack.slice(0, 64) : TRACK_NAME
    const limit = clampInt(req.query.limit, 1, 50, 10)
    const entries = await RaceRecord.getLeaderboard(trackName, limit)
    res.json({
      trackName,
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId.toString(),
        username: entry.username,
        lapTimeMs: entry.lapTimeMs,
        carColor: entry.carColor ?? null,
        createdAt: entry.createdAt,
      })),
    })
  }),
)

app.get(
  '/api/records/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawTrack = typeof req.query.track === 'string' ? req.query.track.trim() : ''
    const trackName = rawTrack ? rawTrack.slice(0, 64) : TRACK_NAME
    const filter = { userId: req.user.id, trackName }
    const [best, recent, totalLaps] = await Promise.all([
      RaceRecord.findOne(filter).sort({ lapTimeMs: 1 }).lean(),
      RaceRecord.find(filter).sort({ createdAt: -1 }).limit(10).lean(),
      RaceRecord.countDocuments(filter),
    ])
    res.json({
      trackName,
      personalBestMs: best?.lapTimeMs ?? null,
      totalLaps,
      recent: recent.map((r) => ({ id: r._id.toString(), lapTimeMs: r.lapTimeMs, createdAt: r.createdAt })),
    })
  }),
)

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

// In production (`npm run build` then `npm start`) the server also hosts the built client.
const clientDist = path.resolve(__dirname, '..', 'client', 'dist')
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist))
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }
  console.error('[http] unhandled error:', err)
  return res.status(500).json({ error: 'Internal server error' })
})

// ---------------------------------------------------------------------------
// Socket.io: lobbies, races and transform relay
// ---------------------------------------------------------------------------
const httpServer = http.createServer(app)
const io = new Server(httpServer, {
  cors: { origin: config.clientOrigin, credentials: true },
  pingInterval: 10000,
  pingTimeout: 5000,
})

/**
 * @typedef {Object} Player
 * @property {string} socketId
 * @property {string} userId
 * @property {string} username
 * @property {string} color
 * @property {string} accentColor
 * @property {number} topSpeedModifier
 * @property {number} slot            starting-grid slot
 * @property {number} lapsCompleted
 * @property {number|null} bestLapMs  best lap in the current race
 * @property {number|null} finishTimeMs total race time once finished
 * @property {number|null} lapMarkAt  server time when the current lap started
 * @property {{p:number[], q:number[], s:number}|null} transform latest reported transform
 * @property {number} lastTransformAt
 *
 * @typedef {Object} Room
 * @property {string} id
 * @property {string|null} hostId
 * @property {'lobby'|'countdown'|'racing'} status
 * @property {boolean} isPrivate
 * @property {string} trackName
 * @property {number} totalLaps
 * @property {Map<string, Player>} players  keyed by socket id
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {NodeJS.Timeout|null} countdownTimer
 * @property {NodeJS.Timeout|null} finishTimer
 * @property {Array|null} results          standings of the last finished race
 * @property {ChatMessage[]} chat           most recent CHAT_HISTORY messages
 *
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {'player'|'system'} kind
 * @property {string|null} userId
 * @property {string|null} username
 * @property {string|null} color
 * @property {string} text
 * @property {number} at
 */

/** @type {Map<string, Room>} */
const rooms = new Map()

function createRoomId() {
  let id
  do {
    id = crypto.randomBytes(3).toString('hex').toUpperCase()
  } while (rooms.has(id))
  return id
}

function createRoom({ isPrivate }) {
  /** @type {Room} */
  const room = {
    id: createRoomId(),
    hostId: null,
    status: 'lobby',
    isPrivate,
    trackName: TRACK_NAME,
    totalLaps: TOTAL_LAPS,
    players: new Map(),
    createdAt: Date.now(),
    startedAt: null,
    countdownTimer: null,
    finishTimer: null,
    results: null,
    chat: [],
  }
  rooms.set(room.id, room)
  return room
}

function freshRaceState() {
  return {
    lapsCompleted: 0,
    bestLapMs: null,
    finishTimeMs: null,
    lapMarkAt: null,
    transform: null,
    lastTransformAt: 0,
  }
}

function serializePlayer(p) {
  return {
    id: p.socketId,
    userId: p.userId,
    username: p.username,
    color: p.color,
    accentColor: p.accentColor,
    topSpeedModifier: p.topSpeedModifier,
    slot: p.slot,
    lapsCompleted: p.lapsCompleted,
    bestLapMs: p.bestLapMs,
    finishTimeMs: p.finishTimeMs,
  }
}

function serializeRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    isPrivate: room.isPrivate,
    trackName: room.trackName,
    totalLaps: room.totalLaps,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].sort((a, b) => a.slot - b.slot).map(serializePlayer),
    lastResults: room.results,
  }
}

function broadcastRoom(room) {
  io.to(room.id).emit('room:update', serializeRoom(room))
}

function postChat(room, { kind = 'player', player = null, text }) {
  /** @type {ChatMessage} */
  const message = {
    id: crypto.randomUUID(),
    kind,
    userId: player?.userId ?? null,
    username: player?.username ?? null,
    color: player?.color ?? null,
    text,
    at: Date.now(),
  }
  room.chat.push(message)
  if (room.chat.length > CHAT_HISTORY) room.chat.shift()
  io.to(room.id).emit('chat:message', message)
  return message
}

/** Normalizes chat input to a single line of printable text, or throws a GameError. */
function readChatText(raw) {
  if (typeof raw !== 'string') throw new GameError('Message must be text')
  // Control characters, zero-width and bidi-override characters could hide or spoof text.
  const text = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) throw new GameError('Message is empty')
  if (text.length > CHAT_MAX_LENGTH) throw new GameError(`Messages are limited to ${CHAT_MAX_LENGTH} characters`)
  return text
}

/** Sliding-window limit per socket so one player can't flood the room. */
function checkChatRate(socket) {
  const now = Date.now()
  const recent = (socket.data.chatSentAt || []).filter((t) => now - t < CHAT_RATE_WINDOW_MS)
  if (recent.length >= CHAT_RATE_MAX) {
    socket.data.chatSentAt = recent
    throw new GameError('You are sending messages too quickly')
  }
  recent.push(now)
  socket.data.chatSentAt = recent
}

function nextFreeSlot(room) {
  const used = new Set([...room.players.values()].map((p) => p.slot))
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i
  return -1
}

function clearRoomTimers(room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer)
  if (room.finishTimer) clearTimeout(room.finishTimer)
  room.countdownTimer = null
  room.finishTimer = null
}

function getRoomAndPlayer(socket) {
  const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined
  const player = room?.players.get(socket.id)
  return { room, player }
}

/** The parts of a garage a player brings into a room. */
function garageLoadout(garage) {
  return {
    color: garage.selectedCarColor,
    accentColor: garage.accentColor ?? DEFAULT_ACCENT_COLOR,
    topSpeedModifier: garage.topSpeedModifier,
  }
}

async function joinRoom(socket, room) {
  if (socket.data.joining) throw new GameError('Already joining a room')
  socket.data.joining = true
  try {
    leaveCurrentRoom(socket)
    const garage = await getOrCreateGarage(socket.data.user.id)

    // State may have changed while we awaited the database.
    if (!socket.connected) throw new GameError('Disconnected')
    if (!rooms.has(room.id)) throw new GameError('That room no longer exists')
    if (room.status !== 'lobby') throw new GameError('A race is already in progress in that room')
    if (room.players.size >= MAX_PLAYERS) throw new GameError('That room is full')

    /** @type {Player} */
    const player = {
      socketId: socket.id,
      userId: socket.data.user.id,
      username: socket.data.user.username,
      ...garageLoadout(garage),
      slot: nextFreeSlot(room),
      ...freshRaceState(),
    }
    room.players.set(socket.id, player)
    if (!room.hostId || !room.players.has(room.hostId)) room.hostId = socket.id

    socket.join(room.id)
    socket.data.roomId = room.id
    broadcastRoom(room)
    postChat(room, { kind: 'system', text: `${player.username} joined` })
    return { room: serializeRoom(room), selfId: socket.id, chat: room.chat }
  } finally {
    socket.data.joining = false
  }
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId
  if (!roomId) return
  socket.data.roomId = null
  socket.leave(roomId)

  const room = rooms.get(roomId)
  if (!room) return
  const leaving = room.players.get(socket.id)
  room.players.delete(socket.id)
  io.to(room.id).emit('player:left', { id: socket.id })
  if (leaving && room.players.size > 0) postChat(room, { kind: 'system', text: `${leaving.username} left` })

  if (room.players.size === 0) {
    clearRoomTimers(room)
    rooms.delete(room.id)
    return
  }
  if (room.hostId === socket.id) {
    room.hostId = [...room.players.values()].sort((a, b) => a.slot - b.slot)[0].socketId
  }
  if (room.status === 'racing' && [...room.players.values()].every((p) => p.finishTimeMs !== null)) {
    endRace(room)
    return
  }
  broadcastRoom(room)
}

function startCountdown(room) {
  clearRoomTimers(room)
  room.status = 'countdown'
  room.startedAt = null
  room.results = null
  for (const player of room.players.values()) Object.assign(player, freshRaceState())

  const serverNow = Date.now()
  io.to(room.id).emit('race:countdown', { startsAt: serverNow + COUNTDOWN_MS, serverNow })
  broadcastRoom(room)

  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null
    if (!rooms.has(room.id) || room.status !== 'countdown') return
    room.status = 'racing'
    room.startedAt = Date.now()
    io.to(room.id).emit('race:go', { startedAt: room.startedAt })
    broadcastRoom(room)
  }, COUNTDOWN_MS)
}

function handlePlayerFinished(room) {
  const everyoneDone = [...room.players.values()].every((p) => p.finishTimeMs !== null)
  if (everyoneDone) {
    endRace(room)
    return
  }
  if (!room.finishTimer) {
    room.finishTimer = setTimeout(() => {
      room.finishTimer = null
      endRace(room)
    }, FINISH_GRACE_MS)
    io.to(room.id).emit('race:finishCountdown', { msRemaining: FINISH_GRACE_MS })
  }
}

function endRace(room) {
  if (!rooms.has(room.id) || room.status !== 'racing') return
  clearRoomTimers(room)

  const standings = [...room.players.values()]
    .sort((a, b) => {
      const aFinish = a.finishTimeMs ?? Number.POSITIVE_INFINITY
      const bFinish = b.finishTimeMs ?? Number.POSITIVE_INFINITY
      if (aFinish !== bFinish) return aFinish - bFinish
      if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted
      return (a.bestLapMs ?? Number.POSITIVE_INFINITY) - (b.bestLapMs ?? Number.POSITIVE_INFINITY)
    })
    .map((p, index) => ({
      position: index + 1,
      id: p.socketId,
      username: p.username,
      color: p.color,
      lapsCompleted: p.lapsCompleted,
      bestLapMs: p.bestLapMs,
      finishTimeMs: p.finishTimeMs,
    }))

  room.status = 'lobby'
  room.startedAt = null
  room.results = standings
  for (const player of room.players.values()) {
    player.transform = null
    player.lapMarkAt = null
  }
  io.to(room.id).emit('race:ended', { standings })
  broadcastRoom(room)
}

async function persistLap(userId, trackName, lapTimeMs, carColor) {
  try {
    const previousBest = await RaceRecord.findOne({ userId, trackName })
      .sort({ lapTimeMs: 1 })
      .select('lapTimeMs')
      .lean()
    await RaceRecord.create({ userId, trackName, lapTimeMs, carColor })
    io.emit('leaderboard:changed', { trackName })
    return { saved: true, personalBest: !previousBest || lapTimeMs < previousBest.lapTimeMs }
  } catch (err) {
    console.error('[race] failed to persist lap:', err)
    return { saved: false, personalBest: false }
  }
}

/** Reads a fixed-length numeric array, rejecting NaN/Infinity and absurd magnitudes. */
function readVector(value, length, limit) {
  if (!Array.isArray(value) || value.length !== length) return null
  const out = new Array(length)
  for (let i = 0; i < length; i++) {
    const n = Number(value[i])
    if (!Number.isFinite(n) || Math.abs(n) > limit) return null
    out[i] = Math.round(n * 1000) / 1000
  }
  return out
}

/** Wraps a socket handler so every call gets exactly one `{ ok, ... }` acknowledgement. */
function withAck(handler) {
  return async (payload, ack) => {
    if (typeof payload === 'function') {
      ack = payload
      payload = undefined
    }
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const result = await handler(payload && typeof payload === 'object' ? payload : {})
      reply({ ok: true, ...result })
    } catch (err) {
      if (err instanceof GameError) {
        reply({ ok: false, error: err.message })
      } else {
        console.error('[socket] handler error:', err)
        reply({ ok: false, error: 'Internal server error' })
      }
    }
  }
}

io.use((socket, next) => {
  try {
    socket.data.user = verifyToken(socket.handshake.auth?.token)
    socket.data.roomId = null
    socket.data.joining = false
    next()
  } catch {
    next(new Error('unauthorized'))
  }
})

io.on('connection', (socket) => {
  const { username } = socket.data.user
  console.log(`[socket] ${username} connected (${socket.id})`)

  socket.on(
    'room:quickJoin',
    withAck(async () => {
      let room = [...rooms.values()].find(
        (r) => !r.isPrivate && r.status === 'lobby' && r.players.size < MAX_PLAYERS && r.id !== socket.data.roomId,
      )
      const created = !room
      if (!room) room = createRoom({ isPrivate: false })
      try {
        return await joinRoom(socket, room)
      } catch (err) {
        if (created && room.players.size === 0) rooms.delete(room.id)
        throw err
      }
    }),
  )

  socket.on(
    'room:create',
    withAck(async () => {
      const room = createRoom({ isPrivate: true })
      try {
        return await joinRoom(socket, room)
      } catch (err) {
        if (room.players.size === 0) rooms.delete(room.id)
        throw err
      }
    }),
  )

  socket.on(
    'room:join',
    withAck(async ({ roomId }) => {
      if (typeof roomId !== 'string' || !/^[0-9a-fA-F]{6}$/.test(roomId.trim())) {
        throw new GameError('Room codes are 6 characters, e.g. A1B2C3')
      }
      const room = rooms.get(roomId.trim().toUpperCase())
      if (!room) throw new GameError('Room not found')
      if (room.id === socket.data.roomId) return { room: serializeRoom(room), selfId: socket.id, chat: room.chat }
      return joinRoom(socket, room)
    }),
  )

  socket.on(
    'room:leave',
    withAck(async () => {
      leaveCurrentRoom(socket)
      return {}
    }),
  )

  // Re-reads the saved garage so colour/tuning changes made in the lobby show up for everyone.
  socket.on(
    'garage:refresh',
    withAck(async () => {
      const { room, player } = getRoomAndPlayer(socket)
      if (!room || !player) return { applied: false }
      if (room.status !== 'lobby') throw new GameError('Garage changes apply after this race')
      const garage = await getOrCreateGarage(socket.data.user.id)
      // The room may have started (or we may have left) while the database read was in flight.
      if (room.status !== 'lobby' || room.players.get(socket.id) !== player) {
        throw new GameError('Garage changes apply after this race')
      }
      Object.assign(player, garageLoadout(garage))
      broadcastRoom(room)
      return { applied: true }
    }),
  )

  socket.on(
    'race:start',
    withAck(async () => {
      const { room } = getRoomAndPlayer(socket)
      if (!room) throw new GameError('You are not in a room')
      if (room.hostId !== socket.id) throw new GameError('Only the host can start the race')
      if (room.status !== 'lobby') throw new GameError('The race has already started')
      startCountdown(room)
      return {}
    }),
  )

  // Room chat works in the lobby and mid-race. The sender's identity comes from the
  // verified socket, never from the payload.
  socket.on(
    'chat:send',
    withAck(async ({ text }) => {
      const { room, player } = getRoomAndPlayer(socket)
      if (!room || !player) throw new GameError('Join a room to chat')
      const clean = readChatText(text)
      checkChatRate(socket)
      const message = postChat(room, { player, text: clean })
      return { id: message.id }
    }),
  )

  // High-frequency, fire-and-forget. The server stores the latest transform and the
  // snapshot loop below relays it to the room at TICK_RATE Hz.
  socket.on('player:transform', (payload) => {
    const { room, player } = getRoomAndPlayer(socket)
    if (!room || !player || room.status === 'lobby' || !payload) return
    const now = Date.now()
    if (now - player.lastTransformAt < MIN_TRANSFORM_INTERVAL_MS) return
    const p = readVector(payload.p, 3, 5000)
    const q = readVector(payload.q, 4, 1.01)
    const s = Number(payload.s)
    if (!p || !q || !Number.isFinite(s)) return
    player.transform = { p, q, s: Math.min(Math.max(s, 0), 200) }
    player.lastTransformAt = now
  })

  // The client crossed the start line for the first time: start the server-side lap clock.
  socket.on('race:lapStart', () => {
    const { room, player } = getRoomAndPlayer(socket)
    if (!room || !player || room.status !== 'racing' || player.finishTimeMs !== null) return
    if (player.lapMarkAt === null) player.lapMarkAt = Date.now()
  })

  socket.on(
    'race:lap',
    withAck(async (payload) => {
      const { room, player } = getRoomAndPlayer(socket)
      if (!room || !player || room.status !== 'racing') throw new GameError('No race in progress')

      const now = Date.now()
      const status = () => ({
        lapsCompleted: player.lapsCompleted,
        bestLapMs: player.bestLapMs,
        finished: player.finishTimeMs !== null,
      })
      // On rejection the server restarts its lap clock at this crossing, mirroring the client.
      const reject = (error) => {
        player.lapMarkAt = now
        return { ok: false, error, ...status() }
      }

      if (player.finishTimeMs !== null) return { ok: false, error: 'You have already finished', ...status() }
      if (player.lapMarkAt === null) return reject('Lap start was not registered; timing restarted')

      const lapTimeMs = Math.round(Number(payload.lapTimeMs))
      if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) {
        return reject('Lap time is outside the allowed range')
      }
      // Client timing is only trusted when it agrees with the server's own clock.
      if (Math.abs(now - player.lapMarkAt - lapTimeMs) > LAP_TIME_TOLERANCE_MS) {
        return reject('Lap time does not match server timing')
      }

      player.lapMarkAt = now
      player.lapsCompleted += 1
      if (player.bestLapMs === null || lapTimeMs < player.bestLapMs) player.bestLapMs = lapTimeMs
      if (player.lapsCompleted >= room.totalLaps) player.finishTimeMs = now - room.startedAt

      const result = status()
      if (player.finishTimeMs !== null) handlePlayerFinished(room)
      broadcastRoom(room)

      const { saved, personalBest } = await persistLap(player.userId, room.trackName, lapTimeMs, player.color)
      return { ...result, lapTimeMs, saved, personalBest }
    }),
  )

  socket.on('disconnect', (reason) => {
    console.log(`[socket] ${username} disconnected (${reason})`)
    leaveCurrentRoom(socket)
  })
})

// Snapshot loop: relays every player's latest transform to their room at TICK_RATE Hz.
// `volatile` drops a snapshot for a client whose buffer is backed up rather than queueing stale data.
const snapshotInterval = setInterval(() => {
  const t = Date.now()
  for (const room of rooms.values()) {
    if (room.status === 'lobby') continue
    const players = {}
    let count = 0
    for (const player of room.players.values()) {
      if (!player.transform) continue
      players[player.socketId] = player.transform
      count++
    }
    if (count > 0) io.to(room.id).volatile.emit('room:snapshot', { t, players })
  }
}, 1000 / config.tickRate)

// Rooms orphaned by a failed join are swept periodically.
const sweepInterval = setInterval(() => {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (room.players.size === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
      clearRoomTimers(room)
      rooms.delete(room.id)
    }
  }
}, EMPTY_ROOM_TTL_MS)

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
async function start() {
  try {
    await connectDB()
  } catch (err) {
    console.error(`\n[db] Could not connect to MongoDB at ${config.mongoUri}`)
    console.error(`[db] ${err.message}`)
    console.error('[db] Make sure the MongoDB server is running (Windows service "MongoDB" or `mongod`),')
    console.error('[db] then verify the URI by connecting to it in MongoDB Compass.\n')
    process.exit(1)
  }

  httpServer.listen(config.port, () => {
    console.log(`[http] API + Socket.io listening on http://localhost:${config.port}`)
    console.log(`[game] snapshot broadcast rate: ${config.tickRate} Hz`)
  })
}

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[server] ${signal} received, shutting down...`)
  clearInterval(snapshotInterval)
  clearInterval(sweepInterval)
  for (const room of rooms.values()) clearRoomTimers(room)
  io.close()
  httpServer.close()
  try {
    await disconnectDB()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start()
