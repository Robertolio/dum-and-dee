import { describe, expect, it } from 'vitest';
import { CAMPAIGN, createState, extendLevel, levelById, LEVELS, MIXED_ZONE, nextLevel, themeAtX } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

describe('TV studio', () => {
  it('the studio generator makes its own props, booms and interactive set pieces', () => {
    const s = createState({ id: 'st', length: 1e9, lamps: [], steps: [], theme: 'studio', generator: { seed: 777001, startX: 16 } }, T);
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

  it('TV props: signs and the break-away wall pay out, the carpet gives glam points, a cable trips', () => {
    const s = freshState({
      id: 'tv',
      theme: 'studio',
      lamps: [],
      steps: [{ x: 8, width: 3.2, kind: 'carpet' }],
      softs: [
        { kind: 'onair', x: 14, y: 1.7, r: 0.5 },
        { kind: 'applause', x: 18, y: 1.7, r: 0.5 },
        { kind: 'buzzer', x: 22, y: 1.7, r: 0.5 },
        { kind: 'wall', x: 26, y: 1.5, r: 0.85 },
      ],
      length: 120,
    });
    const st = runFor(s, upright(0.7), upright(0.7), 16);
    const types = st.events.map((e) => e.type);
    for (const k of ['glam', 'onAir', 'applause', 'buzz', 'crash']) expect(types).toContain(k);
    expect(s.score).toBeGreaterThanOrEqual(T.scoreCarpet + T.scoreOnAir + T.scoreApplause + T.scoreBuzzer + T.scoreWall);
    const c = freshState({ id: 'cb', theme: 'studio', lamps: [], steps: [{ x: 10, width: 1.4, kind: 'cable' }], length: 60 });
    const cs = runFor(c, upright(0.7), upright(0.7), 10);
    expect(cs.events.map((e) => e.type)).toContain('slip');
  });

  it('the studio generator produces the new props, signs and commercial breaks', () => {
    const s = createState({ id: 'st', length: 1e9, lamps: [], steps: [], theme: 'studio', generator: { seed: 4242, startX: 16 } }, T);
    const kinds = new Set<string>();
    const softs = new Set<string>();
    const marks = new Set<string>();
    for (let x = 0; x < 3000; x += 3) {
      extendLevel(s, x, T);
      for (const o of s.steps) kinds.add(o.kind);
      for (const o of s.softs) softs.add(o.kind);
      for (const m of s.gen!.marks) marks.add(m.text);
    }
    for (const k of ['clapper', 'director', 'cart', 'cable', 'carpet', 'dummy', 'soundboard']) expect(kinds.has(k)).toBe(true);
    for (const k of ['onair', 'applause', 'buzzer', 'wall']) expect(softs.has(k)).toBe(true);
    expect(marks.has('COMMERCIAL BREAK!')).toBe(true);
  });

  it('studio levels are registered with both themes in the list', () => {
    expect(LEVELS.filter((l) => l.theme === 'studio' && !l.endless).length).toBe(5);
    expect(LEVELS.filter((l) => l.endless).length).toBe(1);
  });

  it('the campaign runs from the factory straight into the studio', () => {
    expect(CAMPAIGN[0]!.id).toBe('f0');
    expect(nextLevel('f5')!.id).toBe('s1');
    expect(nextLevel(CAMPAIGN[CAMPAIGN.length - 1]!.id)).toBeUndefined();
  });

  it('endless mixes zones and leaves gate marks', () => {
    expect(themeAtX(true, 'factory', 10)).toBe('factory');
    expect(themeAtX(true, 'factory', MIXED_ZONE + 10)).toBe('studio');
    expect(themeAtX(false, 'factory', MIXED_ZONE + 10)).toBe('factory');
    const s = createState(levelById('endless').data, T);
    const texts: string[] = [];
    for (let x = 0; x < MIXED_ZONE * 3; x += 3) {
      extendLevel(s, x, T);
      for (const m of s.gen!.marks) if (!texts.includes(m.text)) texts.push(m.text);
    }
    expect(texts).toContain('Now entering: TV Studio');
    expect(texts).toContain('Back to the Factory');
  });
});
