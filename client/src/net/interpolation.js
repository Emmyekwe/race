import * as THREE from 'three'
import { NETWORK } from '../game/constants.js'

// Snapshot interpolation for remote cars.
// Remote cars are rendered slightly in the past (interpolationDelayMs) so there is almost
// always a snapshot on each side of the render time to blend between, which hides network jitter.

/** @type {Map<string, Array<{t:number, p:number[], q:number[], s:number}>>} */
const buffers = new Map()
let clockOffset = null // estimated (server time - local time) in ms

export function pushSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.t !== 'number' || !snapshot.players) return

  const sampleOffset = snapshot.t - Date.now()
  if (clockOffset === null || Math.abs(sampleOffset - clockOffset) > 1000) {
    clockOffset = sampleOffset
  } else {
    clockOffset += (sampleOffset - clockOffset) * 0.05
  }

  for (const [id, state] of Object.entries(snapshot.players)) {
    let buffer = buffers.get(id)
    if (!buffer) {
      buffer = []
      buffers.set(id, buffer)
    }
    const last = buffer[buffer.length - 1]
    if (last && snapshot.t <= last.t) continue // out of order or duplicate
    buffer.push({ t: snapshot.t, p: state.p, q: state.q, s: state.s ?? 0 })

    const cutoff = snapshot.t - NETWORK.bufferMs
    while (buffer.length > 2 && buffer[0].t < cutoff) buffer.shift()
  }
}

export function removeRemotePlayer(id) {
  buffers.delete(id)
}

export function clearSnapshots() {
  buffers.clear()
  clockOffset = null
}

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()

/**
 * Writes the interpolated transform for `id` into `out` ({ position: Vector3, quaternion: Quaternion, speed }).
 * Returns false when there is no fresh data for that player.
 */
export function sampleRemoteTransform(id, out) {
  const buffer = buffers.get(id)
  if (!buffer || buffer.length === 0 || clockOffset === null) return false

  const renderTime = Date.now() + clockOffset - NETWORK.interpolationDelayMs
  let a = buffer[0]
  let b = buffer[buffer.length - 1]

  if (renderTime <= a.t) {
    b = a
  } else if (renderTime >= b.t) {
    a = b // no newer data: hold the latest pose rather than extrapolating
  } else {
    for (let i = buffer.length - 2; i >= 0; i--) {
      if (buffer[i].t <= renderTime) {
        a = buffer[i]
        b = buffer[i + 1]
        break
      }
    }
  }

  const span = b.t - a.t
  const alpha = span > 0 ? (renderTime - a.t) / span : 0

  out.position.set(
    a.p[0] + (b.p[0] - a.p[0]) * alpha,
    a.p[1] + (b.p[1] - a.p[1]) * alpha,
    a.p[2] + (b.p[2] - a.p[2]) * alpha,
  )
  qa.fromArray(a.q)
  qb.fromArray(b.q)
  out.quaternion.slerpQuaternions(qa, qb, alpha)
  out.speed = a.s + (b.s - a.s) * alpha

  return renderTime - buffer[buffer.length - 1].t < NETWORK.staleAfterMs
}
