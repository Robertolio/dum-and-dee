import { describe, expect, it } from 'vitest';
import type { LevelData } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

const lvl: LevelData = {
  id: 'lb',
  lamps: [
    { x: 14 },
    { x: 24 },
  ],
  steps: [],
  length: 50,
};

describe('lamp breaking', () => {
  it('a gentle pass does not break the lamp', () => {
    const s = freshState(lvl);
    runFor(s, upright(0.4), upright(0.4), 8);
    expect(s.lamps[0]!.broken).toBe(false);
    expect(s.dark).toBe(false);
  });

  it('a hard hit breaks the lamp, darkens, and the next lamp restores light without costing a life', () => {
    const s = freshState(lvl);
    const lamp = s.lamps[0]!;
    lamp.psi = -1;
    lamp.psiDot = -6;
    const st = runFor(s, upright(1), upright(1), 5);
    expect(st.events.some((e) => e.type === 'lampBreak')).toBe(true);
    expect(lamp.broken).toBe(true);
    expect(s.lives).toBe(T.startLives);
    runFor(s, upright(1), upright(1), 14);
    expect(s.dark).toBe(false);
    expect(st.events.some((e) => e.type === 'lightsOn')).toBe(true);
  });
});
