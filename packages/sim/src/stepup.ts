import type { GameState, PlayerId } from './state';
import type { Tuning } from './tuning';
import { springStep } from './math';

/** Floor obstacles are step-ups: the player automatically steps on and off, the ladder never collides. */
export function updateStepTargets(s: GameState, t: Tuning): void {
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]!;
    const lo = p.x - t.footHalf;
    const hi = p.x + t.footHalf;
    let target = 0;
    for (const o of s.steps) {
      if (hi >= o.x0 && lo <= o.x1 && o.hObj > target) target = o.hObj;
    }
    if (target !== p.yFloorTarget) {
      p.yFloorTarget = target;
      p.stepSlowTimer = t.stepPushTime;
      p.stepping = true;
      p.stepPeakAccel = 0;
      p.stepTime = 0;
    }
  }
}

export function integrateStepUps(s: GameState, t: Tuning): void {
  const dt = t.dt;
  const omega = 2 / t.tStep;
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]!;
    [p.yFloor, p.yFloorVel] = springStep(p.yFloor, p.yFloorVel, p.yFloorTarget, omega, dt);
    if (p.stepSlowTimer > 0) p.stepSlowTimer = Math.max(0, p.stepSlowTimer - dt);
    if (p.slipTimer > 0) p.slipTimer = Math.max(0, p.slipTimer - dt);
  }
}

/** Called after the bucket kinematics are known: track the vertical shock during a step and score the catch. */
export function evaluateStepCatch(s: GameState, t: Tuning): void {
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]!;
    if (!p.stepping) continue;
    p.stepTime += t.dt;
    p.stepPeakAccel = Math.max(p.stepPeakAccel, Math.abs(s.bucket.aPyF));
    const settled = Math.abs(p.yFloor - p.yFloorTarget) < 0.02 && Math.abs(p.yFloorVel) < 0.15;
    if (p.stepTime > 0.15 && settled) {
      p.stepping = false;
      const caught = p.stepPeakAccel < t.aSafe;
      if (caught) {
        s.score += t.scoreStepCaught;
        s.events.push({ tick: s.tick, type: 'stepCaught', player: i as PlayerId, value: t.scoreStepCaught, x: p.x, y: p.yFloor });
      } else {
        s.events.push({ tick: s.tick, type: 'stepMissed', player: i as PlayerId, value: p.stepPeakAccel, x: p.x, y: p.yFloor });
      }
    }
  }
}
