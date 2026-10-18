import { useLeaderboard } from '../hooks/useLeaderboard.js'
import { formatLapTime } from '../utils/format.js'

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

export default function LeaderboardTable({ trackName, highlightUsername, limit = 10, showDate = false }) {
  const { entries, loading, error } = useLeaderboard(trackName, limit)

  if (error) return <p className="muted">Couldn’t load leaderboard: {error}</p>
  if (loading && entries.length === 0) return <p className="muted">Loading…</p>
  if (entries.length === 0) return <p className="muted">No laps recorded yet — be the first!</p>

  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Driver</th>
          <th className="right">Best lap</th>
          {showDate && <th className="right">Set on</th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.userId} className={entry.username === highlightUsername ? 'is-self' : ''}>
            <td>{entry.rank}</td>
            <td>
              <span className="dot" style={{ background: entry.carColor ?? '#64748b' }} /> {entry.username}
            </td>
            <td className="right mono">{formatLapTime(entry.lapTimeMs)}</td>
            {showDate && <td className="right muted">{dateFormat.format(new Date(entry.createdAt))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
