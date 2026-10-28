/** Input of one player for one tick. Identical for touch, keyboard and (later) network. */
export interface PlayerInput {
  /** Push 0…1 (hold = 0.6, run = 1.0), negative = braking (min −0.3). */
  push: number;
  /** Target posture 0…1 (0 = deep squat, 0.2 = bent, 0.8 = upright, 1.0 = stretched). */
  hTarget: number;
}

export const IDLE_INPUT: PlayerInput = { push: 0, hTarget: 0.8 };

export function clampInput(i: PlayerInput): PlayerInput {
  return {
    push: Math.max(-0.3, Math.min(1, Number.isFinite(i.push) ? i.push : 0)),
    hTarget: Math.max(0, Math.min(1, Number.isFinite(i.hTarget) ? i.hTarget : 0.8)),
  };
}
