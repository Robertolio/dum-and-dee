import { describe, expect, it } from 'vitest';
import { type LevelData, type PlayerInput } from '../src/index';
import { freshState, runWith, T } from './helpers';

describe('cleavers under hanging meat', () => {
  const lvl: LevelData = {
    id: 'kn',
    lamps: [{ x: 18, kind: 'meat' }],
    steps: [
      { x: 14.6, width: 0.9, kind: 'knife', height: 0.26 },
      { x: 17.0, width: 0.9, kind: 'knife', height: 0.26 },
    ],
    length: 60,
  };
  it('a jumping pair clears two cleavers in a row, lands before the meat and loses no life', () => {
    const s = freshState(lvl);
    const knives = s.steps;
    const act = (i: 0 | 1): PlayerInput => {
      const p = s.players[i];
      const ahead = knives.some((k) => p.x > k.x0 - 0.95 && p.x < k.x0 - 0.7);
      return { push: 0.6, hTarget: T.hUpright, jump: ahead };
    };
    const stats = runWith(s, () => [act(0), act(1)], 14);
    expect(s.players[1].x).toBeGreaterThan(21);
    expect(s.lives).toBe(T.startLives);
    expect(stats.events.filter((e) => e.type === 'bucketBonk')).toHaveLength(0);
  });
});
