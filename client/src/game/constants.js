// Keep TRACK_NAME and the garage limits in sync with server/server.js and server/models/Garage.js.
export const TRACK_NAME = 'oval-speedway'

export const TRACK = {
  radius: 40, // centre-line radius of the two hairpins (m)
  straightLength: 120, // length of each straight (m)
  roadWidth: 14,
  wallHeight: 1.4,
  wallThickness: 1,
}

export const VEHICLE = {
  mass: 500,
  chassisArgs: [1.7, 0.6, 4.1],
  wheelRadius: 0.42,
  wheelWidth: 0.32,
  wheelHalfTrack: 0.85,
  wheelFrontZ: 1.35,
  wheelBackZ: -1.25,
  wheelConnectionY: 0.05,
  suspensionRestLength: 0.2,
  engineForce: 1500, // per driven (rear) wheel
  reverseForceFactor: 0.5,
  maxReverseSpeedKmh: 30,
  baseMaxSpeedKmh: 140,
  maxBrake: 25,
  coastBrake: 1.5,
  maxSteer: 0.5,
}

// Where the visual wheels sit relative to the chassis centre (for remote cars).
export const WHEEL_OFFSETS = [
  [-VEHICLE.wheelHalfTrack, VEHICLE.wheelConnectionY - VEHICLE.suspensionRestLength, VEHICLE.wheelFrontZ],
  [VEHICLE.wheelHalfTrack, VEHICLE.wheelConnectionY - VEHICLE.suspensionRestLength, VEHICLE.wheelFrontZ],
  [-VEHICLE.wheelHalfTrack, VEHICLE.wheelConnectionY - VEHICLE.suspensionRestLength, VEHICLE.wheelBackZ],
  [VEHICLE.wheelHalfTrack, VEHICLE.wheelConnectionY - VEHICLE.suspensionRestLength, VEHICLE.wheelBackZ],
]

export const GARAGE = {
  defaultColor: '#e63946',
  defaultAccent: '#f8f9fa',
  minSpeedModifier: 0.8,
  maxSpeedModifier: 1.2,
  swatches: ['#e63946', '#f4a261', '#ffd60a', '#2a9d8f', '#4cc9f0', '#4361ee', '#9b5de5', '#f15bb5', '#f8f9fa', '#212529'],
}

/** Higher top speed costs acceleration (and vice versa). */
export const accelerationFactor = (topSpeedModifier) => 1.6 - 0.6 * topSpeedModifier

export const NETWORK = {
  sendRateHz: 30,
  interpolationDelayMs: 100,
  bufferMs: 1000,
  staleAfterMs: 3000,
}
