import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../state/store.js'
import LeaderboardTable from './LeaderboardTable.jsx'

/**
 * Global top-10 fastest laps. Mount it only while open: it fetches on mount and
 * refetches live whenever the server announces a new lap (`leaderboard:changed`).
 */
export default function LeaderboardModal({ trackName, onClose }) {
  const username = useGameStore((s) => s.auth?.user?.username)
  const closeButton = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement
    closeButton.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <header className="modal-header">
          <h2 id="leaderboard-title">Global leaderboard</h2>
          <span className="live-badge">LIVE</span>
          <button ref={closeButton} type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted small">{trackName} · best lap per driver · top 10</p>
        <LeaderboardTable trackName={trackName} highlightUsername={username} limit={10} showDate />
      </div>
    </div>,
    document.body,
  )
}
