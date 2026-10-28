import type { LampState, StepObstacle, StepKind } from './state';
import type { Tuning } from './tuning';

export interface LevelLamp {
  x: number;
}
export interface LevelStep {
  x: number;
  width: number;
  kind: StepKind;
}
export interface LevelData {
  id: string;
  lamps: LevelLamp[];
  steps: LevelStep[];
  /** Length of the hall in we (decorative in phase 1). */
  length: number;
}

export const STEP_HEIGHT: Record<StepKind, number> = {
  bracket: 0.3,
  crate: 0.5,
  pallet: 0.6,
};

/** Phase 1 test level: lamps and step-ups in a simple repeating rhythm. */
export const PROTOTYPE_LEVEL: LevelData = {
  id: 'proto-factory',
  length: 140,
  lamps: [14, 34, 56, 78, 100, 122].map((x) => ({ x })),
  steps: [
    { x: 24, width: 1.0, kind: 'crate' },
    { x: 45, width: 0.8, kind: 'bracket' },
    { x: 66, width: 1.0, kind: 'crate' },
    { x: 76.5, width: 1.0, kind: 'crate' }, // crate right before a lamp: step up and bend deeper
    { x: 90, width: 1.2, kind: 'pallet' },
    { x: 111, width: 0.8, kind: 'bracket' },
  ],
};

export function buildLamps(level: LevelData, t: Tuning): LampState[] {
  const pivotY = t.lampCapBottomRest + t.lampR + t.lampL;
  return level.lamps.map((l, i) => ({
    id: i,
    x: l.x,
    pivotY,
    psi: 0,
    psiDot: 0,
    cooldown: 0,
    hits: 0,
    passed: false,
  }));
}

export function buildSteps(level: LevelData): StepObstacle[] {
  return level.steps.map((s, i) => ({
    id: i,
    x0: s.x,
    x1: s.x + s.width,
    hObj: STEP_HEIGHT[s.kind],
    kind: s.kind,
  }));
}
