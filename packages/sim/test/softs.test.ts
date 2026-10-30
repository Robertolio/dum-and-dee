import { describe, expect, it } from 'vitest';
import { createState, ENDLESS_LEVEL, type LevelData } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

const lvl: LevelData = {
  id: 'soft',
  lamps: [],
  steps: [],
  softs: [
    { kind: 'balloon', x: 14, y: 1.9 },
    { kind: 'web', x: 18, y: 1.85 },
  ],
  length: 50,
};

describe('balloons and cobwebs', () => {
  it('the ladder pops balloons and sweeps webs for points without costing water or a life', () => {
    const s = freshState(lvl);
    const stats = runFor(s, upright(0.6), upright(0.6), 9);
    expect(stats.events.filter((e) => e.type === 'pop')).toHaveLength(1);
    expect(stats.events.filter((e) => e.type === 'sweep')).toHaveLength(1);
    expect(s.score).toBeGreaterThanOrEqual(T.scoreBalloon + T.scoreWeb);
    expect(s.bucket.water).toBeGreaterThan(98);
    expect(s.lives).toBe(T.startLives);
  });

  it('a bent ladder passes under a high balloon without popping it', () => {
    const s = freshState({ ...lvl, softs: [{ kind: 'balloon', x: 14, y: 2.6 }] });
    const stats = runFor(s, { push: 0.6, hTarget: 0.2 }, { push: 0.6, hTarget: 0.2 }, 6);
    expect(stats.events.some((e) => e.type === 'pop')).toBe(false);
  });

  it('the endless generator makes both, in moderation', () => {
    const s = createState(ENDLESS_LEVEL, T);
    const seen = { balloon: new Set<number>(), web: new Set<number>() } as Record<string, Set<number>> & { balloon: Set<number>; web: Set<number> };
    let patterns = 0;
    for (let x = 0; x <= 1500; x += 20) {
      s.players[0].x = x;
      s.players[1].x = x + T.L0;
      runFor(s, upright(0), upright(0), 1 / 60);
      for (const o of s.softs) seen[o.kind]?.add(o.id);
      patterns = s.gen!.patterns;
    }
    expect(seen.balloon.size).toBeGreaterThan(3);
    expect(seen.web.size).toBeGreaterThan(2);
    expect((seen.balloon.size + seen.web.size) / patterns).toBeLessThan(0.6);
  });
});
