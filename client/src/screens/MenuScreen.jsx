import { useEffect, useState } from 'react'
import { api } from '../net/api.js'
import { request } from '../net/socket.js'
import { useGameStore } from '../state/store.js'
import { accelerationFactor, GARAGE, TRACK_NAME } from '../game/constants.js'
import { formatLapTime } from '../utils/format.js'
import LeaderboardTable from '../components/LeaderboardTable.jsx'

function CarPreview({ color }) {
  return (
    <svg className="car-preview" viewBox="0 0 120 64" aria-hidden="true">
      <rect x="18" y="6" width="14" height="12" rx="3" fill="#111" />
      <rect x="88" y="6" width="14" height="12" rx="3" fill="#111" />
      <rect x="18" y="46" width="14" height="12" rx="3" fill="#111" />
      <rect x="88" y="46" width="14" height="12" rx="3" fill="#111" />
      <rect x="8" y="12" width="104" height="40" rx="12" fill={color} />
      <rect x="40" y="18" width="34" height="28" rx="6" fill="#0f172a" />
      <rect x="78" y="28" width="30" height="8" rx="2" fill="#f8f9fa" opacity="0.85" />
      <rect x="4" y="16" width="6" height="32" rx="2" fill={color} />
    </svg>
  )
}

export default function MenuScreen() {
  const auth = useGameStore((s) => s.auth)
  const garage = useGameStore((s) => s.garage)
  const connection = useGameStore((s) => s.connection)
  const setGarage = useGameStore((s) => s.setGarage)
  const setRoom = useGameStore((s) => s.setRoom)
  const logout = useGameStore((s) => s.logout)

  const [color, setColor] = useState(garage?.selectedCarColor ?? GARAGE.defaultColor)
  const [modifier, setModifier] = useState(garage?.topSpeedModifier ?? 1)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [records, setRecords] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const onError = (err) => {
      if (err.status === 401) logout()
      else if (!cancelled) setError(err.message)
    }
    api
      .getGarage(auth.token)
      .then(({ garage: loaded }) => !cancelled && setGarage(loaded))
      .catch(onError)
    api
      .myRecords(auth.token, TRACK_NAME)
      .then((data) => !cancelled && setRecords(data))
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [auth.token, setGarage, logout])

  useEffect(() => {
    if (!garage) return
    setColor(garage.selectedCarColor)
    setModifier(garage.topSpeedModifier)
  }, [garage])

  const dirty = garage !== null && (color !== garage.selectedCarColor || modifier !== garage.topSpeedModifier)

  const saveGarage = async () => {
    setSaveState('saving')
    try {
      const { garage: saved } = await api.updateGarage(auth.token, {
        selectedCarColor: color,
        topSpeedModifier: modifier,
      })
      setGarage(saved)
      setSaveState('saved')
      return true
    } catch (err) {
      if (err.status === 401) logout()
      setSaveState('error')
      setError(err.message)
      return false
    }
  }

  // The server reads the garage when you join a room, so unsaved tweaks are saved first.
  const joinWith = async (event, payload) => {
    setError(null)
    setBusy(true)
    try {
      if (dirty && !(await saveGarage())) return
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
          <span className={`status-dot ${connection}`} title={connection} />
          <span>{auth.user.username}</span>
          <button type="button" className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>Garage</h2>
          <CarPreview color={color} />
          <div className="swatches">
            {GARAGE.swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`swatch ${swatch === color ? 'selected' : ''}`}
                style={{ background: swatch }}
                onClick={() => {
                  setColor(swatch)
                  setSaveState('idle')
                }}
                aria-label={`Colour ${swatch}`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value.toLowerCase())
                setSaveState('idle')
              }}
              aria-label="Custom colour"
            />
          </div>

          <label className="slider">
            <span>
              Top speed modifier <strong>×{modifier.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min={GARAGE.minSpeedModifier}
              max={GARAGE.maxSpeedModifier}
              step={0.05}
              value={modifier}
              onChange={(e) => {
                setModifier(Math.round(Number(e.target.value) * 100) / 100)
                setSaveState('idle')
              }}
            />
            <span className="muted small">
              Top speed ×{modifier.toFixed(2)} · Acceleration ×{accelerationFactor(modifier).toFixed(2)}
            </span>
          </label>

          <button
            type="button"
            className="btn"
            onClick={saveGarage}
            disabled={!dirty || saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' && !dirty ? 'Saved ✓' : 'Save garage'}
          </button>
        </section>

        <section className="card">
          <h2>Race</h2>
          <p className="muted">{TRACK_NAME} · 3 laps · up to 6 drivers</p>
          <div className="stack">
            <button
              type="button"
              className="btn primary big"
              disabled={!online || busy}
              onClick={() => joinWith('room:quickJoin')}
            >
              Quick race
            </button>
            <button
              type="button"
              className="btn"
              disabled={!online || busy}
              onClick={() => joinWith('room:create')}
            >
              Create private room
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
          <h2>Fastest laps</h2>
          <LeaderboardTable trackName={TRACK_NAME} highlightUsername={auth.user.username} />
        </section>
      </main>
    </div>
  )
}
