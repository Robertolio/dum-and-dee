import { describe, expect, it } from 'vitest';
import { CAMPAIGN, createState, extendLevel, levelById, nextLevel, step } from '../src/index';
import { freshState, runFor, T, upright } from './helpers';

describe('boathouse', () => {
  it('is the last campaign level, reachable by id, with its own props and oars', () => {
    const d = levelById('b1');
    expect(d.theme).toBe('boathouse');
    expect(CAMPAIGN[CAMPAIGN.length - 1]!.id).toBe('b1');
    expect(nextLevel('s5')!.id).toBe('b1');
    const kinds = new Set<string>();
    const lamps = new Set<string>();
    const softs = new Set<string>();
    const s = createState({ id: 'bt', length: 1e9, lamps: [], steps: [], theme: 'boathouse', generator: { seed: 9001, startX: 16 } }, T);
    for (let x = 0; x < 1500; x += 3) {
      extendLevel(s, x, T);
      for (const o of s.steps) kinds.add(o.kind);
      for (const l of s.lamps) lamps.add(l.kind);
      for (const o of s.softs) softs.add(o.kind);
    }
    for (const k of ['ergo', 'roller', 'trailer', 'rollseat', 'puddle', 'rope', 'hose']) expect(kinds.has(k)).toBe(true);
    expect(lamps.has('oar')).toBe(true);
    expect(lamps.has('meat')).toBe(false);
    expect(softs.has('vest') || softs.has('pennant')).toBe(true);
    for (const k of ['crate', 'banana', 'knife', 'cheese']) expect(kinds.has(k)).toBe(false);
  });

  it('swinging does not damage the hull, knocks do', () => {
    const s = freshState({ id: 'bh', theme: 'boathouse', lamps: [], steps: [], length: 200 });
    s.bucket.phi = 1.2;
    s.bucket.phiDot = 3;
    runFor(s, upright(0.5), upright(0.5), 2);
    expect(s.bucket.water).toBe(100);
    expect(s.bucket.lossRate).toBe(0);

    const h = freshState({ id: 'bh2', theme: 'boathouse', lamps: [], steps: [{ x: 8, width: 1.4, kind: 'puddle' }], length: 200 });
    runFor(h, upright(0.9), upright(0.9), 8);
    expect(h.bucket.water).toBeLessThan(100);
  });

  it('puddles, ropes and hoses trip instead of blocking', () => {
    for (const kind of ['puddle', 'rope', 'hose'] as const) {
      const s = freshState({ id: kind, theme: 'boathouse', lamps: [], steps: [{ x: 8, width: 1.4, kind }], length: 200 });
      const ev = runFor(s, upright(0.9), upright(0.9), 10).events;
      expect(ev.some((e) => e.type === 'slip')).toBe(true);
    }
  });

  it('is deterministic', () => {
    const a = createState(levelById('b1').data, T);
    const b = createState(levelById('b1').data, T);
    for (let i = 0; i < 300; i++) {
      step(a, [upright(0.6), upright(0.6)], T);
      step(b, [upright(0.6), upright(0.6)], T);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
