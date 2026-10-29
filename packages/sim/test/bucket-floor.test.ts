import { describe, expect, it } from 'vitest';
import { type LevelData } from '../src/index';
import { freshState, runWith, T } from './helpers';

describe('bucket never goes through floor or obstacles', () => {
  const lvl: LevelData = {
    id: 'bf',
    lamps: [],
    steps: [
      { x: 9, width: 0.7, kind: 'stair', height: 0.2 },
      { x: 9.7, width: 0.7, kind: 'stair', height: 0.4 },
      { x: 10.4, width: 0.7, kind: 'stair', height: 0.6 },
      { x: 11.1, width: 4, kind: 'stair', height: 0.6 },
    ],
    length: 50,
  };
  it('deep squat while walking over stairs: the bucket bottom stays above the ground under it', () => {
    const s = freshState(lvl);
    let worst = 1;
    runWith(
      s,
      (st) => {
        const B = st.bucket;
        const bx = B.xP + T.bucketL * Math.sin(B.phi);
        let g = 0;
        for (const o of st.steps) if (o.kind === 'stair' && o.x1 > bx - T.bucketHalfW && o.x0 < bx + T.bucketHalfW) g = Math.max(g, o.hObj);
        const bottom = B.yP - T.bucketL * Math.cos(B.phi) - T.bucketBody;
        if (st.tick > 5) worst = Math.min(worst, bottom - g);
        return [
          { push: 0.6, hTarget: 0 },
          { push: 0.6, hTarget: 0 },
        ];
      },
      9,
    );
    expect(worst).toBeGreaterThan(-0.12);
  });
  it('deep squat lifts the ladder instead of sinking the bucket', () => {
    const s = freshState();
    runWith(s, () => [{ push: 0, hTarget: 0 }, { push: 0, hTarget: 0 }], 2);
    expect(s.ladder.lift).toBeGreaterThan(0.3);
    expect(s.bucket.yP - T.bucketL - T.bucketBody).toBeGreaterThan(-0.03);
  });

  it('props are not lifted over: a squatting bucket bonks a crate, a raised one passes', () => {
    const mk = (hTarget: number) => {
      const s = freshState({ id: 'bk', lamps: [], steps: [{ x: 40, width: 1, kind: 'crate' }], length: 60 });
      runWith(s, () => [{ push: 0, hTarget }, { push: 0, hTarget }], 1.5);
      const bx = s.bucket.xP;
      s.steps[0]!.x0 = bx - 0.5;
      s.steps[0]!.x1 = bx + 0.5;
      const st = runWith(s, () => [{ push: 0, hTarget }, { push: 0, hTarget }], 0.3);
      return st.events.filter((e) => e.type === 'bucketBonk').length;
    };
    expect(mk(0)).toBeGreaterThan(0);
    expect(mk(1)).toBe(0);
  });
});
