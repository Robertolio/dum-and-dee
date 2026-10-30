import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FRIEND_ALPHABET, isProfane, makeFriendCode, normalizeFriendCode, RateLimiter, validateName } from '../src';

const rb = (seed = 7) => {
  let s = seed;
  return (n: number) => Uint8Array.from({ length: n }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 8) & 255);
};

describe('friend codes', () => {
  it('uses 3 letters of the name plus 3 random chars from a clear alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeFriendCode('Robbie', rb(i));
      expect(c).toMatch(/^ROB-[A-Z0-9]{3}$/);
      for (const ch of c.slice(4)) expect(FRIEND_ALPHABET).toContain(ch);
    }
  });
  it('pads short or letterless names and skips confusing letters', () => {
    expect(makeFriendCode('Al', rb())).toMatch(/^AL[A-Z]-/);
    expect(makeFriendCode('123', rb())).toMatch(/^[A-Z]{3}-/);
    expect(makeFriendCode('Oli', rb()).startsWith('OLI-')).toBe(true);
    expect(FRIEND_ALPHABET).not.toMatch(/[01OIL]/);
  });
  it('normalizes typed codes', () => {
    expect(normalizeFriendCode(' rob 7k2 ')).toBe('ROB-7K2');
    expect(normalizeFriendCode('rob7k2')).toBe('ROB-7K2');
    expect(normalizeFriendCode('ROB-7K0')).toBeNull();
    expect(normalizeFriendCode('RO-7K2')).toBeNull();
    expect(normalizeFriendCode(42)).toBeNull();
  });
  it('is random enough: few collisions', () => {
    const r = (n: number) => randomBytes(n);
    const set = new Set(Array.from({ length: 500 }, () => makeFriendCode('Rob', r)));
    expect(set.size).toBeGreaterThan(450);
  });
});

describe('name filter', () => {
  it('accepts normal names', () => {
    for (const n of ['Rob', 'Dum', 'Dee', 'Anna-Lisa', "O'Neil", 'Scunthorpe', 'Classic', 'Assist', 'Jos', 'Mia 2']) expect(validateName(n).ok, n).toBe(true);
  });
  it('rejects bad lengths and characters', () => {
    expect(validateName('a')).toEqual({ ok: false, reason: 'length' });
    expect(validateName('a'.repeat(17))).toEqual({ ok: false, reason: 'length' });
    expect(validateName('<b>hi</b>')).toEqual({ ok: false, reason: 'chars' });
    expect(validateName(5)).toEqual({ ok: false, reason: 'length' });
  });
  it('rejects profanity incl. leetspeak, spacing tricks and Dutch', () => {
    for (const n of ['fuck', 'F u c k', 'f.u.c.k', 'sh1t', 'kanker', 'Fuuuck', 'hoer', 'n1gger']) expect(isProfane(n) || !validateName(n).ok, n).toBe(true);
  });
  it('collapses whitespace', () => {
    expect(validateName('  Rob   B ')).toEqual({ ok: true, name: 'Rob B' });
  });
});

describe('rate limiter', () => {
  it('allows max hits per window and recovers', () => {
    let t = 0;
    const l = new RateLimiter(3, 1000, () => t);
    expect([l.hit('a'), l.hit('a'), l.hit('a'), l.hit('a')]).toEqual([true, true, true, false]);
    expect(l.hit('b')).toBe(true);
    t = 1001;
    expect(l.hit('a')).toBe(true);
  });
});
