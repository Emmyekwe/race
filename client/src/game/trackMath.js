import { TRACK } from './constants.js'

// The track is a "stadium" loop: two straights along X joined by semicircles.
// Race direction is +X along the bottom straight (z = +radius), i.e. anticlockwise when seen from above.
const R = TRACK.radius
const L = TRACK.straightLength
const HALF = L / 2

export const TRACK_LENGTH = 2 * L + 2 * Math.PI * R
export const FINISH_LINE = { x: 0, z: R }
export const CHECKPOINT = { x: 0, z: -R }

/**
 * Points ([x, z]) around a stadium loop of the given radius, in race order.
 * The loop is implicitly closed: the last point connects back to the first.
 */
export function stadiumLoop(radius, arcSegments = 32, straightSegments = 12) {
  const points = []
  // Bottom straight, heading +X.
  for (let i = 0; i < straightSegments; i++) {
    points.push([-HALF + (L * i) / straightSegments, radius])
  }
  // Right hairpin, θ from +90° down to -90°.
  for (let i = 0; i < arcSegments; i++) {
    const theta = Math.PI / 2 - (Math.PI * i) / arcSegments
    points.push([HALF + radius * Math.cos(theta), radius * Math.sin(theta)])
  }
  // Top straight, heading -X.
  for (let i = 0; i < straightSegments; i++) {
    points.push([HALF - (L * i) / straightSegments, -radius])
  }
  // Left hairpin, θ from -90° down to -270°.
  for (let i = 0; i < arcSegments; i++) {
    const theta = -Math.PI / 2 - (Math.PI * i) / arcSegments
    points.push([-HALF + radius * Math.cos(theta), radius * Math.sin(theta)])
  }
  return points
}

/** Converts a closed point loop into segments with centre, length and yaw (box local +Z along the segment). */
export function loopSegments(points) {
  return points.map(([ax, az], i) => {
    const [bx, bz] = points[(i + 1) % points.length]
    const dx = bx - ax
    const dz = bz - az
    return {
      center: [(ax + bx) / 2, (az + bz) / 2],
      length: Math.hypot(dx, dz),
      yaw: Math.atan2(dx, dz),
    }
  })
}

/** Closest point on the centre line plus the yaw facing the race direction. Used for respawning. */
export function nearestTrackPose(x, z) {
  if (Math.abs(x) <= HALF) {
    return z >= 0 ? { position: [x, 0, R], yaw: Math.PI / 2 } : { position: [x, 0, -R], yaw: -Math.PI / 2 }
  }
  const cx = Math.sign(x) * HALF
  const theta = Math.atan2(z, x - cx)
  // Race direction runs with decreasing θ on both hairpins: tangent = (sin θ, -cos θ).
  return {
    position: [cx + R * Math.cos(theta), 0, R * Math.sin(theta)],
    yaw: Math.atan2(Math.sin(theta), -Math.cos(theta)),
  }
}

/** Distance from a point to the centre line (used to keep scenery off the road). */
export function distanceToCenterLine(x, z) {
  if (Math.abs(x) <= HALF) return Math.abs(Math.abs(z) - R)
  return Math.abs(Math.hypot(x - Math.sign(x) * HALF, z) - R)
}

/** Two-wide staggered starting grid behind the start/finish line. */
export function gridPose(slot) {
  const row = Math.floor(slot / 2)
  const lane = slot % 2 === 0 ? -1 : 1
  return {
    position: [FINISH_LINE.x - 12 - row * 8, 1, R + lane * 3],
    yaw: Math.PI / 2,
  }
}
