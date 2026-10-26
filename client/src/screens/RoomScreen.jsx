import { useState } from 'react'
import { request } from '../net/socket.js'
import { useGameStore } from '../state/store.js'
import { formatLapTime, ordinal } from '../utils/format.js'
import ChatPanel from '../components/ChatPanel.jsx'
import GarageUI from '../components/GarageUI.jsx'
import LeaderboardModal from '../components/LeaderboardModal.jsx'

export default function RoomScreen() {
  const room = useGameStore((s) => s.room)
  const selfId = useGameStore((s) => s.selfId)
  const connection = useGameStore((s) => s.connection)
  const setRoom = useGameStore((s) => s.setRoom)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  const isHost = room.hostId === selfId
  const results = room.lastResults

  const startRace = async () => {
    setError(null)
    setBusy(true)
    try {
      await request('race:start')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    try {
      await request('room:leave')
    } catch {
      // Leaving locally is fine even if the server is unreachable; it drops us on disconnect.
    }
    setRoom(null)
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

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
          <button type="button" className="btn ghost" onClick={leave}>
            Leave room
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>
            Room{' '}
            <button type="button" className="room-code" onClick={copyCode} title="Copy room code">
              {room.id}
            </button>
            {copied && <span className="muted small"> copied!</span>}
          </h2>
          <p className="muted">
            {room.isPrivate ? 'Private room — share the code with friends' : 'Public lobby'} · {room.trackName} ·{' '}
            {room.totalLaps} laps
          </p>

          <ul className="player-list">
            {room.players.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                <span className="name">
                  {p.username}
                  {p.id === selfId && <span className="muted"> (you)</span>}
                </span>
                {p.id === room.hostId && <span className="badge">HOST</span>}
                <span className="muted small">grid {p.slot + 1}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {room.players.length}/{room.maxPlayers} drivers
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn primary big"
              disabled={busy || connection !== 'connected'}
              onClick={startRace}
            >
              {results ? 'Race again' : 'Start race'}
            </button>
          ) : (
            <p className="waiting">Waiting for the host to start the race…</p>
          )}
          {error && <p className="error">{error}</p>}
        </section>

        <ChatPanel />

        <GarageUI />

        {results && (
          <section className="card">
            <h2>Last race</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Driver</th>
                  <th className="right">Best lap</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className={r.id === selfId ? 'is-self' : ''}>
                    <td>{ordinal(r.position)}</td>
                    <td>
                      <span className="dot" style={{ background: r.color }} /> {r.username}
                    </td>
                    <td className="right mono">{formatLapTime(r.bestLapMs)}</td>
                    <td className="right mono">
                      {r.finishTimeMs !== null ? formatLapTime(r.finishTimeMs) : `DNF (${r.lapsCompleted} laps)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

      </main>

      {showLeaderboard && <LeaderboardModal trackName={room.trackName} onClose={() => setShowLeaderboard(false)} />}
    </div>
  )
}
