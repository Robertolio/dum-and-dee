import { DEFAULT_TUNING } from './tuning';
import type { LevelData } from './level';
import { createGen, emitKind, ENDLESS_LEVEL, type LevelHint } from './level';
import type { BeamObstacle, LampState, SoftObstacle, StepObstacle } from './state';

export interface LevelDef {
  id: string;
  name: string;
  theme: 'factory' | 'studio';
  endless: boolean;
  data: LevelData;
  blurb: string;
}

type Item = [kind: number, d: number, hint?: string];

/** Compose a scripted level from fixed pattern kinds (seeded content, fixed order and spacing). */
function compose(id: string, theme: 'factory' | 'studio', seed: number, items: Item[], _par: number, gap = 7.5): LevelData {
  const t = DEFAULT_TUNING;
  const g = createGen({ id, lamps: [], steps: [], length: 0, generator: { seed, startX: 14 }, theme }, 0, 0)!;
  const s = { steps: [] as StepObstacle[], lamps: [] as LampState[], beams: [] as BeamObstacle[], softs: [] as SoftObstacle[] };
  const hints: LevelHint[] = [];
  let x = 14;
  for (const [kind, d, hint] of items) {
    if (hint) hints.push({ x: x - 8, text: hint });
    g.gapScale = 1;
    const len = emitKind(s, g, t, kind, x, d);
    x += len + (gap - 2 * d) * g.gapScale;
  }
  return {
    id,
    theme,
    par: Math.round((x + 6) / 2.6),
    hints,
    length: Math.round(x + 6),
    lamps: s.lamps.map((l) => ({ x: l.x, kind: l.kind, psi: l.psi, psiDot: l.psiDot })),
    steps: s.steps.map((o) => ({ x: o.x0, width: o.x1 - o.x0, kind: o.kind, height: o.hObj })),
    beams: s.beams.map((b) => ({ x0: b.x0, x1: b.x1, yBottom: b.yBottom })),
    softs: s.softs.map((o) => ({ kind: o.kind, x: o.x, y: o.y, r: o.r, color: o.color })),
  };
}

const F = 'factory';
const factory: LevelDef[] = [
  {
    id: 'f0',
    name: 'Tutorial',
    blurb: 'Learn to jump, duck and pop',
    items: [
      [0, 0, 'Jump over props: flick your thumb up'],
      [1, 0, 'Duck under lamps: drag down to bend'],
      [8, 0, 'Bananas make you slip!'],
      [6, 0, 'Pop balloons with the ladder'],
      [7, 0, 'Sweep cobwebs away'],
      [3, 0, 'Stairs: duck under the beam'],
      [2, 0, 'Hanging meat swings, so time it'],
    ],
    seed: 11,
    par: 55,
    gap: 13,
  },
  { id: 'f1', name: 'Loading dock', blurb: 'Crates and a few lamps', items: [[0, 0.05], [1, 0.05], [6, 0.05], [0, 0.1], [9, 0.1], [7, 0.1], [5, 0.1], [1, 0.1], [6, 0.1], [0, 0.15]], seed: 21, par: 70, gap: 11.5 },
  { id: 'f2', name: 'Butcher aisle', blurb: 'Swinging meat and cleavers', items: [[2, 0.2], [0, 0.2], [4, 0.2], [6, 0.2], [2, 0.25], [8, 0.25], [1, 0.25], [12, 0.25], [7, 0.25], [5, 0.3], [2, 0.3], [9, 0.3]], seed: 31, par: 85, gap: 10 },
  { id: 'f3', name: 'Stairway', blurb: 'Climb, duck and balance', items: [[3, 0.35], [0, 0.35], [4, 0.35], [3, 0.4], [6, 0.4], [11, 0.4], [2, 0.4], [3, 0.45], [8, 0.45], [9, 0.45], [5, 0.45], [3, 0.5], [1, 0.5], [12, 0.5]], seed: 41, par: 100, gap: 9 },
  { id: 'f4', name: 'Night shift', blurb: 'Busy and tricky', items: [[11, 0.55], [2, 0.55], [3, 0.55], [8, 0.6], [4, 0.6], [9, 0.6], [5, 0.6], [12, 0.65], [3, 0.65], [7, 0.65], [2, 0.7], [11, 0.7], [9, 0.7], [4, 0.7], [3, 0.7], [5, 0.7]], seed: 51, par: 120, gap: 8.5 },
  { id: 'f5', name: 'Rush hour', blurb: 'Everything at once', items: [[2, 0.8], [3, 0.8], [11, 0.8], [9, 0.85], [4, 0.85], [8, 0.85], [12, 0.85], [5, 0.9], [3, 0.9], [2, 0.9], [11, 0.9], [9, 0.9], [4, 0.95], [3, 0.95], [5, 0.95], [12, 0.95], [2, 1], [3, 1]], seed: 61, par: 140, gap: 8 },
].map((l) => ({
  id: l.id,
  name: l.name,
  theme: F as 'factory',
  endless: false,
  blurb: l.blurb,
  data: compose(l.id, F, l.seed, l.items as Item[], l.par, l.gap),
}));

const studio: LevelDef[] = [
  { id: 's1', name: 'Newsroom', blurb: 'Fans, desks and papers', seed: 71, gap: 11, items: [[0, 0.1, 'Welcome to the studio: speakers to jump over'], [14, 0.1, 'Push through the fan: papers fly!'], [1, 0.1], [13, 0.15], [0, 0.2], [15, 0.2, 'Flip the weather map to sunshine'], [2, 0.25], [14, 0.25], [5, 0.3]] },
  { id: 's2', name: 'Quiz night', blurb: 'Spin the wheel', seed: 81, gap: 10, items: [[13, 0.3], [1, 0.3], [0, 0.35], [2, 0.35], [15, 0.4], [9, 0.4], [13, 0.4], [4, 0.45], [14, 0.45], [5, 0.5], [3, 0.5]] },
  { id: 's3', name: 'Talk show', blurb: 'Mind the lamps. It gets dark', seed: 91, gap: 9, items: [[1, 0.55], [9, 0.55], [2, 0.6], [15, 0.6], [11, 0.6], [4, 0.65], [13, 0.65], [9, 0.7], [2, 0.7], [14, 0.7], [3, 0.75], [12, 0.75], [5, 0.8], [1, 0.8]] },
].map((l) => ({
  id: l.id,
  name: l.name,
  theme: 'studio' as const,
  endless: false,
  blurb: l.blurb,
  data: compose(l.id, 'studio', l.seed, l.items as Item[], 0, l.gap),
}));

const endlessStudio: LevelDef = {
  id: 'endless-studio',
  name: 'Endless Studio',
  theme: 'studio',
  endless: true,
  blurb: 'Run through the studio',
  data: { id: 'endless-studio', length: 1e9, lamps: [], steps: [], theme: 'studio', generator: { seed: 777001, startX: 16 } },
};

const endlessFactory: LevelDef = {
  id: 'endless-factory',
  name: 'Endless Factory',
  theme: 'factory',
  endless: true,
  blurb: 'Run as far as you can',
  data: ENDLESS_LEVEL,
};

export const LEVELS: LevelDef[] = [...factory, endlessFactory, ...studio, endlessStudio];

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? endlessFactory;
}
