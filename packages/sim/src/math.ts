export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

/** Move `value` toward `target` by at most `maxDelta`. */
export function approach(value: number, target: number, maxDelta: number): number {
  const d = target - value;
  if (Math.abs(d) <= maxDelta) return target;
  return value + sign(d) * maxDelta;
}

/**
 * One semi-implicit Euler step of a critically damped spring toward `target`.
 * omega = 1 / tau. Returns [value, velocity].
 */
export function springStep(
  value: number,
  vel: number,
  target: number,
  omega: number,
  dt: number,
  zeta = 1,
): [number, number] {
  const acc = omega * omega * (target - value) - 2 * zeta * omega * vel;
  const v2 = vel + acc * dt;
  return [value + v2 * dt, v2];
}
