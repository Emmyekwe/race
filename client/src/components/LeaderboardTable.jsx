import { useLeaderboard } from '../hooks/useLeaderboard.js'
import { formatLapTime } from '../utils/format.js'

export default function LeaderboardTable({ trackName, highlightUsername, limit = 10 }) {
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
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.userId} className={entry.username === highlightUsername ? 'is-self' : ''}>
            <td>{entry.rank}</td>
            <td>{entry.username}</td>
            <td className="right mono">{formatLapTime(entry.lapTimeMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
