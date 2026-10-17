import { io } from 'socket.io-client'

let socket = null

/** Opens the game connection. Same-origin: Vite proxies /socket.io to the server in development. */
export function connectSocket(token) {
  if (socket) socket.disconnect()
  socket = io({
    auth: { token },
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  })
  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
  }
  socket = null
}

/** Emits an event and resolves with the server's `{ ok: true, ... }` acknowledgement. */
export function request(event, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to the game server'))
      return
    }
    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) reject(new Error('The game server did not respond'))
      else if (!response?.ok) reject(new Error(response?.error || 'Request failed'))
      else resolve(response)
    })
  })
}
