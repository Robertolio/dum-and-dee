import { describe, expect, it } from 'vitest';
import { createState, ENDLESS_LEVEL, KNIFE_TO_MEAT, type LevelData, type PlayerInput } from '../src/index';
import { freshState, runFor, runWith, T, upright } from './helpers';

describe('cleavers before hanging meat', () => {
  const lvl: LevelData = {
    id: 'kn',
    lamps: [{ x: 18, kind: 'meat' }],
    steps: [
      { x: 11.1, width: 0.9, kind: 'knife', height: 0.26 },
      { x: 13.7, width: 0.9, kind: 'knife', height: 0.26 },
    ],
    length: 60,
  };
  it('a jumping pair clears two cleavers and has its front hand back on the ground before the ladder reaches the meat', () => {
    const s = freshState(lvl);
    const knives = s.steps;
    const act = (i: 0 | 1): PlayerInput => {
      const p = s.players[i];
      const ahead = knives.some((k) => p.x > k.x0 - 0.95 && p.x < k.x0 - 0.7);
      return { push: 0.6, hTarget: T.hUpright, jump: ahead };
    };
    let airborneAtMeat = false;
    const stats = runWith(
      s,
      () => {
        const tip = Math.max(s.players[0].x, s.players[1].x) + T.ladderOverhang;
        if (tip > 18 - 1.2 && tip < 18) airborneAtMeat = airborneAtMeat || s.players[1].jumpT > 0;
        return [act(0), act(1)];
      },
      14,
    );
    expect(s.players[1].x).toBeGreaterThan(21);
    expect(s.lives).toBe(T.startLives);
    expect(airborneAtMeat).toBe(false);
    expect(stats.events.filter((e) => e.type === 'bucketBonk')).toHaveLength(0);
  });

  it('the generator puts knives clearly before the meat and never under a swinging piece', () => {
    const all = createState(ENDLESS_LEVEL, T);
    const knives: number[] = [];
    const meats: number[] = [];
    for (let x = 0; x <= 600; x += 8) {
      all.players[0].x = x;
      all.players[1].x = x + T.L0;
      all.bucket.water = 100;
      all.lives = 3;
      runFor(all, upright(0), upright(0), 1 / 60);
      for (const o of all.steps) if (o.kind === 'knife' && !knives.includes(o.x0)) knives.push(o.x0);
      for (const l of all.lamps) if (l.kind === 'meat' && !meats.includes(l.x)) meats.push(l.x);
    }
    expect(knives.length).toBeGreaterThan(3);
    for (const k of knives) {
      for (const m of meats) {
        const dist = m - (k + 0.9);
        expect(dist > -1.5 && dist < KNIFE_TO_MEAT - 0.01).toBe(false);
      }
    }
  });
});
