import { describe, expect, it } from 'vitest';
import { DEG, ladderHeightAt, yHand } from '../src/index';
import { bent, freshState, posture, runFor, T, upright } from './helpers';

describe('ladder angle', () => {
  it('is level when both players stand upright', () => {
    const s = freshState();
    runFor(s, upright(), upright(), 1);
    expect(Math.abs(s.ladder.theta * DEG)).toBeLessThan(0.5);
    expect(s.players[0].y).toBeCloseTo(yHand(T.hUpright, T), 3);
    expect(s.players[0].y).toBeCloseTo(1.8, 3);
  });

  it('tilts about 12° when one player is bent and the other upright (the intended asymmetric stance)', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 2);
    const deg = s.ladder.theta * DEG;
    expect(deg).toBeGreaterThan(11);
    expect(deg).toBeLessThan(13.5);
    expect(s.players[0].y).toBeCloseTo(0.9, 2);
    expect(s.players[1].y).toBeCloseTo(1.8, 2);
  });

  it('tilts the other way when Dee bends and Dum stays upright', () => {
    const s = freshState();
    runFor(s, upright(), bent(), 2);
    expect(s.ladder.theta * DEG).toBeLessThan(-11);
  });

  it('ladder height is linear between the hands and extends beyond them', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 2);
    const [a, b] = s.players;
    const mid = ladderHeightAt(s, (a.x + b.x) / 2);
    expect(mid).toBeCloseTo((a.y + b.y) / 2, 6);
    // Beyond Dee's hand the line keeps rising.
    expect(ladderHeightAt(s, b.x + T.ladderOverhang)).toBeGreaterThan(b.y);
  });

  it('a stationary ladder has zero angular velocity', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 3);
    expect(Math.abs(s.ladder.thetaDot)).toBeLessThan(1e-6);
  });
});

describe('arm reach', () => {
  it('a bent/upright pair stays within reach (no pull-down)', () => {
    const s = freshState();
    runFor(s, bent(), upright(), 2);
    expect(s.ladder.over).toBe(0);
    expect(s.players[1].y).toBeCloseTo(s.players[1].yHandRaw, 6);
  });

  it('digital postures (0.2 / 0.8) never exceed the reach limit without a step-up', () => {
    const dy = yHand(T.hUpright, T) - yHand(T.hBent, T);
    expect(dy).toBeCloseTo(0.9, 6);
    expect(dy).toBeLessThan(T.dyMax);
  });

  it('deep squat against full stretch exceeds the limit: the high hand is pulled down', () => {
    const s = freshState();
    runFor(s, posture(0), posture(1), 2);
    const [a, b] = s.players;
    expect(b.yHandRaw - a.yHandRaw).toBeCloseTo(1.5, 2);
    expect(s.ladder.over).toBeCloseTo(0.2, 2);
    expect(b.y - a.y).toBeCloseTo(T.dyMax, 2);
    expect(b.y).toBeLessThan(b.yHandRaw);
    expect(s.ladder.highSide).toBe(1);
    // The excess shows up on the balance meter, toward the high side.
    expect(s.balance).toBeGreaterThan(0.1);
    expect(s.lives).toBe(T.startLives);
  });

  it('pulls Dum down when Dum is the high one', () => {
    const s = freshState();
    runFor(s, posture(1), posture(0), 2);
    const [a, b] = s.players;
    expect(a.y - b.y).toBeCloseTo(T.dyMax, 2);
    expect(s.balance).toBeLessThan(-0.1);
  });

  it('keeps the effective height difference within dyMax at all times (invariant)', () => {
    const s = freshState();
    for (let i = 0; i < 600; i++) {
      const a = posture(0.5 + 0.5 * Math.sin(i / 7), 0.6);
      const b = posture(0.5 + 0.5 * Math.cos(i / 11), 0.6);
      runFor(s, a, b, T.dt);
      expect(Math.abs(s.players[1].y - s.players[0].y)).toBeLessThanOrEqual(T.dyMax + 1e-6);
    }
  });
});

describe('coupling and balance', () => {
  it('equal push keeps the ladder relaxed and the balance centred', () => {
    const s = freshState();
    runFor(s, upright(0.6), upright(0.6), 4);
    expect(Math.abs(s.ladder.tension)).toBeLessThan(0.02);
    expect(Math.abs(s.balance)).toBeLessThan(0.05);
    expect(s.players[0].v).toBeCloseTo(0.6 * T.vMax, 1);
  });

  it('a faster Dum pulls the balance toward Dum and is slowed down by the ladder', () => {
    const s = freshState();
    runFor(s, upright(1.0), upright(0.6), 4);
    expect(s.balance).toBeLessThan(-0.3);
    expect(s.ladder.tension).toBeLessThan(0);
    expect(s.players[0].v).toBeLessThan(T.vMax);
    expect(s.players[0].v).toBeCloseTo(s.players[1].v, 1);
  });

  it('one running while the other brakes: the ladder slips out of the hands after a while', () => {
    const s = freshState();
    runFor(s, upright(1.0), upright(-0.3), 6);
    expect(s.lives).toBeLessThan(T.startLives);
    expect(s.gameOver || s.lives >= 0).toBe(true);
  });
});
