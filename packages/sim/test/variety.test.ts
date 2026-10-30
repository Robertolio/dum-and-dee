import { describe, expect, it } from 'vitest';
import { createState, ENDLESS_LEVEL, extendLevel } from '../src/index';
import { T } from './helpers';

function sequence(): number[] {
  const s = createState(ENDLESS_LEVEL, T);
  const seq: number[] = [];
  let seen = s.gen!.patterns;
  for (let x = 0; x < 3000; x += 2) {
    extendLevel(s, x, T);
    const g = s.gen!;
    if (g.patterns !== seen) {
      seen = g.patterns;
      seq.push(g.last);
    }
  }
  return seq;
}

describe('generator variety', () => {
  it('never repeats a pattern back to back, uses many kinds, and is seed-deterministic', () => {
    const a = sequence();
    expect(a.length).toBeGreaterThan(60);
    for (let i = 1; i < a.length; i++) if (a[i] !== -1 && a[i - 1] !== -1) expect(a[i]).not.toBe(a[i - 1]);
    expect(new Set(a).size).toBeGreaterThanOrEqual(11);
    expect(sequence()).toEqual(a);
  });
});
