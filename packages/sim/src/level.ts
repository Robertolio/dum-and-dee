import type { BeamObstacle, SoftObstacle, GenState, LampKind, LampState, StepObstacle, StepKind } from './state';
import type { Tuning } from './tuning';

export interface LevelLamp {
  x: number;
  kind?: LampKind;
  /** Initial swing angle (rad) and angular velocity. */
  psi?: number;
  psiDot?: number;
}
export interface LevelStep {
  x: number;
  width: number;
  kind: StepKind;
  /** Overrides the default height of the kind (stairs). */
  height?: number;
}
export interface LevelGenerator {
  seed: number;
  /** x of the first generated pattern. */
  startX: number;
}
export interface LevelData {
  id: string;
  lamps: LevelLamp[];
  steps: LevelStep[];
  beams?: { x0: number; x1: number; yBottom: number }[];
  softs?: { kind: 'balloon' | 'web'; x: number; y: number; r?: number; color?: number }[];
  /** Length of the hall in we (decorative). */
  length: number;
  /** Par time (s) for the level-end time bonus. */
  par?: number;
  theme?: 'factory' | 'studio';
  /** Endless procedural generation ahead of the ladder. */
  generator?: LevelGenerator;
}

export const STEP_HEIGHT: Record<StepKind, number> = {
  bracket: 0.3,
  crate: 0.5,
  pallet: 0.6,
  banana: 0.25,
  duck: 0.4,
  pail: 0.45,
  tyre: 0.4,
  cheese: 0.3,
  knife: 0.26,
  stair: 0.2,
};

/** Default footprint width (we) of each kind, used by the generator and the renderer. */
export const STEP_WIDTH: Record<StepKind, number> = {
  bracket: 0.8,
  crate: 1.0,
  pallet: 1.2,
  banana: 0.9,
  duck: 0.8,
  pail: 0.8,
  tyre: 1.0,
  cheese: 1.0,
  knife: 0.9,
  stair: 0.7,
};

/** Mass of pushable props: heavier ones slide less. */
export const STEP_MASS: Record<StepKind, number> = {
  bracket: 3,
  crate: 1.5,
  pallet: 2.5,
  banana: 0.3,
  duck: 0.4,
  pail: 0.5,
  tyre: 0.8,
  cheese: 0.7,
  knife: 0.6,
  stair: 99,
};

export function makeStep(id: number, x0: number, x1: number, hObj: number, kind: StepKind): StepObstacle {
  return { id, x0, x1, hObj, kind, mass: STEP_MASS[kind], vx: 0, slid: 0, used: false, passed: false, dirty: false };
}

const FLOOR_KINDS: StepKind[] = ['bracket', 'crate', 'pallet', 'banana', 'duck', 'pail', 'tyre', 'cheese'];

/** Fixed test level (no generator). */
export const PROTOTYPE_LEVEL: LevelData = {
  id: 'proto-factory',
  length: 140,
  lamps: [14, 34, 56, 78, 100, 122].map((x) => ({ x })),
  steps: [
    { x: 24, width: 1.0, kind: 'crate' },
    { x: 45, width: 0.8, kind: 'bracket' },
    { x: 66, width: 1.0, kind: 'crate' },
    { x: 76.5, width: 1.0, kind: 'crate' },
    { x: 90, width: 1.2, kind: 'pallet' },
    { x: 111, width: 0.8, kind: 'bracket' },
  ],
};

/** The real game: endless, procedurally generated with rising difficulty. */
export const ENDLESS_LEVEL: LevelData = {
  id: 'endless',
  length: 1e9,
  lamps: [],
  steps: [],
  generator: { seed: 20241028, startX: 16 },
};

export function makeLamp(id: number, x: number, kind: LampKind, t: Tuning, psi = 0, psiDot = 0): LampState {
  const meat = kind === 'meat';
  const len = meat ? t.meatL : t.lampL;
  const radius = meat ? t.meatR : t.lampR;
  return {
    id,
    kind,
    len,
    radius,
    damp: meat ? t.meatD : t.lampD,
    mass: meat ? t.meatM : t.lampM,
    x,
    pivotY: t.lampCapBottomRest + t.lampR + t.lampL,
    psi,
    psiDot,
    cooldown: 0,
    hits: 0,
    passed: false,
    broken: false,
  };
}

