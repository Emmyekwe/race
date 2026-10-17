import { create } from 'zustand'
import { getSocket } from '../net/socket.js'
import { telemetry } from './telemetry.js'

// sessionStorage (not localStorage) so two browser tabs can be logged in as
// different players — handy for testing multiplayer on one machine.
const AUTH_STORAGE_KEY = 'arcade-racer.auth'

function loadAuth() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.token && parsed?.user ? parsed : null
  } catch {
    return null
  }
}

function saveAuth(auth) {
  try {
    if (auth) sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
    else sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode etc.): the session simply won't survive a reload.
  }
}

const initialRaceState = () => ({
  countdownEndsAt: null, // performance.now() timestamps
  goAt: null,
  lapStartedAt: null,
  currentLap: 0,
  lastLapMs: null,
  bestLapMs: null,
  checkpointPassed: false,
  finished: false,
  finishGraceEndsAt: null,
})

export const useGameStore = create((set, get) => ({
  auth: loadAuth(), // { token, user: { id, username } }
  garage: null, // { selectedCarColor, topSpeedModifier }
  connection: 'disconnected', // 'connecting' | 'connected' | 'disconnected'
  selfId: null, // our socket id
  room: null, // serialized room from the server
  notice: null, // { id, message } transient toast
  ...initialRaceState(),

  setSession: ({ token, user, garage }) => {
    const auth = { token, user }
    saveAuth(auth)
    set({ auth, garage: garage ?? null })
  },

  logout: () => {
    saveAuth(null)
    set({ auth: null, garage: null, room: null, selfId: null, connection: 'disconnected', ...initialRaceState() })
  },

  setGarage: (garage) => set({ garage }),
  setConnection: (connection, selfId) => set((s) => ({ connection, selfId: selfId ?? s.selfId })),
  setRoom: (room) => set({ room }),

  showNotice: (message) => set({ notice: { id: `${Date.now()}-${Math.random()}`, message } }),
  clearNotice: () => set({ notice: null }),

  beginCountdown: (msUntilStart) =>
    set({ ...initialRaceState(), countdownEndsAt: performance.now() + Math.max(0, msUntilStart) }),
  beginRace: () => set({ countdownEndsAt: null, goAt: performance.now() }),
  setFinishGrace: (msRemaining) => set({ finishGraceEndsAt: performance.now() + msRemaining }),

  // Called by the halfway checkpoint trigger. A lap only counts once this has been passed.
  passCheckpoint: () => {
    const s = get()
    if (s.room?.status === 'racing' && s.lapStartedAt !== null && !s.checkpointPassed) {
      set({ checkpointPassed: true })
    }
  },

  // Called by the start/finish line trigger.
  crossFinishLine: () => {
    const s = get()
    if (s.room?.status !== 'racing' || s.finished) return
    // Only crossings in the race direction (+X on the start/finish straight) count.
    if (telemetry.velocity[0] <= 0.5) return

    const now = performance.now()
    const socket = getSocket()

    // First crossing after the standing start begins lap 1 (cars start behind the line).
    if (s.lapStartedAt === null) {
      set({ lapStartedAt: now, checkpointPassed: false })
      socket?.emit('race:lapStart')
      return
    }
    if (!s.checkpointPassed) return

    const lapTimeMs = Math.round(now - s.lapStartedAt)
    const lapNumber = s.currentLap + 1
    const finished = lapNumber >= s.room.totalLaps
    set({
      currentLap: lapNumber,
      lastLapMs: lapTimeMs,
      bestLapMs: s.bestLapMs === null ? lapTimeMs : Math.min(s.bestLapMs, lapTimeMs),
      lapStartedAt: finished ? null : now,
      checkpointPassed: false,
      finished,
    })

    if (!socket) return
    socket.timeout(5000).emit('race:lap', { lapNumber, lapTimeMs }, (err, res) => {
      if (err) {
        get().showNotice('Lap not confirmed by the server')
        return
      }
      if (res?.ok) {
        set({ currentLap: res.lapsCompleted, bestLapMs: res.bestLapMs, finished: res.finished })
        if (!res.saved) get().showNotice('Lap counted, but could not be saved to the database')
        else if (res.personalBest) get().showNotice(`New personal best! ${(lapTimeMs / 1000).toFixed(3)}s`)
        return
      }
      // Rejected: the server restarted its lap clock at this crossing — mirror it locally.
      set((cur) => ({
        currentLap: typeof res?.lapsCompleted === 'number' ? res.lapsCompleted : cur.currentLap,
        bestLapMs: res?.bestLapMs ?? null,
        finished: Boolean(res?.finished),
        lapStartedAt: res?.finished ? null : (cur.lapStartedAt ?? now),
      }))
      get().showNotice(`Lap not counted: ${res?.error ?? 'unknown error'}`)
    })
  },
}))
