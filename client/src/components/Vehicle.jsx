import { forwardRef, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useBox, useCompoundBody, useRaycastVehicle } from '@react-three/cannon'
import * as THREE from 'three'
import { CarBody, WheelMesh } from './CarModel.jsx'
import { useKeyboardControls } from '../hooks/useKeyboardControls.js'
import { useGameStore } from '../state/store.js'
import { resetTelemetry, telemetry } from '../state/telemetry.js'
import { getSocket } from '../net/socket.js'
import { accelerationFactor, NETWORK, VEHICLE } from '../game/constants.js'
import { gridPose, nearestTrackPose } from '../game/trackMath.js'

// Raycast-vehicle tuning (values follow the @react-three/cannon raycast-vehicle reference setup).
const wheelInfoBase = {
  radius: VEHICLE.wheelRadius,
  directionLocal: [0, -1, 0],
  // With axleLocal -X, positive engine force pushes towards -Z, so "forward" (+Z) uses negative force.
  axleLocal: [-1, 0, 0],
  suspensionStiffness: 30,
  suspensionRestLength: VEHICLE.suspensionRestLength,
  maxSuspensionForce: 1e5,
  maxSuspensionTravel: 0.25,
  dampingRelaxation: 10,
  dampingCompression: 4.4,
  frictionSlip: 3,
  rollInfluence: 0.01,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
}

const { wheelHalfTrack: hx, wheelFrontZ: fz, wheelBackZ: bz, wheelConnectionY: cy } = VEHICLE
const WHEEL_INFOS = [
  { ...wheelInfoBase, chassisConnectionPointLocal: [-hx, cy, fz], isFrontWheel: true },
  { ...wheelInfoBase, chassisConnectionPointLocal: [hx, cy, fz], isFrontWheel: true },
  { ...wheelInfoBase, chassisConnectionPointLocal: [-hx, cy, bz], isFrontWheel: false },
  { ...wheelInfoBase, chassisConnectionPointLocal: [hx, cy, bz], isFrontWheel: false },
]
const FRONT_WHEELS = [0, 1]
const REAR_WHEELS = [2, 3]
const ALL_WHEELS = [0, 1, 2, 3]

const CAMERA_DISTANCE = 9
const CAMERA_HEIGHT = 3.8
const BASE_FOV = 60

// Scratch objects reused every frame (only one local vehicle exists).
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _flatForward = new THREE.Vector3()
const _up = new THREE.Vector3()
const _cameraTarget = new THREE.Vector3()
const _lookAt = new THREE.Vector3()

const round3 = (n) => Math.round(n * 1000) / 1000

const Wheel = forwardRef(function Wheel(_props, ref) {
  // Wheels don't collide (collisionFilterGroup 0); the raycast vehicle positions them.
  useCompoundBody(
    () => ({
      collisionFilterGroup: 0,
      mass: 1,
      type: 'Kinematic',
      shapes: [
        {
          type: 'Cylinder',
          args: [VEHICLE.wheelRadius, VEHICLE.wheelRadius, VEHICLE.wheelWidth, 16],
          rotation: [0, 0, -Math.PI / 2],
        },
      ],
    }),
    ref,
  )
  return (
    <group ref={ref}>
      <WheelMesh />
    </group>
  )
})

