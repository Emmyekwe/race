// High-frequency vehicle data written by the physics loop every frame.
// Kept outside React state so 60 Hz updates never trigger re-renders;
// the HUD reads it from its own requestAnimationFrame loop.
export const telemetry = {
  speedKmh: 0,
  velocity: [0, 0, 0],
}

export function resetTelemetry() {
  telemetry.speedKmh = 0
  telemetry.velocity = [0, 0, 0]
}
