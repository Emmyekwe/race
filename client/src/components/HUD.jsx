import { useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../state/store.js'
import { telemetry } from '../state/telemetry.js'
import { useLeaderboard } from '../hooks/useLeaderboard.js'
import { formatLapTime, ordinal } from '../utils/format.js'

const SPEEDO_MAX_KMH = 200

function centerMessage(state, now) {
  if (state.countdownEndsAt !== null && now < state.countdownEndsAt) {
    return String(Math.ceil((state.countdownEndsAt - now) / 1000))
  }
  if (state.room?.status === 'countdown') return 'GET READY'
  if (state.goAt !== null && now - state.goAt < 1200) return 'GO!'
  return ''
}

function sortStandings(players) {
  return [...players].sort((a, b) => {
    if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted
    const aFinish = a.finishTimeMs ?? Number.POSITIVE_INFINITY
    const bFinish = b.finishTimeMs ?? Number.POSITIVE_INFINITY
    if (aFinish !== bFinish) return aFinish - bFinish
    return a.slot - b.slot
  })
}

/** Race overlay. Speed, timers and countdown update via refs in a rAF loop — no per-frame React renders. */
export default function HUD() {
  const room = useGameStore((s) => s.room)
  const selfId = useGameStore((s) => s.selfId)
  const username = useGameStore((s) => s.auth?.user?.username)
  const currentLap = useGameStore((s) => s.currentLap)
  const lastLapMs = useGameStore((s) => s.lastLapMs)
  const bestLapMs = useGameStore((s) => s.bestLapMs)
  const finished = useGameStore((s) => s.finished)
  const lapStarted = useGameStore((s) => s.lapStartedAt !== null)
  const leaderboard = useLeaderboard(room.trackName, 8)

  const speedRef = useRef(null)
  const speedBarRef = useRef(null)
  const lapTimeRef = useRef(null)
  const centerRef = useRef(null)
  const graceRef = useRef(null)

  useEffect(() => {
    let frame = 0
    let lastCenter = null
    const tick = () => {
      const s = useGameStore.getState()
      const now = performance.now()
      const kmh = telemetry.speedKmh

      if (speedRef.current) speedRef.current.textContent = String(Math.round(kmh))
      if (speedBarRef.current) speedBarRef.current.style.transform = `scaleX(${Math.min(kmh / SPEEDO_MAX_KMH, 1)})`
      if (lapTimeRef.current) {
        lapTimeRef.current.textContent = formatLapTime(s.lapStartedAt === null ? 0 : now - s.lapStartedAt)
      }
      const center = centerMessage(s, now)
      if (centerRef.current && center !== lastCenter) {
        lastCenter = center
        centerRef.current.textContent = center
        centerRef.current.dataset.visible = center ? 'true' : 'false'
      }
      if (graceRef.current) {
        graceRef.current.textContent =
          s.finishGraceEndsAt !== null
            ? `Race closes in ${Math.max(0, Math.ceil((s.finishGraceEndsAt - now) / 1000))}s`
            : ''
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const standings = useMemo(() => sortStandings(room.players), [room.players])
  const displayLap = Math.min(currentLap + 1, room.totalLaps)

  return (
    <div className="hud">
      <div className="hud-panel hud-laps">
        <div className="hud-label">Lap</div>
        <div className="hud-big">
          {finished ? room.totalLaps : displayLap}
          <span className="hud-dim">/{room.totalLaps}</span>
        </div>
        <div className="hud-label">Lap time</div>
        <div className="hud-time" ref={lapTimeRef}>
          0:00.000
        </div>
        <div className="hud-row">
          <span className="hud-label">Last</span>
          <span className="mono">{formatLapTime(lastLapMs)}</span>
        </div>
        <div className="hud-row">
          <span className="hud-label">Best</span>
          <span className="mono">{formatLapTime(bestLapMs)}</span>
        </div>
        {!lapStarted && !finished && room.status === 'racing' && (
          <div className="hud-hint">Timing starts at the line</div>
        )}
      </div>

      <div className="hud-panel hud-standings">
        <div className="hud-title">Race</div>
        <ol>
          {standings.map((p, i) => (
            <li key={p.id} className={p.id === selfId ? 'is-self' : ''}>
              <span className="pos">{ordinal(i + 1)}</span>
              <span className="dot" style={{ background: p.color }} />
              <span className="name">{p.username}</span>
              <span className="mono small">
                {p.finishTimeMs !== null ? formatLapTime(p.finishTimeMs) : `L${p.lapsCompleted}`}
              </span>
            </li>
          ))}
        </ol>
        <div className="hud-title">Fastest laps</div>
        {leaderboard.error && <div className="hud-hint">{leaderboard.error}</div>}
        {!leaderboard.error && leaderboard.entries.length === 0 && (
          <div className="hud-hint">{leaderboard.loading ? 'Loading…' : 'No laps recorded yet'}</div>
        )}
        <ol>
          {leaderboard.entries.map((entry) => (
            <li key={entry.userId} className={entry.username === username ? 'is-self' : ''}>
              <span className="pos">{entry.rank}</span>
              <span className="name">{entry.username}</span>
              <span className="mono small">{formatLapTime(entry.lapTimeMs)}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="hud-center" ref={centerRef} data-visible="false" />

      {finished && (
        <div className="hud-finished">
          <div className="hud-finished-title">FINISHED!</div>
          <div>Waiting for the other racers…</div>
          <div className="hud-dim" ref={graceRef} />
        </div>
      )}

      <div className="hud-panel hud-speed">
        <div>
          <span className="hud-speed-value" ref={speedRef}>
            0
          </span>
          <span className="hud-speed-unit">KM/H</span>
        </div>
        <div className="speed-bar">
          <div className="speed-bar-fill" ref={speedBarRef} />
        </div>
      </div>

      <div className="hud-controls">
        <kbd>W</kbd>/<kbd>↑</kbd> throttle · <kbd>S</kbd>/<kbd>↓</kbd> brake/reverse · <kbd>A</kbd>
        <kbd>D</kbd>/<kbd>←</kbd>
        <kbd>→</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>R</kbd> reset
      </div>
    </div>
  )
}
