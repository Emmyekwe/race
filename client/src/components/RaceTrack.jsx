import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useBox, usePlane } from '@react-three/cannon'
import * as THREE from 'three'
import { TRACK } from '../game/constants.js'
import { CHECKPOINT, distanceToCenterLine, FINISH_LINE, loopSegments, stadiumLoop } from '../game/trackMath.js'
import { useGameStore } from '../state/store.js'

const { radius: R, roadWidth: W, wallHeight: WALL_H, wallThickness: WALL_T } = TRACK

function Ground() {
  const [ref] = usePlane(() => ({ type: 'Static', rotation: [-Math.PI / 2, 0, 0], position: [0, 0, 0] }), useRef(null))
  return (
    <mesh ref={ref} receiveShadow>
      <planeGeometry args={[900, 900]} />
      <meshStandardMaterial color="#4c8c3f" roughness={1} />
    </mesh>
  )
}

/** Flat road surface: the outer stadium shape with the inner one cut out as a hole. Visual only — the ground plane carries the physics. */
function Road() {
  const geometry = useMemo(() => {
    // Shapes live in XY; after rotating -90° about X, shape (x, y) lands on world (x, -y), so feed (x, -z).
    const toShapePoint = ([x, z]) => new THREE.Vector2(x, -z)
    const shape = new THREE.Shape(stadiumLoop(R + W / 2, 48, 1).map(toShapePoint))
    shape.holes.push(new THREE.Path(stadiumLoop(R - W / 2, 48, 1).map(toShapePoint)))
    return new THREE.ShapeGeometry(shape)
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
      <meshStandardMaterial color="#2b2d31" roughness={0.92} />
    </mesh>
  )
}

function LaneMarkings() {
  const ref = useRef(null)
  const dashes = useMemo(() => loopSegments(stadiumLoop(R, 40, 24)).filter((_, i) => i % 2 === 0), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    dashes.forEach((dash, i) => {
      dummy.position.set(dash.center[0], 0.02, dash.center[1])
      dummy.rotation.set(0, dash.yaw, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [dashes])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, dashes.length]} receiveShadow>
      <boxGeometry args={[0.3, 0.01, 2.5]} />
      <meshStandardMaterial color="#f1f5f9" roughness={0.6} />
    </instancedMesh>
  )
}

function WallSegment({ segment, color }) {
  const args = useMemo(() => [WALL_T, WALL_H, segment.length + 0.3], [segment.length])
  const [ref] = useBox(
    () => ({
      type: 'Static',
      args,
      position: [segment.center[0], WALL_H / 2, segment.center[1]],
      rotation: [0, segment.yaw, 0],
    }),
    useRef(null),
  )
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  )
}

/** A ring of static boxes following a stadium loop of the given radius. */
function Wall({ radius, arcSegments }) {
  const segments = useMemo(() => loopSegments(stadiumLoop(radius, arcSegments, 12)), [radius, arcSegments])
  return segments.map((segment, i) => (
    <WallSegment key={i} segment={segment} color={i % 2 === 0 ? '#e63946' : '#f1f5f9'} />
  ))
}

function useCheckerTexture(columns, rows) {
  const texture = useMemo(() => {
    const cell = 32
    const canvas = document.createElement('canvas')
    canvas.width = columns * cell
    canvas.height = rows * cell
    const ctx = canvas.getContext('2d')
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#111111' : '#fafafa'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter
    return tex
  }, [columns, rows])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function FinishLine() {
  const checker = useCheckerTexture(2, 8)
  const postZ = W / 2 + WALL_T + 0.8
  return (
    <group position={[FINISH_LINE.x, 0, FINISH_LINE.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <planeGeometry args={[3, W]} />
        <meshStandardMaterial map={checker} roughness={0.7} />
      </mesh>
      {[-postZ, postZ].map((z) => (
        <mesh key={z} position={[0, 3.6, z]} castShadow>
          <boxGeometry args={[0.6, 7.2, 0.6]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 6.8, 0]} castShadow>
        <boxGeometry args={[0.6, 1.3, postZ * 2 + 0.6]} />
        <meshStandardMaterial color="#e63946" emissive="#7f1020" emissiveIntensity={0.4} />
      </mesh>
    </group>
  )
}

/**
 * Invisible trigger volume. Fires onEnter when the local chassis (the only dynamic
 * body in the world — opponents are visual replicas) starts overlapping it.
 * Both collide events are wired; the store handlers are idempotent per crossing.
 */
function TriggerZone({ position, args, onEnter }) {
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter
  const [ref] = useBox(
    () => ({
      isTrigger: true,
      type: 'Static',
      args,
      position,
      onCollide: () => onEnterRef.current(),
      onCollideBegin: () => onEnterRef.current(),
    }),
    useRef(null),
  )
  return (
    <mesh ref={ref} visible={false}>
      <boxGeometry args={args} />
    </mesh>
  )
}

function mulberry32(seed) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic trees around and inside the circuit (two instanced draw calls). */
function Scenery() {
  const trunks = useRef(null)
  const crowns = useRef(null)
  const trees = useMemo(() => {
    const random = mulberry32(1337)
    const result = []
    while (result.length < 140) {
      const x = (random() * 2 - 1) * 190
      const z = (random() * 2 - 1) * 130
      if (distanceToCenterLine(x, z) < W / 2 + 7) continue
      result.push({ x, z, scale: 0.8 + random() * 0.9 })
    }
    return result
  }, [])

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, 1 * tree.scale, tree.z)
      dummy.scale.setScalar(tree.scale)
      dummy.updateMatrix()
      trunks.current.setMatrixAt(i, dummy.matrix)
      dummy.position.set(tree.x, 3.6 * tree.scale, tree.z)
      dummy.updateMatrix()
      crowns.current.setMatrixAt(i, dummy.matrix)
    })
    trunks.current.instanceMatrix.needsUpdate = true
    crowns.current.instanceMatrix.needsUpdate = true
  }, [trees])

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.25, 0.35, 2, 6]} />
        <meshStandardMaterial color="#6b4423" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, trees.length]} castShadow>
        <coneGeometry args={[1.8, 4, 7]} />
        <meshStandardMaterial color="#2d6a4f" roughness={0.9} />
      </instancedMesh>
    </group>
  )
}

export default function RaceTrack() {
  const triggerArgs = useMemo(() => [1, 4, W], [])
  return (
    <group>
      <Ground />
      <Road />
      <LaneMarkings />
      <Wall radius={R + W / 2 + WALL_T / 2} arcSegments={32} />
      <Wall radius={R - W / 2 - WALL_T / 2} arcSegments={24} />
      <FinishLine />
      <Scenery />
      <TriggerZone
        position={[FINISH_LINE.x, 2, FINISH_LINE.z]}
        args={triggerArgs}
        onEnter={() => useGameStore.getState().crossFinishLine()}
      />
      <TriggerZone
        position={[CHECKPOINT.x, 2, CHECKPOINT.z]}
        args={triggerArgs}
        onEnter={() => useGameStore.getState().passCheckpoint()}
      />
    </group>
  )
}
