import type { GameState } from './state';
import type { Tuning } from './tuning';
import { DEG } from './math';

/**
 * The bucket hangs from a hook at the middle of the ladder and always hangs
 * vertically at rest. It only reacts to the motion of the suspension point P
 * (acceleration, jerk) and to the angular velocity of the ladder; the static
 * ladder angle never appears here.
 */
export function integrateBucket(s: GameState, t: Tuning): void {
  const dt = t.dt;
  const [a, b] = s.players;
  const B = s.bucket;

  const xP = (a.x + b.x) / 2 + s.ladder.kickX;
  const yP = (a.y + b.y) / 2;

  const vPx = (xP - B.xP) / dt;
  const vPy = (yP - B.yP) / dt;
  const aPx = (vPx - B.vPx) / dt;
  const aPy = (vPy - B.vPy) / dt;

  // Low-pass filter so a single-tick discontinuity does not dominate the loss.
  const alpha = dt / (t.accelFilter + dt);
  const aPxF = B.aPxF + (aPx - B.aPxF) * alpha;
  const aPyF = B.aPyF + (aPy - B.aPyF) * alpha;
  // Vertical jerk only: horizontal shocks already show up as pendulum swing (phi).
  const jerk = Math.abs(aPyF - B.aPyF) / dt;

  B.xP = xP;
  B.yP = yP;
  B.vPx = vPx;
  B.vPy = vPy;
  B.aPx = aPx;
  B.aPy = aPy;
  B.aPxF = aPxF;
  B.aPyF = aPyF;
  B.jerk = jerk;

  // Pendulum driven by the suspension point.
  const gEff = Math.max(0, t.g + aPyF);
  const l = t.bucketL;
  const phiDDot =
    -(gEff / l) * Math.sin(B.phi) -
    t.bucketD * B.phiDot -
    (aPxF * Math.cos(B.phi)) / l +
    t.bucketCTheta * s.ladder.thetaDot;
  B.phiDot += phiDDot * dt;
  B.phi += B.phiDot * dt;

  // Water loss only from motion.
  const phiDeg = Math.abs(B.phi) * DEG;
  const rate =
    t.kPhi * Math.max(0, phiDeg - t.phiSafeDeg) +
    t.kV * Math.max(0, Math.abs(aPyF) - t.aSafe) +
    t.kJ * Math.max(0, jerk - t.jSafe);
  B.lossRate = rate;
  B.splash = Math.max(Math.abs(aPyF), B.splash * (1 - dt * 2));
  if (rate > 0) loseWater(s, rate * dt);
}

export function loseWater(s: GameState, amount: number): void {
  s.bucket.water = Math.max(0, s.bucket.water - amount);
}

/** Initialise the kinematic history so the first tick does not register a shock. */
export function primeBucket(s: GameState): void {
  const [a, b] = s.players;
  const B = s.bucket;
  B.xP = (a.x + b.x) / 2;
  B.yP = (a.y + b.y) / 2;
  B.vPx = 0;
  B.vPy = 0;
  B.aPx = 0;
  B.aPy = 0;
  B.aPxF = 0;
  B.aPyF = 0;
  B.jerk = 0;
}
