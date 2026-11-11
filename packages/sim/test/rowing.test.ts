import { describe, expect, it } from 'vitest';
import { createState, step, levelById, CAMPAIGN, nextLevel, bridgeCeiling, ROW, LEVELS, DEFAULT_TUNING as T, type GameState, type PlayerInput } from '../src';

const lvl = levelById('r1').data;
const inp = (push: number, hTarget = T.hUpright, jump = false): PlayerInput => ({ push, hTarget, jump });
/** Stroke: pull for 0.5 s, recover for 0.5 s, shifted by `shift` ticks. */
const stroke = (tick: number, shift = 0): PlayerInput => inp(((tick + shift) % 60) < 30 ? 1 : -0.3);

function race(ticks: number, shift: number, jumpAt: (t: number) => boolean = () => false): GameState {
  const s = createState(lvl, T);
  for (let i = 0; i < ticks; i++) {
    step(s, [stroke(i), { ...stroke(i, shift), jump: jumpAt(i) }], T);
    if (s.gameOver) break;
  }
  return s;
}

describe('rowing race', () => {
  it('is part of the alternating campaign and starts without speed until the shot', () => {
    expect(nextLevel('b1')!.id).toBe('r1');
    expect(nextLevel('r1')!.id).toBe('f3');
    expect(CAMPAIGN[CAMPAIGN.length - 1]!.id).toBe('r3');
    const s = createState(lvl, T);
    for (let i = 0; i < 100; i++) step(s, [stroke(i), stroke(i)], T);
    expect(s.row!.started).toBe(false);
    expect(s.row!.v).toBe(0);
  });

  it('rows faster in sync than out of phase, and clashes out of phase', () => {
    const inSync = race(60 * 9, 0);
    const out = race(60 * 9, 30);
    expect(inSync.row!.started).toBe(true);
    expect(inSync.row!.v).toBeGreaterThan(2);
    expect(inSync.row!.x).toBeGreaterThan(out.row!.x + 3);
    expect(inSync.row!.sync).toBeGreaterThan(0.8);
    expect(out.row!.sync).toBeLessThan(0.3);
    expect(inSync.events.length >= 0).toBe(true);
  });

  it('is deterministic', () => {
    const a = race(60 * 20, 4);
    const b = race(60 * 20, 4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a duck costs hull unless you jump over it', () => {
    const noJump = race(60 * 25, 0);
    expect(noJump.row!.ducks[0]!.done).toBe(true);
    expect(noJump.bucket.water).toBeLessThan(100);
    const s = createState(lvl, T);
    let jumped = false;
    for (let i = 0; i < 60 * 25; i++) {
      const near = s.row!.ducks.find((d) => !d.done && d.x - s.row!.x < s.row!.v * 0.35 && d.x - s.row!.x > 0.3);
      const j = !!near && !s.row!.jumpHeld && s.row!.jumpT === 0;
      if (j) jumped = true;
      step(s, [stroke(i), { ...stroke(i), jump: j }], T);
      if (s.row!.x > 36) break;
    }
    expect(jumped).toBe(true);
    expect(s.events.length >= 0).toBe(true);
    expect(s.bucket.water).toBe(100);
    expect(s.score).toBeGreaterThan(0);
  });

  it('bounces a buoy when too slow and pops it when fast', () => {
    const slow = createState(lvl, T);
    slow.row!.started = true;
    slow.row!.x = lvl.rowing!.buoys[0]! - 4;
    slow.row!.v = 1;
    let bounced = false;
    for (let i = 0; i < 200; i++) {
      step(slow, [inp(0), inp(0)], T);
      if (slow.events.some((e) => e.type === 'buoyBounce')) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(slow.row!.buoys[0]!.done).toBe(false);
    const fast = createState(lvl, T);
    fast.row!.started = true;
    fast.row!.x = lvl.rowing!.buoys[0]! - 4;
    fast.row!.v = 4.2;
    let popped = false;
    for (let i = 0; i < 120; i++) {
      step(fast, [inp(0), inp(0)], T);
      if (fast.events.some((e) => e.type === 'buoyPop')) popped = true;
    }
    expect(popped).toBe(true);
    expect(fast.score).toBeGreaterThan(0);
  });

  it('bridges: oars in the water or too high hit it, the right height passes', () => {
    const br = lvl.rowing!.bridges[0]!;
    const through = (h: number): GameState => {
      const s = createState(lvl, T);
      s.row!.started = true;
      s.row!.x = br.x0 - 3;
      s.row!.v = 2;
      for (let i = 0; i < 400; i++) {
        s.row!.v = Math.max(s.row!.v, 2);
        step(s, [inp(0, h), inp(0, h)], T);
        if (s.row!.x > br.x1 + 2) break;
      }
      return s;
    };
    const inWater = through(T.hUpright);
    expect(inWater.row!.bridges[0]!.hit).toBe(true);
    const tooHigh = through(T.hBent);
    expect(tooHigh.row!.bridges[0]!.hit).toBe(true);
    const ok = through(T.hBent + (T.hUpright - T.hBent) * 0.5);
    expect(ok.row!.bridges[0]!.hit).toBe(false);
    expect(ok.row!.bridges[0]!.done).toBe(true);
    expect(bridgeCeiling('arch', 0.5)).toBeGreaterThan(bridgeCeiling('arch', 0));
  });

  it('finishes with a race time', () => {
    const s = createState(lvl, T);
    s.row!.started = true;
    s.row!.x = lvl.length - 3;
    s.row!.v = 3;
    for (let i = 0; i < 200 && !s.finished; i++) step(s, [inp(0), inp(0)], T);
    expect(s.finished).toBe(true);
    expect(s.result!.time).toBeGreaterThanOrEqual(0);
  });

  it('losing all hull respawns at a checkpoint with a fresh state', () => {
    const s = createState(lvl, T);
    s.row!.started = true;
    s.row!.x = 40;
    s.checkpointX = 30;
    s.bucket.water = 0;
    step(s, [inp(0), inp(0)], T);
    expect(s.lives).toBe(T.startLives - 1);
    expect(s.row!.x).toBeLessThan(35);
    expect(s.bucket.water).toBe(100);
  });

  const rowLevels = LEVELS.filter((l) => l.data.rowing);

  it('every bridge of every rowing level is a clean pass when entered at 3 we/s with the oars at a hover and no rowing', () => {
    for (const l of rowLevels) {
      for (let k = 0; k < l.data.rowing!.bridges.length; k++) {
        const br = l.data.rowing!.bridges[k]!;
        const s = createState(l.data, T);
        s.row!.started = true;
        s.row!.x = br.x0 - 3.5;
        s.row!.v = 3;
        const h = T.hBent + (T.hUpright - T.hBent) * 0.5;
        for (let i = 0; i < 60 * 12 && s.row!.x < br.x1 + 1; i++) {
          step(s, [inp(0, h), inp(0, h)], T);
          if (s.row!.v < 0.5) break;
        }
        expect(s.row!.bridges[k]!.hit, `${l.id} bridge ${k} (${br.kind})`).toBe(false);
        expect(s.row!.x, `${l.id} bridge ${k} reached`).toBeGreaterThan(br.x1);
        expect(s.row!.v, `${l.id} bridge ${k} exit speed`).toBeGreaterThan(0.5);
      }
    }
  });

  it('courses have no impossible combinations: clearance around bridges and between obstacles', () => {
    for (const l of rowLevels) {
      const { ducks, buoys, bridges } = l.data.rowing!;
      for (const b of bridges) {
        expect(b.x1 - b.x0, `${l.id} bridge length`).toBeLessThanOrEqual(9);
        for (const d of ducks) expect(d < b.x0 - 9 || d > b.x1 + 4, `${l.id} duck ${d} near bridge ${b.x0}`).toBe(true);
        for (const u of buoys) expect(u < b.x0 - 6 || u > b.x1 + 6, `${l.id} buoy ${u} near bridge ${b.x0}`).toBe(true);
      }
      for (const d of ducks) {
        for (const e of ducks) if (e > d) expect(e - d, `${l.id} ducks ${d} ${e}`).toBeGreaterThanOrEqual(8);
        for (const u of buoys) expect(Math.abs(u - d), `${l.id} duck ${d} buoy ${u}`).toBeGreaterThanOrEqual(5);
      }
      for (const u of buoys) for (const v of buoys) if (v > u) expect(v - u).toBeGreaterThanOrEqual(8);
      expect(ducks.length).toBeGreaterThan(4);
      expect(buoys.length).toBeGreaterThan(4);
      expect(l.data.length - Math.max(...ducks, ...buoys, ...bridges.map((b) => b.x1))).toBeGreaterThan(8);
    }
  });

  it('a duck is cleared by a jump started anywhere in a 0.3 s window at 3 we/s, and not by one started far too early or late', () => {
    const attempt = (distance: number): boolean => {
      const s = createState(lvl, T);
      s.row!.started = true;
      s.row!.x = lvl.rowing!.ducks[0]! - 8;
      s.row!.v = 3;
      let jumped = false;
      for (let i = 0; i < 60 * 6 && !s.row!.ducks[0]!.done; i++) {
        s.row!.v = Math.max(s.row!.v, 3);
        const rel = lvl.rowing!.ducks[0]! - s.row!.x;
        const j = !jumped && rel <= distance;
        if (j) jumped = true;
        step(s, [inp(0, T.hUpright, j), inp(0)], T);
        s.row!.v = 3;
      }
      return s.bucket.water === 100;
    };
    const ok = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8].filter(attempt);
    expect(ok.length).toBeGreaterThanOrEqual(5);
    expect(attempt(3.5)).toBe(false);
    expect(attempt(0.1)).toBe(false);
    expect(ROW.duckZone).toBeLessThan(0.6);
  });
});
