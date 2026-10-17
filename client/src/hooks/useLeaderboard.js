import { useEffect, useState } from 'react'
import { api } from '../net/api.js'
import { getSocket } from '../net/socket.js'
import { useGameStore } from '../state/store.js'

const REFRESH_INTERVAL_MS = 30000

/** All-time fastest laps for a track, refreshed whenever the server reports a new lap. */
export function useLeaderboard(trackName, limit = 10) {
  const [state, setState] = useState({ entries: [], loading: true, error: null })
  // Re-subscribe once the socket (re)connects so we hear `leaderboard:changed`.
  const connection = useGameStore((s) => s.connection)

  useEffect(() => {
    let cancelled = false
    let controller = null

    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const data = await api.leaderboard(trackName, limit, controller.signal)
        if (!cancelled) setState({ entries: data.entries, loading: false, error: null })
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') {
          setState((prev) => ({ ...prev, loading: false, error: err.message }))
        }
      }
    }

    load()
    const socket = getSocket()
    const onChanged = (payload) => {
      if (!payload || payload.trackName === trackName) load()
    }
    socket?.on('leaderboard:changed', onChanged)
    const interval = setInterval(load, REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      controller?.abort()
      socket?.off('leaderboard:changed', onChanged)
      clearInterval(interval)
    }
  }, [trackName, limit, connection])

  return state
}
