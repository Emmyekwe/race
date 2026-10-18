import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/cannon'
import RaceTrack from './RaceTrack.jsx'
import Vehicle from './Vehicle.jsx'
import OpponentVehicle from './OpponentVehicle.jsx'
import { useGameStore } from '../state/store.js'

const SKY = '#8ec5ff'

export default function Game() {
  const room = useGameStore((s) => s.room)
  const selfId = useGameStore((s) => s.selfId)
  const self = room.players.find((p) => p.id === selfId)
  const opponents = room.players.filter((p) => p.id !== selfId)

  return (
    <Canvas className="game-canvas" shadows dpr={[1, 2]} camera={{ fov: 60, near: 0.1, far: 800, position: [-30, 12, 70] }}>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 140, 460]} />
      <hemisphereLight args={['#ffffff', '#3d5a2e', 0.65]} />
      <directionalLight
        castShadow
        position={[60, 90, 40]}
        intensity={1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-130}
        shadow-camera-right={130}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={300}
      />

      <Physics broadphase="SAP" gravity={[0, -9.81, 0]} defaultContactMaterial={{ friction: 0.02, restitution: 0.05 }}>
        <RaceTrack />
        {self && (
          <Vehicle
            slot={self.slot}
            color={self.color}
            accentColor={self.accentColor}
            topSpeedModifier={self.topSpeedModifier}
          />
        )}
      </Physics>

      {opponents.map((p) => (
        <OpponentVehicle key={p.id} id={p.id} username={p.username} color={p.color} accentColor={p.accentColor} />
      ))}
    </Canvas>
  )
}
