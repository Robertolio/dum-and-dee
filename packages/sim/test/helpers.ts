import { createState, step, DEFAULT_TUNING, type GameState, type LevelData, type PlayerInput, type Tuning } from '../src/index';

export const EMPTY_LEVEL: LevelData = { id: 'empty', lamps: [], steps: [], length: 100 };
export const T = DEFAULT_TUNING;

export const upright = (push = 0): PlayerInput => ({ push, hTarget: T.hUpright });
export const bent = (push = 0): PlayerInput => ({ push, hTarget: T.hBent });
export const posture = (hTarget: number, push = 0): PlayerInput => ({ push, hTarget });

export interface RunStats {
  peakAPy: number;
  peakJerk: number;
  peakPhiDeg: number;
  events: GameState['events'];
}

/** Run for `seconds` with constant inputs and collect peaks and events. */
export function runFor(
  s: GameState,
  a: PlayerInput,
  b: PlayerInput,
  seconds: number,
  t: Tuning = T,
): RunStats {
  return runWith(s, () => [a, b], seconds, t);
}

/** Run for `seconds` with inputs computed from the state each tick. */
export function runWith(
  s: GameState,
  inputs: (s: GameState) => [PlayerInput, PlayerInput],
  seconds: number,
  t: Tuning = T,
): RunStats {
  const stats: RunStats = { peakAPy: 0, peakJerk: 0, peakPhiDeg: 0, events: [] };
  const n = Math.round(seconds / t.dt);
  for (let i = 0; i < n; i++) {
    step(s, inputs(s), t);
    stats.peakAPy = Math.max(stats.peakAPy, Math.abs(s.bucket.aPyF));
    stats.peakJerk = Math.max(stats.peakJerk, s.bucket.jerk);
    stats.peakPhiDeg = Math.max(stats.peakPhiDeg, Math.abs(s.bucket.phi) * (180 / Math.PI));
    stats.events.push(...s.events);
  }
  return stats;
}

export function freshState(level: LevelData = EMPTY_LEVEL, t: Tuning = T): GameState {
  return createState(level, t);
}