export default function Vehicle({ slot, color, topSpeedModifier = 1 }) {
  const spawn = useMemo(() => gridPose(slot), [slot])
  const controls = useKeyboardControls()
  const camera = useThree((state) => state.camera)

  const wheel0 = useRef(null)
  const wheel1 = useRef(null)
  const wheel2 = useRef(null)
  const wheel3 = useRef(null)
  const wheels = [wheel0, wheel1, wheel2, wheel3]

  const [chassisRef, chassisApi] = useBox(
    () => ({
      mass: VEHICLE.mass,
      args: VEHICLE.chassisArgs,
      allowSleep: false,
      position: spawn.position,
      rotation: [0, spawn.yaw, 0],
      angularDamping: 0.2,
      linearDamping: 0.02,
    }),
    useRef(null),
  )

  const [vehicleRef, vehicleApi] = useRaycastVehicle(
    () => ({
      chassisBody: chassisRef,
      wheels,
      wheelInfos: WHEEL_INFOS,
      indexForwardAxis: 2,
      indexRightAxis: 0,
      indexUpAxis: 1,
    }),
    useRef(null),
  )

  const velocity = useRef([0, 0, 0])
  const steering = useRef(0)
  const sendTimer = useRef(0)
  const flippedFor = useRef(0)
  const resetLatched = useRef(false)
  // Last values sent to the physics worker, so we only post messages when something changes.
  const applied = useRef({ engine: [null, null, null, null], brake: [null, null, null, null], steer: [null, null] })

  useEffect(() => chassisApi.velocity.subscribe((v) => (velocity.current = v)), [chassisApi])

  useEffect(() => {
    const [x, y, z] = spawn.position
    camera.position.set(x - Math.sin(spawn.yaw) * CAMERA_DISTANCE, y + CAMERA_HEIGHT, z - Math.cos(spawn.yaw) * CAMERA_DISTANCE)
    camera.lookAt(x, y, z)
    return () => resetTelemetry()
  }, [camera, spawn])

  const respawnOnTrack = (position) => {
    const pose = nearestTrackPose(position.x, position.z)
    chassisApi.position.set(pose.position[0], 1.2, pose.position[2])
    chassisApi.rotation.set(0, pose.yaw, 0)
    chassisApi.velocity.set(0, 0, 0)
    chassisApi.angularVelocity.set(0, 0, 0)
    flippedFor.current = 0
  }

  useFrame((state, delta) => {
    const chassis = chassisRef.current
    // @react-three/cannon writes the body transform straight into `chassis.matrix`
    // (and disables matrixAutoUpdate); chassis.position/quaternion are never updated.
    // Until the first physics step has been applied, the matrix isn't meaningful yet.
    if (!chassis || chassis.matrixAutoUpdate) return
    chassis.matrix.decompose(_position, _quaternion, _scale)
    const dt = Math.min(delta, 0.1)
    const { room, finished } = useGameStore.getState()
    const canDrive = room?.status === 'racing' && !finished
    const input = controls.current

    // --- Telemetry -------------------------------------------------------
    const v = velocity.current
    _forward.set(0, 0, 1).applyQuaternion(_quaternion)
    const forwardSpeed = v[0] * _forward.x + v[1] * _forward.y + v[2] * _forward.z
    const speed = Math.hypot(v[0], v[1], v[2])
    telemetry.speedKmh = speed * 3.6
    telemetry.velocity = v

    // --- Drive inputs ----------------------------------------------------
    const maxSpeed = (VEHICLE.baseMaxSpeedKmh / 3.6) * topSpeedModifier
    const engineForce = VEHICLE.engineForce * accelerationFactor(topSpeedModifier)
    let engine = 0
    let brake = 0

    if (!canDrive) {
      brake = VEHICLE.maxBrake
    } else {
      if (input.forward && !input.backward) {
        if (forwardSpeed < maxSpeed) engine = -engineForce
      } else if (input.backward && !input.forward) {
        if (forwardSpeed > 1) brake = VEHICLE.maxBrake // brake first, then reverse
        else if (forwardSpeed > -VEHICLE.maxReverseSpeedKmh / 3.6) engine = engineForce * VEHICLE.reverseForceFactor
      } else {
        brake = VEHICLE.coastBrake // gentle engine braking when coasting
      }
      if (input.brake) {
        engine = 0
        brake = VEHICLE.maxBrake
      }
    }

    const sent = applied.current
    for (const i of REAR_WHEELS) {
      if (sent.engine[i] !== engine) {
        sent.engine[i] = engine
        vehicleApi.applyEngineForce(engine, i)
      }
    }
    for (const i of ALL_WHEELS) {
      if (sent.brake[i] !== brake) {
        sent.brake[i] = brake
        vehicleApi.setBrake(brake, i)
      }
    }

    // Steering eases in/out and tightens at speed for stability.
    const steerInput = canDrive && input.left !== input.right ? (input.left ? 1 : -1) : 0
    const speedRatio = Math.min(Math.abs(forwardSpeed) / maxSpeed, 1)
    const targetSteer = steerInput * VEHICLE.maxSteer * (1 - 0.55 * speedRatio)
    steering.current = THREE.MathUtils.damp(steering.current, targetSteer, 10, dt)
    const steerValue = round3(steering.current)
    for (const i of FRONT_WHEELS) {
      if (sent.steer[i] !== steerValue) {
        sent.steer[i] = steerValue
        vehicleApi.setSteeringValue(steerValue, i)
      }
    }

    // --- Recovery: R key, falling off the world, or stuck upside down ------
    if (input.reset && !resetLatched.current) respawnOnTrack(_position)
    resetLatched.current = input.reset
    _up.set(0, 1, 0).applyQuaternion(_quaternion)
    flippedFor.current = _up.y < 0.3 && speed < 2 ? flippedFor.current + dt : 0
    if (_position.y < -5 || flippedFor.current > 2) respawnOnTrack(_position)

    // --- Chase camera ------------------------------------------------------
    _flatForward.set(_forward.x, 0, _forward.z)
    if (_flatForward.lengthSq() < 1e-4) _flatForward.set(0, 0, 1)
    _flatForward.normalize()
    _cameraTarget.copy(_position).addScaledVector(_flatForward, -CAMERA_DISTANCE)
    _cameraTarget.y += CAMERA_HEIGHT
    state.camera.position.lerp(_cameraTarget, 1 - Math.exp(-6 * dt))
    _lookAt.copy(_position).addScaledVector(_flatForward, 6)
    _lookAt.y += 1
    state.camera.lookAt(_lookAt)
    const targetFov = BASE_FOV + 14 * speedRatio
    if (Math.abs(state.camera.fov - targetFov) > 0.05) {
      state.camera.fov = THREE.MathUtils.damp(state.camera.fov, targetFov, 4, dt)
      state.camera.updateProjectionMatrix()
    }

    // --- Network: send our transform at NETWORK.sendRateHz ----------------
    sendTimer.current += dt
    const interval = 1 / NETWORK.sendRateHz
    if (sendTimer.current >= interval) {
      sendTimer.current %= interval
      const socket = getSocket()
      if (socket?.connected && room && room.status !== 'lobby') {
        const p = _position
        const q = _quaternion
        socket.volatile.emit('player:transform', {
          p: [round3(p.x), round3(p.y), round3(p.z)],
          q: [round3(q.x), round3(q.y), round3(q.z), round3(q.w)],
          s: round3(Math.max(forwardSpeed, 0)),
        })
      }
    }
  })

  return (
    <group ref={vehicleRef}>
      <group ref={chassisRef}>
        <CarBody color={color} />
      </group>
      <Wheel ref={wheel0} />
      <Wheel ref={wheel1} />
      <Wheel ref={wheel2} />
      <Wheel ref={wheel3} />
    </group>
  )
}
