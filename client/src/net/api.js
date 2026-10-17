async function apiFetch(path, { method = 'GET', body, token, signal } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    // Non-JSON (e.g. proxy error page): fall through to the status-based message.
  }

  if (!res.ok) {
    const message =
      data?.error || (res.status >= 500 ? 'Game server unavailable — is it running?' : `Request failed (${res.status})`)
    const error = new Error(message)
    error.status = res.status
    throw error
  }
  return data
}

export const api = {
  register: (username, password) => apiFetch('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => apiFetch('/auth/login', { method: 'POST', body: { username, password } }),
  me: (token) => apiFetch('/auth/me', { token }),
  getGarage: (token) => apiFetch('/garage', { token }),
  updateGarage: (token, garage) => apiFetch('/garage', { method: 'PUT', body: garage, token }),
  leaderboard: (trackName, limit = 10, signal) =>
    apiFetch(`/leaderboard?track=${encodeURIComponent(trackName)}&limit=${limit}`, { signal }),
  myRecords: (token, trackName) => apiFetch(`/records/me?track=${encodeURIComponent(trackName)}`, { token }),
}
