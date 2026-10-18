import { useEffect, useState } from 'react'
import { api } from '../net/api.js'
import { request } from '../net/socket.js'
import { useGameStore } from '../state/store.js'
import { TRACK_NAME } from '../game/constants.js'
import { formatLapTime } from '../utils/format.js'
import GarageUI from '../components/GarageUI.jsx'
import LeaderboardModal from '../components/LeaderboardModal.jsx'
import LeaderboardTable from '../components/LeaderboardTable.jsx'

export default function MenuScreen() {
  const auth = useGameStore((s) => s.auth)
  const connection = useGameStore((s) => s.connection)
  const setRoom = useGameStore((s) => s.setRoom)
  const logout = useGameStore((s) => s.logout)

  const [records, setRecords] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .myRecords(auth.token, TRACK_NAME)
      .then((data) => !cancelled && setRecords(data))
      .catch((err) => {
        if (err.status === 401) logout()
        else if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [auth.token, logout])

  const joinWith = async (event, payload) => {
    setError(null)
    setBusy(true)
    try {
      const res = await request(event, payload)
      setRoom(res.room)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const online = connection === 'connected'

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="logo small">
          ARCADE<span>RACER</span>
        </h1>
        <div className="topbar-right">
          <button type="button" className="btn ghost" onClick={() => setShowLeaderboard(true)}>
            🏆 Leaderboard
          </button>
          <span className={`status-dot ${connection}`} title={connection} />
          <span>{auth.user.username}</span>
          <button type="button" className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="grid">
        <GarageUI />

        <section className="card">
          <h2>Race</h2>
          <p className="muted capitalize">{TRACK_NAME} · 3 laps · up to 6 drivers</p>
          <div className="stack">
            <button
              type="button"
              className="btn primary big"
              disabled={!online || busy}
              onClick={() => joinWith('room:quickJoin')}
            >
              Quick Race
            </button>
            <button
              type="button"
              className="btn"
              disabled={!online || busy}
              onClick={() => joinWith('room:create')}
            >
              Create Private Room
            </button>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                joinWith('room:join', { roomId: roomCode.trim() })
              }}
            >
              <input
                placeholder="Room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button type="submit" className="btn" disabled={!online || busy || roomCode.trim().length !== 6}>
                Join
              </button>
            </form>
          </div>
          {!online && <p className="muted">Connecting to the game server…</p>}
          {error && <p className="error">{error}</p>}

          <h3>Your stats</h3>
          <div className="stats">
            <div>
              <div className="muted small">Personal best</div>
              <div className="mono stat">{formatLapTime(records?.personalBestMs)}</div>
            </div>
            <div>
              <div className="muted small">Laps recorded</div>
              <div className="mono stat">{records?.totalLaps ?? '–'}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title-row">
            <h2>Fastest laps</h2>
            <button type="button" className="btn ghost small" onClick={() => setShowLeaderboard(true)}>
              View top 10
            </button>
          </div>
          <LeaderboardTable trackName={TRACK_NAME} highlightUsername={auth.user.username} limit={5} />
        </section>
      </main>

      {showLeaderboard && <LeaderboardModal trackName={TRACK_NAME} onClose={() => setShowLeaderboard(false)} />}
    </div>
  )
}
