import { useSocketLifecycle } from './hooks/useSocketLifecycle.js'
import { useGameStore } from './state/store.js'
import AuthScreen from './screens/AuthScreen.jsx'
import MenuScreen from './screens/MenuScreen.jsx'
import RoomScreen from './screens/RoomScreen.jsx'
import Game from './components/Game.jsx'
import HUD from './components/HUD.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  useSocketLifecycle()
  const auth = useGameStore((s) => s.auth)
  const room = useGameStore((s) => s.room)
  const connection = useGameStore((s) => s.connection)

  let screen
  if (!auth) {
    screen = <AuthScreen />
  } else if (!room) {
    screen = <MenuScreen />
  } else if (room.status === 'lobby') {
    screen = <RoomScreen />
  } else {
    screen = (
      <div className="game-root">
        <Game />
        <HUD />
      </div>
    )
  }

  return (
    <>
      {auth && connection === 'disconnected' && (
        <div className="connection-banner">Disconnected from the game server — retrying…</div>
      )}
      {screen}
      <Toast />
    </>
  )
}