export function buildLamps(level: LevelData, t: Tuning): LampState[] {
  return level.lamps.map((l, i) => makeLamp(i, l.x, l.kind ?? 'lamp', t, l.psi ?? 0, l.psiDot ?? 0));
}

export function buildSteps(level: LevelData): StepObstacle[] {
  return level.steps.map((s, i) => makeStep(i, s.x, s.x + s.width, s.height ?? STEP_HEIGHT[s.kind], s.kind));
}

export function buildSofts(level: LevelData): SoftObstacle[] {
  return (level.softs ?? []).map((o, i) => ({ id: i, kind: o.kind, x: o.x, y: o.y, r: o.r ?? (o.kind === 'balloon' ? 0.38 : 0.5), color: o.color ?? 0, done: false }));
}

export function buildBeams(level: LevelData): BeamObstacle[] {
  return (level.beams ?? []).map((b, i) => ({ id: i, x0: b.x0, x1: b.x1, yBottom: b.yBottom, cooldown: 0 }));
}

// --- Procedural generation -------------------------------------------------

export function createGen(level: LevelData, existingLamps: number, existingSteps: number, existingBeams = 0, existingSofts = 0): GenState | null {
  if (!level.generator) return null;
  return {
    rng: level.generator.seed >>> 0,
    nextX: level.generator.startX,
    nextLampId: existingLamps,
    nextStepId: existingSteps,
    nextBeamId: existingBeams,
    nextSoftId: existingSofts,
    patterns: 0,
    last: -1,
    last2: -1,
    gapScale: 1,
  };
}

