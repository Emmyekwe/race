import { VEHICLE } from '../game/constants.js'

// Shared visuals for the local and remote cars. The car's front is +Z.

export function CarBody({ color }) {
  return (
    <group>
      {/* Main body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.55, 4.1]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.35} />
      </mesh>
      {/* Lower skirt */}
      <mesh position={[0, -0.22, 0]}>
        <boxGeometry args={[1.74, 0.14, 4.14]} />
        <meshStandardMaterial color="#1f2937" roughness={0.8} />
      </mesh>
      {/* Cabin / glass */}
      <mesh castShadow position={[0, 0.48, -0.25]}>
        <boxGeometry args={[1.35, 0.45, 1.9]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.12} />
      </mesh>
      {/* Racing stripe */}
      <mesh position={[0, 0.281, 0.9]}>
        <boxGeometry args={[0.35, 0.01, 2.2]} />
        <meshStandardMaterial color="#f8f9fa" roughness={0.5} />
      </mesh>
      {/* Rear wing */}
      <mesh castShadow position={[0, 0.62, -1.85]}>
        <boxGeometry args={[1.6, 0.08, 0.42]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.35} />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.42, -1.85]}>
          <boxGeometry args={[0.08, 0.32, 0.15]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      ))}
      {/* Headlights */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={`head-${x}`} position={[x, 0.05, 2.06]}>
          <boxGeometry args={[0.38, 0.14, 0.04]} />
          <meshStandardMaterial color="#fff8d6" emissive="#fff3b0" emissiveIntensity={1.4} />
        </mesh>
      ))}
      {/* Tail lights */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={`tail-${x}`} position={[x, 0.08, -2.06]}>
          <boxGeometry args={[0.4, 0.12, 0.04]} />
          <meshStandardMaterial color="#ff1f3d" emissive="#ff0022" emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  )
}

export function WheelMesh() {
  const r = VEHICLE.wheelRadius
  const w = VEHICLE.wheelWidth
  // Cylinders are Y-aligned by default; rotate so the axle runs along X.
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, w, 24]} />
        <meshStandardMaterial color="#141414" roughness={0.9} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, w + 0.02, 6]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} />
      </mesh>
    </group>
  )
}
