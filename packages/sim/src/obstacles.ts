import type { GameState, PlayerId, PlayerState, StepObstacle } from './state';
import type { Tuning } from './tuning';
import { applyLadderImpulse, ladderSegment } from './ladder';
import { loseWater } from './bucket';

/** True when the object is too high for this player to simply walk onto, and the player is on its approach side. */
export function blocksPlayer(p: PlayerState, o: StepObstacle, t: Tuning): boolean {
  if (o.kind === 'banana') return false;
  const feet = p.yFloorTarget + p.jumpY;
  if (o.hObj - feet <= t.autoStepMax) return false;
  // Only the approach side blocks; once the body is over the object it is free (landing on top).
  return p.x < o.x0 || p.x > o.x1;
}

/** Jump arc: smooth sin² bump, started by a rising-edge request while on the ground. */
export function integrateJump(p: PlayerState, t: Tuning): void {
  if (p.jumpT === 0 && p.jumpReq && p.slipTimer <= 0) p.jumpT = t.dt;
  else if (p.jumpT > 0) p.jumpT += t.dt;
  if (p.jumpT >= t.jumpTime) {
    p.jumpT = 0;
    p.jumpY = 0;
  } else if (p.jumpT > 0) {
    const sn = Math.sin((Math.PI * p.jumpT) / t.jumpTime);
    p.jumpY = t.jumpHeight * sn * sn;
  }
  p.jumpReq = false;
}

export function triggerSlip(s: GameState, i: PlayerId, t: Tuning): void {
  const p = s.players[i]!;
  p.slipTimer = t.slipTime;
  p.v += 1.2;
  loseWater(s, t.slipSplash);
  applyLadderImpulse(s, 0.4, -t.slipKick, t);
  s.events.push({ tick: s.tick, type: 'slip', player: i, x: p.x, y: p.yFloor });
}

/** Pushing and blocking: props too high to step onto stop the player, light ones slide a little first. */
export function resolveObstacles(s: GameState, t: Tuning): void {
  const dt = t.dt;
  const fh = t.footHalf;
  for (const o of s.steps) {
    if (o.kind === 'stair' || o.kind === 'banana') continue;
    if (o.vx !== 0) {
      const dx = o.vx * dt;
      o.x0 += dx;
      o.x1 += dx;
      o.slid += Math.abs(dx);
      const dec = t.pushFriction * dt;
      o.vx = Math.abs(o.vx) <= dec || o.slid >= maxSlide(o) ? 0 : o.vx - Math.sign(o.vx) * dec;
    }
    for (const p of s.players) {
      if (!blocksPlayer(p, o, t)) continue;
      let side = 0;
      if (p.x < o.x0 && p.x + fh > o.x0) side = 1;
      else if (p.x > o.x1 && p.x - fh < o.x1) side = -1;
      if (side === 0) continue;
      const into = p.v * side;
      if (into > 0 && o.slid < maxSlide(o)) {
        const k = 1 / (1 + 2 * o.mass);
        if (o.vx * side < into * k) o.vx = side * into * k;
      }
      p.x = side > 0 ? o.x0 - fh : o.x1 + fh;
      if (into > 0 || o.vx * side > 0) p.v = o.vx * side > 0 ? o.vx : 0;
    }
  }
}

function maxSlide(o: StepObstacle): number {
  return Math.min(1.2, 0.45 / o.mass);
}

/** Ceiling beams: the ladder hits them when held too high; both players stumble back. */
export function integrateBeams(s: GameState, t: Tuning): void {
  if (s.beams.length === 0) return;
  const seg = ladderSegment(s, t);
  const half = t.ladderThickness / 2;
  for (const b of s.beams) {
    if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - t.dt);
    const lo = Math.max(b.x0, Math.min(seg.ax, seg.bx));
    const hi = Math.min(b.x1, Math.max(seg.ax, seg.bx));
    if (lo > hi) continue;
    const dx = seg.bx - seg.ax;
    const yAt = (x: number): number => (Math.abs(dx) < 1e-6 ? seg.ay : seg.ay + ((x - seg.ax) / dx) * (seg.by - seg.ay));
    const top = Math.max(yAt(lo), yAt(hi)) + half;
    if (top <= b.yBottom) continue;
    // Keep the ladder from moving into the beam: both players are pushed back while it overlaps.
    for (const p of s.players) p.v = Math.min(p.v, 0) - (b.cooldown <= 0 ? t.beamRebound : 0);
    if (b.cooldown <= 0) {
      b.cooldown = t.beamCooldown;
      loseWater(s, t.beamSplash);
      applyLadderImpulse(s, -0.5, -1.0, t);
      s.events.push({ tick: s.tick, type: 'beamHit', value: t.beamSplash, x: Math.max(b.x0, Math.min(b.x1, seg.bx)), y: b.yBottom });
    }
  }
}