function rand(g: GenState): number {
  // mulberry32
  g.rng = (g.rng + 0x6d2b79f5) >>> 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const pick = <T>(g: GenState, arr: readonly T[]): T => arr[Math.floor(rand(g) * arr.length) % arr.length]!;

/** Difficulty 0…1, rising with distance. */
export function difficultyAt(x: number): number {
  return Math.min(1, Math.max(0, (x - 20) / 320));
}

function addStep(s: { steps: StepObstacle[] }, g: GenState, x: number, kind: StepKind, height?: number, width?: number): void {
  s.steps.push(makeStep(g.nextStepId++, x, x + (width ?? STEP_WIDTH[kind]), height ?? STEP_HEIGHT[kind], kind));
}

/** Cleaver(s) well before a hanging piece of meat: the front hand jumps, lands, and still has room to duck. */
export const KNIFE_TO_MEAT = 3.4;
function addKnives(s: { steps: StepObstacle[] }, g: GenState, meatX: number, minX: number): void {
  const w = STEP_WIDTH.knife;
  const x0 = meatX - KNIFE_TO_MEAT - w;
  addStep(s, g, x0, 'knife');
  if (rand(g) < 0.22 && x0 - w - 1.7 >= minX) addStep(s, g, x0 - w - 1.7, 'knife');
}

function addLamp(s: { lamps: LampState[] }, g: GenState, t: Tuning, x: number, kind: LampKind, psi = 0, psiDot = 0): void {
  s.lamps.push(makeLamp(g.nextLampId++, x, kind, t, psi, psiDot));
}

/** Pendulum starting at phase `phase` of a swing with amplitude `amp`. */
function swingState(amp: number, phase: number, len: number, t: Tuning): [number, number] {
  const w = Math.sqrt(t.g / len);
  return [amp * Math.cos(phase), -amp * w * Math.sin(phase)];
}

function addMeatSeries(s: { lamps: LampState[]; steps: StepObstacle[] }, g: GenState, t: Tuning, x: number, d: number): number {
  const n = 2 + Math.floor(rand(g) * (1 + d * 3)) + (d > 0.5 ? 1 : 0);
  const spacing = lerp(2.7, 2.15, d) + rand(g) * 0.3;
  const amp = lerp(t.meatAmpMin, t.meatAmpMax, rand(g) * 0.5 + d * 0.5);
  const dphase = pick(g, [0, Math.PI, Math.PI / 2, 0.7, 1.6]);
  const phase0 = rand(g) * Math.PI * 2;
  const knives = rand(g) < 0.7;
  const lead = knives ? KNIFE_TO_MEAT + STEP_WIDTH.knife + (rand(g) < 0.3 ? STEP_WIDTH.knife + 1.7 : 0) : 0;
  if (knives) addKnives(s, g, x + lead, x);
  for (let i = 0; i < n; i++) {
    const [psi, psiDot] = swingState(amp, phase0 + i * dphase, t.meatL, t);
    addLamp(s, g, t, x + lead + i * spacing, 'meat', psi, psiDot);
  }
  return lead + (n - 1) * spacing + 1;
}

function addStairs(s: { steps: StepObstacle[]; beams: BeamObstacle[] }, g: GenState, x: number, d: number): number {
  const n = 3 + Math.floor(rand(g) * 3); // 3…5 risers
  const rise = 0.2;
  const w = STEP_WIDTH.stair;
  const top = 1.8 + rand(g) * (1 + d);
  let cx = x;
  for (let i = 1; i <= n; i++) {
    addStep(s, g, cx, 'stair', rise * i, w);
    cx += w;
  }
  const plateau0 = cx;
  addStep(s, g, cx, 'stair', rise * n, top);
  cx += top;
  // Low ceiling beam above the stairs: only passable bent through the knees.
  s.beams.push({ id: g.nextBeamId++, x0: plateau0 - 1.2, x1: cx - 0.2, yBottom: rise * n + 1.75, cooldown: 0 });
  for (let i = n - 1; i >= 1; i--) {
    addStep(s, g, cx, 'stair', rise * i, w);
    cx += w;
  }
  return cx - x;
}

function addBalloons(s: { softs: SoftObstacle[] }, g: GenState, x: number, d: number): number {
  const n = 2 + Math.floor(rand(g) * 3);
  let cx = x;
  for (let i = 0; i < n; i++) {
    s.softs.push({ id: g.nextSoftId++, kind: 'balloon', x: cx, y: 1.7 + rand(g) * 1.0, r: 0.36 + rand(g) * 0.1, color: Math.floor(rand(g) * 6), done: false });
    cx += 1.1 + rand(g) * 0.9;
  }
  void d;
  return cx - x;
}

function addWebs(s: { softs: SoftObstacle[] }, g: GenState, x: number): number {
  const n = rand(g) < 0.35 ? 2 : 1;
  for (let i = 0; i < n; i++) s.softs.push({ id: g.nextSoftId++, kind: 'web', x: x + i * 2.6, y: 1.55 + rand(g) * 0.5, r: 0.5 + rand(g) * 0.12, color: 0, done: false });
  return (n - 1) * 2.6 + 1;
}

/** Emit one obstacle pattern at g.nextX and return its length. */
function emitPattern(s: { steps: StepObstacle[]; lamps: LampState[]; beams: BeamObstacle[]; softs: SoftObstacle[] }, g: GenState, t: Tuning): number {
  const x = g.nextX;
  const d = difficultyAt(x);
  const r = rand(g);
  const r2 = rand(g);
  g.patterns += 1;
  // The first few patterns are gentle: single obstacles.
  if (g.patterns <= 2) {
    if (g.patterns === 1) addLamp(s, g, t, x, 'lamp');
    else addStep(s, g, x, pick(g, ['crate', 'banana', 'duck', 'pail'] as const));
    return 1;
  }
  void r;
  void r2;
  g.gapScale = 1;
  // Weighted pick that never repeats the previous pattern, and avoids the one before it when possible.
  const weights = [3, 3, 2.4, 2, 1.6, 1.8, 1.6, 1.3, 1.1, 1.3, 1.2, 1.1, 1.0];
  let total = 0;
  for (let i = 0; i < weights.length; i++) if (i !== g.last) total += weights[i]! * (i === g.last2 ? 0.4 : 1) * (i === 2 && d < 0.1 ? 0.3 : 1);
  let roll = rand(g) * total;
  let kind = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === g.last) continue;
    roll -= weights[i]! * (i === g.last2 ? 0.4 : 1) * (i === 2 && d < 0.1 ? 0.3 : 1);
    if (roll <= 0) {
      kind = i;
      break;
    }
  }
  g.last2 = g.last;
  g.last = kind;
  switch (kind) {
    case 0:
      addStep(s, g, x, pick(g, FLOOR_KINDS.filter((k) => k !== 'banana')));
      return 1.2;
    case 1:
      addLamp(s, g, t, x, 'lamp');
      return 1;
    case 2:
      return addMeatSeries(s, g, t, x, d);
    case 3:
      return addStairs(s, g, x, d);
    case 4: {
      addStep(s, g, x, pick(g, FLOOR_KINDS));
      const gap = lerp(7, 5.5, d) + rand(g);
      if (rand(g) < 0.5 + d * 0.3) {
        const [psi, psiDot] = swingState(lerp(t.meatAmpMin, t.meatAmpMax, rand(g)), rand(g) * 6.28, t.meatL, t);
        addLamp(s, g, t, x + gap, 'meat', psi, psiDot);
        addKnives(s, g, x + gap, x + 1.6);
      } else addLamp(s, g, t, x + gap, 'lamp');
      return gap + 1.2;
    }
    case 5: {
      const n = 2 + (rand(g) < d ? 1 : 0);
      const spacing = lerp(4.2, 3.2, d);
      let prev: StepKind | null = null;
      for (let i = 0; i < n; i++) {
        let k = pick(g, FLOOR_KINDS);
        if (k === prev) k = pick(g, FLOOR_KINDS);
        addStep(s, g, x + i * spacing, k);
        prev = k;
      }
      return (n - 1) * spacing + 1.2;
    }
    case 6:
      return addBalloons(s, g, x, d);
    case 7:
      return addWebs(s, g, x);
    case 8: {
      // Banana trail: slippery, with room to jump or sidestep in between.
      const n = 2 + (rand(g) < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) addStep(s, g, x + i * 3.4, 'banana');
      return (n - 1) * 3.4 + 1;
    }
    case 9: {
      // Two lamps with a gap: a short rhythm.
      addLamp(s, g, t, x, 'lamp');
      addLamp(s, g, t, x + 3.1 + rand(g) * 0.8, 'lamp');
      return 4.5;
    }
    case 10: {
      // Quiet stretch: just a few balloons high up, then breathing room.
      g.gapScale = 1.6;
      return addBalloons(s, g, x, 0) * 0.5;
    }
    case 11: {
      // Busy combo: a prop with a web or balloons right behind it.
      addStep(s, g, x, pick(g, ['duck', 'pail', 'tyre', 'cheese', 'crate'] as const));
      if (rand(g) < 0.5) s.softs.push({ id: g.nextSoftId++, kind: 'web', x: x + 3.4, y: 1.6, r: 0.55, color: 0, done: false });
      else s.softs.push({ id: g.nextSoftId++, kind: 'balloon', x: x + 3.0, y: 1.9 + rand(g) * 0.6, r: 0.4, color: Math.floor(rand(g) * 6), done: false });
      g.gapScale = 0.85;
      return 4.2;
    }
    default: {
      // Meat first, then a prop a good stretch later.
      const m = addMeatSeries(s, g, t, x, d * 0.7);
      addStep(s, g, x + m + 3.4, pick(g, FLOOR_KINDS));
      g.gapScale = 0.9;
      return m + 4.6;
    }
  }
}

/** Keep generating until `horizon` we ahead of the ladder; drop obstacles far behind it. */
export function extendLevel(s: { gen: GenState | null; steps: StepObstacle[]; lamps: LampState[]; beams: BeamObstacle[]; softs: SoftObstacle[] }, ladderX: number, t: Tuning, horizon = 36): void {
  const g = s.gen;
  if (!g) return;
  while (g.nextX < ladderX + horizon) {
    const len = emitPattern(s, g, t);
    const d = difficultyAt(g.nextX);
    g.nextX += len + (lerp(10, 6.5, d) + rand(g) * 3) * g.gapScale;
  }
  const keep = ladderX - 14;
  if (s.steps.length > 0 && s.steps[0]!.x1 < keep) s.steps = s.steps.filter((o) => o.x1 >= keep);
  if (s.softs.length > 0 && s.softs[0]!.x < keep) s.softs = s.softs.filter((o) => o.x >= keep);
  if (s.beams.length > 0 && s.beams[0]!.x1 < keep) s.beams = s.beams.filter((b) => b.x1 >= keep);
  if (s.lamps.length > 0 && s.lamps[0]!.x < keep) s.lamps = s.lamps.filter((l) => l.x >= keep);
}
