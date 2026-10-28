import { describe, expect, it } from 'vitest';
import { createState, step } from '../src/index';
import { bent, freshState, runFor, T, upright } from './helpers';

describe('bucket: water is only lost through shocks', () => {
  it('a calmly held tilted ladder costs nothing', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 1); // bend (small cost while moving)
    const w0 = s.bucket.water;
    const stats = runFor(s, bent(), upright(), 5); // hold the tilt
    expect(s.bucket.water).toBe(w0);
    expect(stats.peakAPy).toBeLessThan(0.01);
    expect(Math.abs(s.bucket.phi)).toBeLessThan(0.01);
  });

  it('standing still with a level ladder costs nothing', () => {
    const s = freshState();
    runFor(s, upright(), upright(), 5);
    expect(s.bucket.water).toBe(100);
  });

  it('switching simultaneously keeps the suspension point still: (almost) no loss', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 2);
    const w0 = s.bucket.water;
    const stats = runFor(s, upright(), bent(), 2);
    expect(stats.peakAPy).toBeLessThan(T.aSafe);
    expect(w0 - s.bucket.water).toBeLessThan(0.3);
  });

  it('switching one after the other drops and lifts the bucket: clear loss', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 2);
    const w0 = s.bucket.water;
    const stats1 = runFor(s, bent(), bent(), 0.3);
    const stats2 = runFor(s, upright(), bent(), 2);
    expect(Math.max(stats1.peakAPy, stats2.peakAPy)).toBeGreaterThan(T.aSafe);
    expect(w0 - s.bucket.water).toBeGreaterThan(2);
  });

  it('a sequential switch costs clearly more than a simultaneous one', () => {
    const sim = freshState();
    runFor(sim, bent(), upright(), 2);
    const wSim0 = sim.bucket.water;
    runFor(sim, upright(), bent(), 2);
    const lossSim = wSim0 - sim.bucket.water;

    const seq = freshState();
    runFor(seq, bent(), upright(), 2);
    const wSeq0 = seq.bucket.water;
    runFor(seq, bent(), bent(), 0.3);
    runFor(seq, upright(), bent(), 2);
    const lossSeq = wSeq0 - seq.bucket.water;

    expect(lossSeq).toBeGreaterThan(lossSim * 5);
  });

  it('hard braking swings the bucket and spills', () => {
    const s = freshState();
    runFor(s, upright(0.6), upright(0.6), 3);
    const w0 = s.bucket.water;
    const stats = runFor(s, upright(-0.3), upright(-0.3), 2);
    expect(stats.peakPhiDeg).toBeGreaterThan(T.phiSafeDeg);
    expect(w0 - s.bucket.water).toBeGreaterThan(1);
  });

  it('an empty bucket costs one life and is replaced by a full one; the game goes on', () => {
    const s = freshState();
    s.bucket.water = 0.5;
    const stats = runFor(s, bent(), bent(), 0.5); // bending both → shock → water hits 0
    expect(stats.events.some((e) => e.type === 'bucketEmpty')).toBe(true);
    expect(s.lives).toBe(T.startLives - 1);
    expect(s.bucket.water).toBeGreaterThan(90);
    expect(s.gameOver).toBe(false);
  });

  it('water stays within 0…100 and nothing becomes NaN', () => {
    const s = freshState();
    for (let i = 0; i < 2000; i++) {
      const a = { push: 0.6 + 0.4 * Math.sin(i / 9), hTarget: 0.5 + 0.5 * Math.sin(i / 5) };
      const b = { push: 0.6, hTarget: 0.5 + 0.5 * Math.cos(i / 4) };
      step(s, [a, b], T);
      expect(s.bucket.water).toBeGreaterThanOrEqual(0);
      expect(s.bucket.water).toBeLessThanOrEqual(100);
      expect(Number.isNaN(s.bucket.phi)).toBe(false);
      expect(Number.isNaN(s.players[0].x)).toBe(false);
    }
  });
});

describe('determinism', () => {
  it('two runs with identical inputs give identical state', () => {
    const s1 = createState();
    const s2 = createState();
    for (let i = 0; i < 3000; i++) {
      const a = { push: 0.6 + 0.4 * Math.sin(i / 30), hTarget: 0.5 + 0.5 * Math.sin(i / 17) };
      const b = { push: 0.6, hTarget: 0.5 + 0.5 * Math.cos(i / 23) };
      step(s1, [a, b], T);
      step(s2, [a, b], T);
    }
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});
