import type { GameState, PlayerId } from './state';
import type { Tuning } from './tuning';
import { approach, springStep } from './math';

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
      p.stepSize = Math.abs(target - p.yFloorTarget);
      p.yFloorTarget = target;
      p.stepSlowTimer = t.stepPushTime;
      p.stepping = true;
      p.stepPeakAccel = 0;
      p.stepHandStart = p.y;
      p.stepHandDev = 0;
      p.stepTime = 0;
    }
  }
}

export function integrateStepUps(s: GameState, t: Tuning): void {
  const dt = t.dt;
  const omega = 3 / t.tStep;
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]!;
    // The foot lifts gradually: rate-limit the target, then a critically damped spring.
    p.yFloorTargetSmooth = approach(p.yFloorTargetSmooth, p.yFloorTarget, t.stepRate * dt);
    [p.yFloor, p.yFloorVel] = springStep(p.yFloor, p.yFloorVel, p.yFloorTargetSmooth, omega, dt);
    if (p.stepSlowTimer > 0) p.stepSlowTimer = Math.max(0, p.stepSlowTimer - dt);
    if (p.slipTimer > 0) p.slipTimer = Math.max(0, p.slipTimer - dt);
  }
}

/**
 * Called after the hand heights are known: a step is "caught" when the hand stayed within
 * ±catchTolerance × step height of where it was (the knees absorbed the step), regardless of timing.
 */
export function evaluateStepCatch(s: GameState, t: Tuning): void {
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]!;
    if (!p.stepping) continue;
    p.stepTime += t.dt;
    p.stepPeakAccel = Math.max(p.stepPeakAccel, Math.abs(s.bucket.aPyF));
    p.stepHandDev = Math.max(p.stepHandDev, Math.abs(p.y - p.stepHandStart));
    const settled = Math.abs(p.yFloor - p.yFloorTarget) < 0.02 && Math.abs(p.yFloorVel) < 0.15;
    if (p.stepTime > 0.15 && settled) {
      p.stepping = false;
      // Small risers (stairs) are just walked; only real obstacles score or cost.
      if (p.stepSize < 0.249) continue;
      const caught = p.stepHandDev < t.catchTolerance * p.stepSize;
      if (caught) {
        s.score += t.scoreStepCaught;
        s.events.push({ tick: s.tick, type: 'stepCaught', player: i as PlayerId, value: t.scoreStepCaught, x: p.x, y: p.yFloor });
      } else {
        s.events.push({ tick: s.tick, type: 'stepMissed', player: i as PlayerId, value: p.stepPeakAccel, x: p.x, y: p.yFloor });
      }
    }
  }
}
