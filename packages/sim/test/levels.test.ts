import { describe, expect, it } from 'vitest';
import { createState, LEVELS, levelById } from '../src/index';
import { T } from './helpers';

describe('level loader', () => {
  const scripted = LEVELS.filter((l) => !l.endless);
  it('has a tutorial, at least five factory levels and an endless mode', () => {
    expect(scripted.length).toBeGreaterThanOrEqual(6);
    expect(LEVELS.some((l) => l.endless)).toBe(true);
    expect(levelById('nope').endless).toBe(true);
  });
  it('every scripted level loads, is deterministic and takes roughly 60-120 s at walking pace', () => {
    for (const l of scripted) {
      const s = createState(l.data, T);
      const again = createState(levelById(l.id).data, T);
      expect(s.steps.length + s.lamps.length + s.softs.length).toBeGreaterThan(5);
      expect(again.steps.map((o) => o.x0)).toEqual(s.steps.map((o) => o.x0));
      expect(s.levelLength).toBe(l.data.length);
      const secs = l.data.length / 2.4;
      expect(secs).toBeGreaterThan(45);
      expect(secs).toBeLessThan(135);
    }
  });
  it('difficulty rises: obstacle density grows from level 1 to the last level', () => {
    const dens = scripted.slice(1).map((l) => {
      const s = createState(l.data, T);
      return (s.steps.length + s.lamps.length * 1.5 + s.beams.length) / l.data.length;
    });
    expect(dens[dens.length - 1]!).toBeGreaterThan(dens[0]!);
  });
  it('scripted obstacles never overlap on the floor', () => {
    for (const l of scripted) {
      const s = createState(l.data, T);
      const steps = [...s.steps].sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.x0).toBeGreaterThanOrEqual(steps[i - 1]!.x1 - 1e-6);
    }
  });
});
