// Integration tests: boots the real server against a throwaway MongoDB database
// and exercises the REST API and the Socket.io race flow end to end.
//
//   npm test                      (needs MongoDB on localhost:27017)
//   TEST_MONGO_URI=... npm test   (any database whose name ends in "_test")

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { io } from 'socket.io-client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(__dirname, '..')
const PORT = Number(process.env.TEST_PORT) || 4610
const BASE = `http://localhost:${PORT}`
const MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017/racing_game_test'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let serverProcess
let serverOutput = ''
const sockets = []

async function api(urlPath, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json() }
}

function register(username) {
  return api('/api/auth/register', { method: 'POST', body: { username, password: 'secret123' } })
}

async function connect(token) {
  const socket = io(BASE, { auth: { token }, reconnection: false, transports: ['websocket'] })
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}

function ask(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, res) => (err ? reject(err) : resolve(res)))
  })
}

async function dropTestDatabase() {
  const conn = await mongoose.createConnection(MONGO_URI, { serverSelectionTimeoutMS: 5000 }).asPromise()
  await conn.dropDatabase()
  await conn.close()
}

before(async () => {
  const dbName = new URL(MONGO_URI.replace('mongodb+srv://', 'mongodb://')).pathname.slice(1)
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run: test database name must end in "_test" (got "${dbName}")`)
  }
  await dropTestDatabase()

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      MONGO_URI,
      JWT_SECRET: 'test-secret',
      TICK_RATE: '30',
    },
  })
  serverProcess.stdout.on('data', (d) => (serverOutput += d))
  serverProcess.stderr.on('data', (d) => (serverOutput += d))

  for (let i = 0; i < 75; i++) {
    if (serverProcess.exitCode !== null) break
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {
      // not listening yet
    }
    await sleep(200)
  }
  throw new Error(`Server failed to start:\n${serverOutput}`)
})

after(async () => {
  for (const socket of sockets) socket.close()
  serverProcess?.kill()
  await dropTestDatabase()
})

test('health check reports the database as connected', async () => {
  const { status, data } = await api('/api/health')
  assert.equal(status, 200)
  assert.equal(data.db, 'connected')
})

test('register, duplicate usernames and login', async () => {
  const created = await register('alice')
  assert.equal(created.status, 201)
  assert.ok(created.data.token)
  assert.deepEqual(created.data.garage, { selectedCarColor: '#e63946', accentColor: '#f8f9fa', topSpeedModifier: 1 })

  assert.equal((await register('ALICE')).status, 409, 'usernames are case-insensitive')
  assert.equal((await register('a')).status, 400, 'short usernames are rejected')

  const wrong = await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'nope' } })
  assert.equal(wrong.status, 401)
  const ok = await api('/api/auth/login', { method: 'POST', body: { username: 'Alice', password: 'secret123' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.user.username, 'alice')
})

test('garage requires auth and validates input', async () => {
  const { data } = await register('garage_user')
  assert.equal((await api('/api/garage')).status, 401)

  const updated = await api('/api/garage', {
    method: 'PUT',
    token: data.token,
    body: { selectedCarColor: '#4CC9F0', accentColor: '#FFD60A', topSpeedModifier: 1.15 },
  })
  assert.equal(updated.status, 200)
  assert.deepEqual(updated.data.garage, { selectedCarColor: '#4cc9f0', accentColor: '#ffd60a', topSpeedModifier: 1.15 })

  const reloaded = await api('/api/garage', { token: data.token })
  assert.deepEqual(reloaded.data.garage, updated.data.garage, 'garage persists in MongoDB')

  const invalid = await api('/api/garage', { method: 'PUT', token: data.token, body: { topSpeedModifier: 5 } })
  assert.equal(invalid.status, 400)
  const badAccent = await api('/api/garage', { method: 'PUT', token: data.token, body: { accentColor: 'gold' } })
  assert.equal(badAccent.status, 400)
})

test('sockets reject invalid tokens', async () => {
  await assert.rejects(connect('not-a-token'), /unauthorized/)
})

test('matchmaking, transform relay and lap recording', { timeout: 30000 }, async () => {
  const host = (await register('host_driver')).data
  const guest = (await register('guest_driver')).data
  const hostSocket = await connect(host.token)
  const guestSocket = await connect(guest.token)

  const hostJoin = await ask(hostSocket, 'room:quickJoin')
  const guestJoin = await ask(guestSocket, 'room:quickJoin')
  assert.ok(hostJoin.ok && guestJoin.ok)
  assert.equal(guestJoin.room.id, hostJoin.room.id, 'quick join fills the open lobby')
  assert.equal(guestJoin.room.players.length, 2)

  // Repainting in the lobby is pushed to everyone in the room.
  await api('/api/garage', { method: 'PUT', token: host.token, body: { selectedCarColor: '#2a9d8f', accentColor: '#ffd60a' } })
  const repainted = new Promise((resolve) => {
    guestSocket.on('room:update', (room) => {
      const hostPlayer = room.players.find((p) => p.id === hostSocket.id)
      if (hostPlayer?.color === '#2a9d8f') resolve(hostPlayer)
    })
  })
  assert.equal((await ask(hostSocket, 'garage:refresh')).applied, true)
  assert.equal((await repainted).accentColor, '#ffd60a')

  const notHost = await ask(guestSocket, 'race:start')
  assert.equal(notHost.ok, false)

  const countdown = new Promise((resolve) => guestSocket.once('race:countdown', resolve))
  const go = new Promise((resolve) => hostSocket.once('race:go', resolve))
  assert.ok((await ask(hostSocket, 'race:start')).ok)
  const { startsAt, serverNow } = await countdown
  assert.equal(startsAt - serverNow, 3000)
  await go

  const midRace = await ask(hostSocket, 'garage:refresh')
  assert.equal(midRace.ok, false, 'garage changes are locked while racing')

  // The guest should receive the host's transform in room snapshots.
  const snapshot = new Promise((resolve) => {
    guestSocket.on('room:snapshot', (s) => s.players[hostSocket.id] && resolve(s.players[hostSocket.id]))
  })
  hostSocket.emit('player:transform', { p: [1, 0.6, 40], q: [0, 0.7071, 0, 0.7071], s: 20 })
  assert.deepEqual((await snapshot).p, [1, 0.6, 40])

  hostSocket.emit('race:lapStart')
  await sleep(100)
  const tooFast = await ask(hostSocket, 'race:lap', { lapNumber: 1, lapTimeMs: 100 })
  assert.equal(tooFast.ok, false, 'implausibly fast laps are rejected')

  // The rejection restarted the server's lap clock; drive a believable lap from here.
  const lapStartedAt = Date.now()
  await sleep(8300)
  const lap = await ask(hostSocket, 'race:lap', { lapNumber: 1, lapTimeMs: Date.now() - lapStartedAt })
  assert.equal(lap.ok, true, lap.error)
  assert.equal(lap.lapsCompleted, 1)
  assert.equal(lap.saved, true)
  assert.equal(lap.personalBest, true)

  const board = await api('/api/leaderboard?track=oval-speedway')
  assert.equal(board.data.entries.length, 1)
  assert.equal(board.data.entries[0].username, 'host_driver')
  assert.equal(board.data.entries[0].carColor, '#2a9d8f', 'leaderboard shows the colour the lap was set in')

  const mine = await api('/api/records/me', { token: host.token })
  assert.equal(mine.data.totalLaps, 1)
  assert.equal(mine.data.personalBestMs, lap.lapTimeMs)
})

test('room chat: delivery, history, isolation, validation and rate limiting', { timeout: 15000 }, async () => {
  const alice = (await register('chat_alice')).data
  const bob = (await register('chat_bob')).data
  const eve = (await register('chat_eve')).data
  const aliceSocket = await connect(alice.token)
  const bobSocket = await connect(bob.token)
  const eveSocket = await connect(eve.token)

  assert.equal((await ask(aliceSocket, 'chat:send', { text: 'hello?' })).ok, false, 'chat needs a room')

  const aliceRoom = await ask(aliceSocket, 'room:create')
  const eveRoom = await ask(eveSocket, 'room:create')
  assert.notEqual(aliceRoom.room.id, eveRoom.room.id)

  const eveInbox = []
  eveSocket.on('chat:message', (m) => eveInbox.push(m))

  const received = new Promise((resolve) => {
    aliceSocket.on('chat:message', (m) => m.kind === 'player' && resolve(m))
  })
  const bobJoin = await ask(bobSocket, 'room:join', { roomId: aliceRoom.room.id })
  assert.ok(bobJoin.ok)
  assert.equal(bobJoin.chat.at(-1).text, 'chat_bob joined', 'joiners get the history, including their join notice')

  // Control characters are stripped and the sender comes from the token, not the payload.
  const sent = await ask(bobSocket, 'chat:send', { text: '  gg\u0000  wp \n', username: 'chat_alice' })
  assert.equal(sent.ok, true, sent.error)
  const message = await received
  assert.equal(message.text, 'gg wp')
  assert.equal(message.username, 'chat_bob')
  assert.equal(message.userId, bob.user.id)

  assert.equal((await ask(bobSocket, 'chat:send', { text: '   ' })).ok, false, 'blank messages are rejected')
  assert.equal((await ask(bobSocket, 'chat:send', { text: 'x'.repeat(201) })).ok, false, 'long messages are rejected')
  assert.equal((await ask(bobSocket, 'chat:send', { text: 42 })).ok, false, 'non-text is rejected')

  // One message already counts toward the 5-per-10s window.
  const burst = []
  for (let i = 0; i < 5; i++) burst.push(await ask(bobSocket, 'chat:send', { text: `spam ${i}` }))
  assert.deepEqual(burst.map((r) => r.ok), [true, true, true, true, false])
  assert.match(burst[4].error, /too quickly/)

  const leftNotice = new Promise((resolve) => {
    aliceSocket.on('chat:message', (m) => m.kind === 'system' && m.text === 'chat_bob left' && resolve(m))
  })
  await ask(bobSocket, 'room:leave')
  await leftNotice

  const rejoin = await ask(bobSocket, 'room:join', { roomId: aliceRoom.room.id })
  assert.ok(rejoin.chat.some((m) => m.text === 'gg wp'), 'history survives while the room exists')

  await sleep(100)
  assert.ok(
    eveInbox.every((m) => m.kind === 'system' && m.text === 'chat_eve joined'),
    'messages never leak into other rooms',
  )
})
