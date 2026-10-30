import { describe, expect, it } from 'vitest';
import { createState, extendLevel, levelById, LEVELS } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

describe('TV studio', () => {
  it('the studio generator makes its own props, booms and interactive set pieces', () => {
    const s = createState(levelById('endless-studio').data, T);
    const kinds = new Set<string>();
    const softs = new Set<string>();
    const lamps = new Set<string>();
    let x = 0;
    for (; x < 1500; x += 3) {
      extendLevel(s, x, T);
      for (const o of s.steps) kinds.add(o.kind);
      for (const o of s.softs) softs.add(o.kind);
      for (const l of s.lamps) lamps.add(l.kind);
    }
    for (const k of ['speaker', 'studioprop', 'clothes', 'film']) expect(kinds.has(k)).toBe(true);
    for (const k of ['wheel', 'fan', 'weather']) expect(softs.has(k)).toBe(true);
    expect(lamps.has('boom')).toBe(true);
    expect(lamps.has('meat')).toBe(false);
    expect(kinds.has('crate')).toBe(false);
  });

  it('the ladder spins the wheel, gusts the fan and flips the weather map for points', () => {
    const s = freshState({
      id: 'sw',
      theme: 'studio',
      lamps: [],
      steps: [],
      softs: [
        { kind: 'wheel', x: 12, y: 1.65, r: 0.72 },
        { kind: 'fan', x: 17, y: 1.55, r: 0.5 },
        { kind: 'weather', x: 22, y: 1.85, r: 0.6 },
      ],
      length: 90,
    });
    const st = runFor(s, upright(0.7), upright(0.7), 14);
    const types = st.events.map((e) => e.type);
    expect(types).toContain('spin');
    expect(types).toContain('gust');
    expect(types).toContain('flip');
    expect(s.score).toBeGreaterThanOrEqual(T.scoreWheel + T.scoreFan + T.scoreWeather);
    expect(s.bucket.water).toBeGreaterThan(97);
  });

  it('studio levels are registered with both themes in the list', () => {
    expect(LEVELS.filter((l) => l.theme === 'studio' && !l.endless).length).toBe(3);
    expect(LEVELS.some((l) => l.id === 'endless-studio')).toBe(true);
  });
});
