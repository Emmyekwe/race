import { useState } from 'react'
import { api } from '../net/api.js'
import { useGameStore } from '../state/store.js'

export default function AuthScreen() {
  const setSession = useGameStore((s) => s.setSession)
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isLogin = mode === 'login'

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const session = isLogin ? await api.login(username.trim(), password) : await api.register(username.trim(), password)
      setSession(session)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen center">
      <div className="card auth-card">
        <h1 className="logo">
          ARCADE<span>RACER</span>
        </h1>
        <p className="muted">Real-time multiplayer oval racing</p>

        <div className="tabs">
          <button type="button" className={isLogin ? 'active' : ''} onClick={() => setMode('login')}>
            Log in
          </button>
          <button type="button" className={!isLogin ? 'active' : ''} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="form">
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]+"
              title="Letters, numbers and underscores"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              minLength={6}
              maxLength={128}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
