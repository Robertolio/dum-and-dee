import { describe, expect, it } from 'vitest';
import { advanceWalk, createState, createWalkAnim, ENDLESS_LEVEL, footPose, WALK_STRIDE, type LevelData } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

describe('ladder overhang', () => {
  it('overhangs the hands by 1.2 we on each side', () => {
    expect(T.ladderOverhang).toBeGreaterThanOrEqual(1.2);
    expect(T.ladderLength).toBeCloseTo(T.L0 + 2 * T.ladderOverhang, 6);
  });
});

describe('endless level', () => {
  it('generates obstacles far beyond the old 140 we hall, deterministically, and prunes behind', () => {
    const a = createState(ENDLESS_LEVEL, T);
    const b = createState(ENDLESS_LEVEL, T);
    for (const s of [a, b]) {
      for (const p of s.players) p.x += 400;
      runFor(s, upright(0.6), upright(0.6), 3);
    }
    expect(JSON.stringify(a.lamps)).toBe(JSON.stringify(b.lamps));
    expect(a.gen!.nextX).toBeGreaterThan(430);
    expect(a.lamps.length + a.steps.length).toBeGreaterThan(0);
    expect(Math.min(...a.steps.map((o) => o.x1), ...a.lamps.map((l) => l.x))).toBeGreaterThan(380);
  });

  it('contains every obstacle type and meat series', () => {
    const kinds = new Set<string>();
    let meat = 0;
    const s = createState(ENDLESS_LEVEL, T);
    const seen = new Set<string>();
    for (let x = 0; x <= 1500; x += 20) {
      s.players[0].x = x;
      s.players[1].x = x + T.L0;
      runFor(s, upright(0), upright(0), 1 / 60);
      for (const o of s.steps) kinds.add(o.kind);
      for (const l of s.lamps) {
        kinds.add(l.kind);
        if (l.kind === 'meat' && !seen.has(`m${l.id}`)) {
          seen.add(`m${l.id}`);
          meat++;
        }
      }
    }
    for (const k of ['crate', 'banana', 'duck', 'pail', 'tyre', 'cheese', 'stair', 'lamp', 'meat']) expect(kinds.has(k)).toBe(true);
    expect(meat).toBeGreaterThan(5);
  });

  it('hanging meat swings by itself, is big, and knocks the ladder like a lamp', () => {
    const level: LevelData = { id: 'm', lamps: [{ x: 14, kind: 'meat', psi: 0.5 }], steps: [], length: 50 };
    const s = freshState(level);
    const m = s.lamps[0]!;
    expect(m.radius).toBeGreaterThan(T.lampR);
    let minPsi = m.psi;
    let maxPsi = m.psi;
    for (let i = 0; i < 180; i++) {
      runFor(s, { push: 0, hTarget: T.hUpright }, { push: 0, hTarget: T.hUpright }, 1 / 60);
      minPsi = Math.min(minPsi, m.psi);
      maxPsi = Math.max(maxPsi, m.psi);
    }
    expect(minPsi).toBeLessThan(-0.3);
    expect(maxPsi).toBeGreaterThan(0.3);
    const w = freshState(level);
    const stats = runFor(w, upright(0.6), upright(0.6), 8);
    expect(stats.events.some((e) => e.type === 'lampHit')).toBe(true);
    expect(w.lives).toBe(T.startLives);
  });
});

describe('stairs', () => {
  const STAIRS: LevelData = {
    id: 'stairs',
    lamps: [],
    steps: [
      { x: 10, width: 0.7, kind: 'stair', height: 0.2 },
      { x: 10.7, width: 0.7, kind: 'stair', height: 0.4 },
      { x: 11.4, width: 0.7, kind: 'stair', height: 0.6 },
      { x: 12.1, width: 4, kind: 'stair', height: 0.6 },
      { x: 16.1, width: 0.7, kind: 'stair', height: 0.4 },
      { x: 16.8, width: 0.7, kind: 'stair', height: 0.2 },
    ],
    length: 50,
  };
  it('players climb and descend automatically, the ladder tilts, nothing breaks', () => {
    const s = freshState(STAIRS);
    let maxTilt = 0;
    let maxFloor = 0;
    for (let i = 0; i < 60 * 9; i++) {
      runFor(s, { push: 0.6, hTarget: T.hUpright }, { push: 0.6, hTarget: T.hUpright }, 1 / 60);
      maxTilt = Math.max(maxTilt, Math.abs(s.ladder.theta));
      maxFloor = Math.max(maxFloor, s.players[0].yFloor, s.players[1].yFloor);
    }
    expect(maxFloor).toBeGreaterThan(0.55);
    expect(maxTilt).toBeGreaterThan(0.05);
    expect(s.players[0].yFloor).toBeLessThan(0.05);
    expect(s.players[1].yFloor).toBeLessThan(0.05);
    expect(s.lives).toBe(T.startLives);
  });
});

describe('walk cycle', () => {
  it('stands still when not moving and feet travel backwards at ground speed when planted', () => {
    const w = createWalkAnim(0);
    expect(advanceWalk(w, 0, 1 / 60)).toBe(0);
    expect(w.phase).toBe(0);
    let x = 0;
    const v = 3;
    for (let i = 0; i < 30; i++) {
      x += v / 60;
      advanceWalk(w, x, 1 / 60);
    }
    // Foot velocity relative to body at phase where sin = ±1 equals −v.
    const ph = Math.PI / 2;
    const eps = 1e-4;
    const f0 = footPose(ph, 1, 0).dx;
    const f1 = footPose(ph + eps, 1, 0).dx;
    const relV = ((f1 - f0) / eps) * (v / WALK_STRIDE);
    expect(relV).toBeCloseTo(-v, 1);
    expect(footPose(ph, 1, 0).lift).toBe(0);
  });
});
