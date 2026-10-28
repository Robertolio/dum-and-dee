import { describe, expect, it } from 'vitest';
import { type LevelData, type PlayerInput } from '../src/index';
import { freshState, runFor, runWith, T, upright } from './helpers';

const lvl = (kind: 'crate' | 'pallet' | 'banana' | 'duck', x = 12, extra: Partial<LevelData> = {}): LevelData => ({
  id: 'b',
  lamps: [],
  steps: [{ x, width: kind === 'pallet' ? 1.2 : 1, kind }],
  length: 50,
  ...extra,
});

const walk = (jump: (s: ReturnType<typeof freshState>) => boolean) => (s: ReturnType<typeof freshState>): [PlayerInput, PlayerInput] => [
  { push: 0.6, hTarget: T.hUpright, jump: jump(s) },
  { push: 0.6, hTarget: T.hUpright, jump: jump(s) },
];

describe('blocking obstacles', () => {
  it('a crate blocks the pair: Dee stops at its edge and the team makes no more progress', () => {
    const s = freshState(lvl('crate'));
    runFor(s, upright(0.6), upright(0.6), 6);
    const dee = s.players[1];
    expect(dee.x + T.footHalf).toBeLessThanOrEqual(12.5); // crate x0 = 12, pushed at most a little
    expect(s.players[0].x).toBeLessThan(12 - T.L0 + 1);
    expect(dee.yFloor).toBeLessThan(0.05); // never stepped on
  });

  it('small risers (stair treads) are still walked automatically', () => {
    const level: LevelData = {
      id: 's',
      lamps: [],
      steps: [
        { x: 10, width: 0.7, kind: 'stair', height: 0.2 },
        { x: 10.7, width: 0.7, kind: 'stair', height: 0.4 },
        { x: 11.4, width: 3, kind: 'stair', height: 0.4 },
      ],
      length: 50,
    };
    const s = freshState(level);
    runFor(s, upright(0.6), upright(0.6), 7);
    expect(s.players[1].x).toBeGreaterThan(14);
  });

  it('jumping clears a crate and lands on top; the pair continues', () => {
    const s = freshState(lvl('crate'));
    const jumped = [false, false];
    runWith(
      s,
      (st) =>
        walk((x) => {
          void x;
          // jump when the player's front foot is ~0.5 we before the crate
          const dee = st.players[1];
          const a = st.players[0];
          jumped[1] = jumped[1] || dee.jumpT > 0;
          return dee.x > 11.1 && dee.x < 11.3 ? true : a.x > 11.1 && a.x < 11.3 + 0;
        })(st),
      7,
    );
    expect(s.players[1].x).toBeGreaterThan(13.5);
    expect(jumped[1]).toBe(true);
  });

  it('a heavy pallet slides less than a light duck when walked into', () => {
    const slide = (kind: 'pallet' | 'duck'): number => {
      const s = freshState(lvl(kind, 12));
      const x0 = s.steps[0]!.x0;
      runFor(s, upright(0.6), upright(0.6), 5);
      return s.steps[0]!.x0 - x0;
    };
    const pallet = slide('pallet');
    const duck = slide('duck');
    expect(pallet).toBeGreaterThan(0);
    expect(duck).toBeGreaterThan(pallet * 2);
    expect(pallet).toBeLessThan(0.3);
  });
});

describe('banana', () => {
  it('walking into a banana slips the player: slip event, water splash, slowed', () => {
    const s = freshState(lvl('banana'));
    const stats = runFor(s, upright(0.6), upright(0.6), 4);
    expect(stats.events.some((e) => e.type === 'slip' && e.player === 1)).toBe(true);
    expect(s.bucket.water).toBeLessThan(100 - T.slipSplash + 1);
    expect(s.lives).toBe(T.startLives);
  });

  it('jumping over the banana avoids the slip', () => {
    const s = freshState(lvl('banana'));
    const stats = runWith(
      s,
      (st) => {
        const j = st.players[1].x > 11.45 && st.players[1].x < 11.6;
        const ja = st.players[0].x > 11.45 && st.players[0].x < 11.6;
        return [
          { push: 0.6, hTarget: T.hUpright, jump: ja },
          { push: 0.6, hTarget: T.hUpright, jump: j },
        ];
      },
      3.5,
    );
    expect(stats.events.some((e) => e.type === 'slip' && e.player === 1)).toBe(false);
  });
});

describe('ceiling beam', () => {
  const BEAM: LevelData = { id: 'beam', lamps: [], steps: [], beams: [{ x0: 12, x1: 16, yBottom: 1.5 }], length: 50 };
  it('hitting the beam with an upright ladder stops and costs water; bent passes', () => {
    const s = freshState(BEAM);
    const stats = runFor(s, upright(0.6), upright(0.6), 6);
    expect(stats.events.some((e) => e.type === 'beamHit')).toBe(true);
    expect(s.players[1].x).toBeLessThan(13.5);

    const b = freshState(BEAM);
    const bs = runFor(b, { push: 0.6, hTarget: 0.2 }, { push: 0.6, hTarget: 0.2 }, 8);
    expect(bs.events.some((e) => e.type === 'beamHit')).toBe(false);
    expect(b.players[0].x).toBeGreaterThan(17);
  });
});
