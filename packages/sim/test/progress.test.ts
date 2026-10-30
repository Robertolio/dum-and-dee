import { describe, expect, it } from 'vitest';
import { multFor, type LevelData } from '../src/index';
import { freshState, runFor, runWith, T, upright } from './helpers';

const lvl = (steps: LevelData['steps'], length = 80): LevelData => ({ id: 'p', lamps: [], steps, length, par: 40 });

describe('combo, lives, checkpoints, level end', () => {
  it('multiplier thresholds 3/6/10', () => {
    expect([multFor(2), multFor(3), multFor(6), multFor(10)]).toEqual([1, 1.5, 2, 3]);
  });

  it('jumping over props in a row builds a combo and passes score', () => {
    const s = freshState(lvl([{ x: 10, width: 0.9, kind: 'crate' }, { x: 15, width: 0.9, kind: 'crate' }, { x: 20, width: 0.9, kind: 'crate' }]));
    const stats = runWith(
      s,
      () => {
        const j = (i: 0 | 1): boolean => s.steps.some((k) => s.players[i].x > k.x0 - 0.95 && s.players[i].x < k.x0 - 0.7);
        return [
          { push: 0.6, hTarget: T.hUpright, jump: j(0) },
          { push: 0.6, hTarget: T.hUpright, jump: j(1) },
        ];
      },
      16,
    );
    expect(s.bestCombo).toBeGreaterThanOrEqual(3);
    expect(stats.events.some((e) => e.type === 'comboUp')).toBe(true);
  });

  it('a bump resets the combo', () => {
    const s = freshState(lvl([{ x: 10, width: 0.9, kind: 'crate' }]));
    s.combo = 7;
    s.comboMult = 2;
    runFor(s, upright(0.8), upright(0.8), 8);
    expect(s.combo).toBe(0);
    expect(s.comboMult).toBe(1);
  });

  it('losing a life respawns at the last checkpoint with a full bucket', () => {
    const s = freshState(lvl([], 400));
    runFor(s, upright(0.8), upright(0.8), 40);
    expect(s.checkpointX).toBeGreaterThan(40);
    const cp = s.checkpointX;
    s.bucket.water = 0;
    s.bucket.xP += 0;
    const st = runFor(s, upright(0), upright(0), 1);
    expect(s.lives).toBe(T.startLives - 1);
    expect(st.events.some((e) => e.type === 'respawn')).toBe(true);
    expect((s.players[0].x + s.players[1].x) / 2).toBeLessThan(cp + 1);
    expect(s.bucket.water).toBeGreaterThan(90);
  });

  it('extra life every 2000 points, max 5', () => {
    const s = freshState(lvl([], 400));
    s.score = 1990;
    s.combo = 0;
    s.softs.push({ id: 1, kind: 'balloon', x: 4, y: 1.9, r: 0.4, color: 0, done: false });
    runFor(s, upright(0.8), upright(0.8), 6);
    expect(s.score).toBeGreaterThanOrEqual(2000);
    expect(s.lives).toBe(T.startLives + 1);
  });

  it('reaching the end of a scripted level finishes it with bonuses and stars', () => {
    const s = freshState(lvl([], 20));
    runFor(s, upright(0.9), upright(0.9), 12);
    expect(s.finished).toBe(true);
    expect(s.result!.stars).toBe(3);
    expect(s.result!.lifeBonus).toBe(T.scoreLifeBonus * T.startLives);
    expect(s.result!.score).toBeGreaterThan(1500);
  });
});
