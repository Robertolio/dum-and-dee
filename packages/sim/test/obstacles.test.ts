import { describe, expect, it } from 'vitest';
import { lampCapCenter, type LevelData, type PlayerInput } from '../src/index';
import { bent, freshState, runFor, runWith, T, upright } from './helpers';

const LAMP_LEVEL: LevelData = { id: 'lamp', lamps: [{ x: 14 }], steps: [], length: 50 };
const CRATE_LEVEL: LevelData = { id: 'crate', lamps: [], steps: [{ x: 12, width: 1, kind: 'crate' }], length: 50 };

describe('hanging lamp', () => {
  it('walking under it upright hits the lamp: it swings, ticks a few times, costs water and never a life', () => {
    const s = freshState(LAMP_LEVEL);
    const stats = runFor(s, upright(0.6), upright(0.6), 8);
    const hits = stats.events.filter((e) => e.type === 'lampHit');
    const ticks = stats.events.filter((e) => e.type === 'lampTick');
    expect(hits).toHaveLength(1);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks.length).toBeLessThanOrEqual(4);
    expect(s.bucket.water).toBeLessThan(100 - T.lampFirstSplash);
    expect(s.lives).toBe(T.startLives);
    expect(stats.events.some((e) => e.type === 'lampClean')).toBe(false);
    // The lamp was set swinging.
    const lamp = s.lamps[0]!;
    expect(Math.abs(lamp.psi) + Math.abs(lamp.psiDot)).toBeGreaterThan(0.05);
  });

  it('the wave (Dee low first, then switch, then Dum low) passes clean and scores', () => {
    const s = freshState(LAMP_LEVEL);
    const lampX = 14;
    const stats = runWith(
      s,
      (st): [PlayerInput, PlayerInput] => {
        const [a, b] = st.players;
        const u = (lampX - a.x) / (b.x - a.x); // 1 = at Dee, 0 = at Dum
        if (u > 0.5 && u < 1.45) return [upright(0.6), bent(0.6)];
        if (u <= 0.5 && u > -0.45) return [bent(0.6), upright(0.6)];
        return [upright(0.6), upright(0.6)];
      },
      10,
    );
    expect(stats.events.some((e) => e.type === 'lampHit')).toBe(false);
    expect(stats.events.some((e) => e.type === 'lampClean')).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(T.scoreLampClean);
    expect(s.lives).toBe(T.startLives);
  });

  it('Dee rising too early (lamp still over the front half) hits the lamp', () => {
    const s = freshState(LAMP_LEVEL);
    const stats = runWith(
      s,
      (st): [PlayerInput, PlayerInput] => {
        const [a, b] = st.players;
        const u = (14 - a.x) / (b.x - a.x);
        if (u > 0.85 && u < 1.45) return [upright(0.6), bent(0.6)];
        if (u <= 0.85 && u > -0.45) return [bent(0.6), upright(0.6)]; // switched too early
        return [upright(0.6), upright(0.6)];
      },
      10,
    );
    expect(stats.events.some((e) => e.type === 'lampHit')).toBe(true);
  });

  it('a lamp at rest hangs with its cap bottom at 1.5 we', () => {
    const s = freshState(LAMP_LEVEL);
    const cap = lampCapCenter(s.lamps[0]!, T);
    expect(cap.y - T.lampR).toBeCloseTo(T.lampCapBottomRest, 6);
  });
});

describe('step-ups', () => {
  it('stepping on a crate without bending raises the hand and shocks the bucket', () => {
    const s = freshState(CRATE_LEVEL);
    let maxYB = 0;
    const stats = runWith(
      s,
      (st) => {
        maxYB = Math.max(maxYB, st.players[1].y);
        return [upright(0.6), upright(0.6)];
      },
      6,
    );
    expect(maxYB).toBeGreaterThan(1.8 + 0.45);
    expect(stats.events.some((e) => e.type === 'stepMissed' && e.player === 1)).toBe(true);
    expect(s.bucket.water).toBeLessThan(100);
  });

  it('bending along with the step keeps the hand still: caught, no loss, +50', () => {
    const s = freshState(CRATE_LEVEL);
    const follow = (st: typeof s): [PlayerInput, PlayerInput] => [
      { push: 0.6, hTarget: T.hUpright - st.players[0].yFloor / T.yHandRange },
      { push: 0.6, hTarget: T.hUpright - st.players[1].yFloor / T.yHandRange },
    ];
    runWith(s, follow, 2); // walk-start swing has damped out, crate still ahead
    const before = s.bucket.water;
    const stats = runWith(s, follow, 4);
    const caught = stats.events.filter((e) => e.type === 'stepCaught');
    expect(caught.length).toBeGreaterThanOrEqual(2); // Dee on and off (Dum may follow later)
    expect(stats.events.some((e) => e.type === 'stepMissed')).toBe(false);
    expect(s.score).toBeGreaterThanOrEqual(2 * T.scoreStepCaught);
    const lossCaught = before - s.bucket.water;

    // Same crate without bending: more shock, more water lost.
    const m = freshState(CRATE_LEVEL);
    runFor(m, upright(0.6), upright(0.6), 2);
    const beforeMiss = m.bucket.water;
    const missStats = runFor(m, upright(0.6), upright(0.6), 4);
    const lossMissed = beforeMiss - m.bucket.water;
    expect(missStats.peakAPy).toBeGreaterThan(stats.peakAPy);
    expect(lossMissed).toBeGreaterThan(lossCaught);
    expect(lossCaught).toBeLessThan(1);
  });

  it('the ladder never collides with floor obstacles (no lamp-style events from a crate)', () => {
    const s = freshState(CRATE_LEVEL);
    const stats = runFor(s, upright(0.6), upright(0.6), 8);
    expect(stats.events.some((e) => e.type === 'lampHit' || e.type === 'lampTick')).toBe(false);
    expect(s.lives).toBe(T.startLives);
  });
});
