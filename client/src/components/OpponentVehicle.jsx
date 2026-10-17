import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { CarBody, WheelMesh } from './CarModel.jsx'
import { sampleRemoteTransform } from '../net/interpolation.js'
import { VEHICLE, WHEEL_OFFSETS } from '../game/constants.js'

/** A remote player's car: no physics, just a smoothly interpolated replay of server snapshots. */
export default function OpponentVehicle({ id, username, color }) {
  const group = useRef(null)
  const label = useRef(null)
  const wheel0 = useRef(null)
  const wheel1 = useRef(null)
  const wheel2 = useRef(null)
  const wheel3 = useRef(null)
  const wheelRefs = [wheel0, wheel1, wheel2, wheel3]
  const wheelSpin = useRef(0)
  const sample = useMemo(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), speed: 0 }), [])

  useFrame((_, delta) => {
    const car = group.current
    if (!car) return
    const visible = sampleRemoteTransform(id, sample)
    if (car.visible !== visible) {
      car.visible = visible
      if (label.current) label.current.style.display = visible ? '' : 'none'
    }
    if (!visible) return

    car.position.copy(sample.position)
    car.quaternion.copy(sample.quaternion)
    wheelSpin.current = (wheelSpin.current + (sample.speed * Math.min(delta, 0.1)) / VEHICLE.wheelRadius) % (Math.PI * 2)
    for (const wheel of wheelRefs) {
      if (wheel.current) wheel.current.rotation.x = wheelSpin.current
    }
  })

  return (
    <group ref={group} visible={false}>
      <CarBody color={color} />
      {WHEEL_OFFSETS.map((offset, i) => (
        <group key={i} ref={wheelRefs[i]} position={offset}>
          <WheelMesh />
        </group>
      ))}
      <Html position={[0, 1.9, 0]} center distanceFactor={14} zIndexRange={[20, 0]}>
        <div ref={label} className="nametag" style={{ display: 'none', borderColor: color }}>
          {username}
        </div>
      </Html>
    </group>
  )
}
