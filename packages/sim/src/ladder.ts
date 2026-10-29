import type { GameState, PlayerState } from './state';
import type { Tuning } from './tuning';
import { approach, clamp, sign } from './math';

/** Hand height above the surface the player stands on, for posture h. */
export function yHand(h: number, t: Tuning): number {
  return t.yHandBase + t.yHandRange * h;
}

/** Position of the (extended) ladder segment including overhang, in world units. */
export interface LadderSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Hand positions (without overhang). */
  hax: number;
  hay: number;
  hbx: number;
  hby: number;
  theta: number;
}

export function ladderSegment(s: GameState, t: Tuning): LadderSegment {
  const [a, b] = s.players;
  const hax = a.x + s.ladder.kickX;
  const hay = a.y;
  const hbx = b.x + s.ladder.kickX;
  const hby = b.y;
  const dx = hbx - hax;
  const dy = hby - hay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const o = t.ladderOverhang;
  return {
    ax: hax - ux * o,
    ay: hay - uy * o,
    bx: hbx + ux * o,
    by: hby + uy * o,
    hax,
    hay,
    hbx,
    hby,
    theta: Math.atan2(dy, dx),
  };
}

/** Ladder height at world x (linear between hands, extended beyond them). */
export function ladderHeightAt(s: GameState, x: number): number {
  const [a, b] = s.players;
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return a.y;
  return a.y + ((x - a.x) / dx) * (b.y - a.y);
}

/**
 * Horizontal coupling: the ladder acts as a stiff damped spring between the hands.
 * Applies the walking acceleration, slip and the spring force to both players.
 */
export function integrateHorizontal(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const dt = t.dt;

  for (const p of s.players) {
    let push = p.push;
    if (p.stepSlowTimer > 0) push *= t.stepPushFactor;
    const vWant = push * t.vMax;
    let aMax = t.aMax;
    if (p.slipTimer > 0) aMax *= 0.2;
    const dv = clamp(vWant - p.v, -aMax * dt, aMax * dt);
    p.v += dv;
  }

  // s > 0: B is too far ahead → A is pulled forward, B is held back.
  const sTension = b.x - a.x - t.L0;
  const sDot = b.v - a.v;
  const F = t.k * sTension + t.c * sDot;
  a.v += F * dt;
  b.v -= F * dt;
  s.ladder.tension = sTension;

  a.x += a.v * dt;
  b.x += b.v * dt;
}

/**
 * Vertical: requested hand heights, arm-reach limit and ladder kick.
 * Sets p.yHandRaw, p.y, p.yVel, ladder.over/highSide and the ladder angle.
 */
export function integrateVertical(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const dt = t.dt;

  const rawA = a.yFloor + t.jumpHand * a.jumpY + yHand(a.h, t);
  const rawB = b.yFloor + t.jumpHand * b.jumpY + yHand(b.h, t);
  a.yHandRaw = rawA;
  b.yHandRaw = rawB;

  let yA = rawA;
  let yB = rawB;
  const dy = rawB - rawA;
  const over = Math.max(0, Math.abs(dy) - t.dyMax);
  s.ladder.over = over;
  s.ladder.highSide = sign(dy);
  if (over > 0) {
    // The ladder pulls the highest hand down; the player hangs on tiptoe.
    if (dy > 0) yB = rawA + t.dyMax;
    else yA = rawB + t.dyMax;
  }

  // Keep the bucket off the floor and off obstacles: lift the whole ladder when it would touch down.
  const bx = s.bucket.xP + t.bucketL * Math.sin(s.bucket.phi);
  let ground = 0;
  for (const o of s.steps) {
    const ahead = Math.max(0, s.bucket.vPx) * 0.25;
    if (o.x1 < bx - t.bucketHalfW || o.x0 > bx + t.bucketHalfW + ahead) continue;
    if (o.kind === 'stair' && o.hObj > ground) ground = o.hObj;
  }
  const midY = (yA + yB) / 2;
  const needed = ground + t.bucketL * Math.cos(s.bucket.phi) + t.bucketBody + 0.02;
  const deficit = Math.max(0, needed - midY);
  const L0 = s.ladder;
  L0.lift = approach(L0.lift, deficit, (deficit > L0.lift ? t.liftUp : t.liftDown) * dt);
  yA += L0.lift;
  yB += L0.lift;

  // Ladder kick: damped second-order disturbance added to both ends.
  const w = t.kickOmega;
  const z = t.kickZeta;
  const L = s.ladder;
  L.kickVX += (-w * w * L.kickX - 2 * z * w * L.kickVX) * dt;
  L.kickVY += (-w * w * L.kickY - 2 * z * w * L.kickVY) * dt;
  L.kickX += L.kickVX * dt;
  L.kickY += L.kickVY * dt;

  const newYA = yA + L.kickY;
  const newYB = yB + L.kickY;
  a.yVel = (newYA - a.y) / dt;
  b.yVel = (newYB - b.y) / dt;
  a.y = newYA;
  b.y = newYB;

  const theta = Math.atan2(b.y - a.y, b.x - a.x);
  let dTheta = theta - L.theta;
  if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
  L.thetaDot = dTheta / dt;
  L.theta = theta;
}

/** Apply an external impulse (world units * mass) to the ladder and the players. */
export function applyLadderImpulse(s: GameState, jx: number, jy: number, t: Tuning): void {
  s.ladder.kickVX += jx / t.mLadder;
  s.ladder.kickVY += jy / t.mLadder;
  const half = (0.5 * jx) / t.mLadder;
  s.players[0].v += half;
  s.players[1].v += half;
}

export function resetPlayerRow(a: PlayerState, b: PlayerState, t: Tuning): void {
  const mid = (a.x + b.x) / 2;
  a.x = mid - t.L0 / 2;
  b.x = mid + t.L0 / 2;
  a.v = 0;
  b.v = 0;
}
