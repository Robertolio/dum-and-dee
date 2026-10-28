/** Half stride length (we): how far a planted foot travels relative to the body during one half cycle. */
export const WALK_STRIDE = 0.3;

export interface WalkAnim {
  phase: number;
  lastX: number;
}

export function createWalkAnim(x: number): WalkAnim {
  return { phase: 0, lastX: x };
}

/**
 * Advance the walk cycle by the distance actually travelled, so planted feet move backwards at exactly the
 * ground speed (no sliding) and the cycle stops when the player stands still. Returns the leg swing
 * amplitude factor 0…1 (legs settle together when slow).
 */
export function advanceWalk(w: WalkAnim, x: number, dt: number): number {
  const dx = x - w.lastX;
  w.lastX = x;
  if (Math.abs(dx) > 1) return 0; // teleport (reset)
  w.phase += dx / WALK_STRIDE;
  const speed = Math.abs(dx) / Math.max(dt, 1e-6);
  return Math.min(1, speed / 0.6);
}

/** Foot offset (we, forward positive) and lift (we) of leg `i` (0 or 1) for the given phase and amplitude. */
export function footPose(phase: number, amp: number, i: 0 | 1): { dx: number; lift: number } {
  const p = phase + (i === 0 ? 0 : Math.PI);
  return { dx: WALK_STRIDE * amp * Math.cos(p), lift: 0.09 * amp * Math.max(0, -Math.sin(p)) };
}
