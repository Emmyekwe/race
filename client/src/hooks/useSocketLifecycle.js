import { useEffect } from 'react'
import { connectSocket, disconnectSocket } from '../net/socket.js'
import { clearSnapshots, pushSnapshot, removeRemotePlayer } from '../net/interpolation.js'
import { useGameStore } from '../state/store.js'

/** Owns the Socket.io connection for the logged-in user and routes server events into the store. */
export function useSocketLifecycle() {
  const token = useGameStore((s) => s.auth?.token)

  useEffect(() => {
    if (!token) return undefined
    const store = useGameStore.getState
    const socket = connectSocket(token)
    store().setConnection('connecting')

    socket.on('connect', () => store().setConnection('connected', socket.id))

    socket.on('disconnect', (reason) => {
      // The server drops us from our room on disconnect, so return to the menu.
      clearSnapshots()
      useGameStore.setState({ connection: 'disconnected', room: null })
      if (reason !== 'io client disconnect') store().showNotice('Connection lost — reconnecting…')
    })

    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        store().showNotice('Your session expired, please log in again')
        store().logout()
      } else {
        store().setConnection('disconnected')
      }
    })

    socket.on('room:update', (room) => store().setRoom(room))
    socket.on('room:snapshot', pushSnapshot)
    socket.on('player:left', ({ id }) => removeRemotePlayer(id))

    socket.on('race:countdown', ({ startsAt, serverNow }) => {
      clearSnapshots()
      store().beginCountdown(startsAt - serverNow)
    })
    socket.on('race:go', () => store().beginRace())
    socket.on('race:finishCountdown', ({ msRemaining }) => store().setFinishGrace(msRemaining))
    socket.on('race:ended', () => clearSnapshots())

    return () => {
      clearSnapshots()
      disconnectSocket()
    }
  }, [token])
}
