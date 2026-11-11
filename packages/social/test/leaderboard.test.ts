import { randomBytes } from 'node:crypto';
import { levelById } from '@dd/sim';
import { describe, expect, it } from 'vitest';
import { Leaderboard, plausible, weekStart, createAdminHandler, createLeaderboardHandler } from '../src';
import { mkClock, mkHub, mkSocial, tick } from './helpers';

const setup = async () => {
  const { social, db, clock } = await mkSocial();
  const lb = new Leaderboard(db, social, { now: clock.now, randomBytes: (n) => randomBytes(n), cacheMs: 0 });
  const reg = async (name: string, ip = '1.1.1.1') => {
    const r = await social.register(name, ip);
    if (!r.ok) throw new Error(r.error);
    return r.player.id;
  };
  return { social, db, clock, lb, reg };
};
const run = (level: string, score: number, a: string | null, b: string | null, seconds = 90) => ({ level, score, ticks: seconds * 60, distance: seconds * 3, players: [a, b] as [string | null, string | null] });

describe('week boundary', () => {
  it('starts on Monday 00:00 Europe/Amsterdam, also across daylight saving', () => {
    // Winter: Monday 2026-01-05 00:00 CET = Sunday 23:00 UTC.
    expect(new Date(weekStart(Date.UTC(2026, 0, 7, 12))).toISOString()).toBe('2026-01-04T23:00:00.000Z');
    expect(new Date(weekStart(Date.UTC(2026, 0, 4, 23, 30))).toISOString()).toBe('2026-01-04T23:00:00.000Z');
    expect(new Date(weekStart(Date.UTC(2026, 0, 4, 22, 59))).toISOString()).toBe('2025-12-28T23:00:00.000Z');
    // DST starts Sunday 2026-03-29; Monday 03-30 00:00 CEST = Sunday 22:00 UTC.
    expect(new Date(weekStart(Date.UTC(2026, 2, 31, 9))).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(new Date(weekStart(Date.UTC(2026, 2, 29, 12))).toISOString()).toBe('2026-03-22T23:00:00.000Z');
    // Summer.
    expect(new Date(weekStart(Date.UTC(2026, 6, 15, 12))).toISOString()).toBe('2026-07-12T22:00:00.000Z');
  });
});

describe('plausibility', () => {
  it('rejects absurd and impossible runs', () => {
    expect(plausible(run('f0', 3000, null, null, 80))).toBe(true);
    expect(plausible(run('f0', 9_999_999, null, null, 80))).toBe(false);
    expect(plausible(run('f0', 500_000, null, null, 80))).toBe(false);
    expect(plausible(run('f0', 3000, null, null, 3))).toBe(false);
    expect(plausible({ level: 'endless', score: 800, ticks: 60 * 60, distance: 100000 })).toBe(false);
    expect(plausible({ level: 'endless', score: 800, ticks: 60 * 60, distance: 500 })).toBe(true);
    expect(plausible({ level: 'f0', score: -5, ticks: 60 * 60, distance: 0 })).toBe(false);
  });
});

describe('leaderboard', () => {
  it('records duo and player rows per environment, ranks them, and names the duo from the two names', async () => {
    const { lb, reg } = await setup();
    const a = await reg('Rob', '1.1.1.1');
    const b = await reg('Mia', '2.2.2.2');
    const c = await reg('Zed', '3.3.3.3');
    await lb.record(run('f0', 2000, a, b));
    await lb.record(run('f0', 2600, a, c));
    await lb.record(run('s1', 1500, a, b));
    const duo = await lb.view('duo', 'factory', 'all', null);
    expect(duo.entries.map((e) => [e.rank, e.name, e.score])).toEqual([[1, 'Rob & Zed', 2600], [2, 'Mia & Rob', 2000]]);
    const players = await lb.view('player', 'factory', 'all', null);
    expect(players.entries.map((e) => [e.name, e.score])).toEqual([['Rob', 2600], ['Zed', 2600], ['Mia', 2000]]);
    expect(players.entries[1]!.rank).toBe(1);
    const overall = await lb.view('player', 'overall', 'all', null);
    expect(overall.entries[0]).toMatchObject({ name: 'Rob', score: 2600 + 1500 });
    expect((await lb.view('duo', 'studio', 'all', null)).entries).toHaveLength(1);
    expect(JSON.stringify(duo)).not.toContain(a);
  });

  it('this week resets on Monday while all time keeps the score', async () => {
    const { lb, reg, clock } = await setup();
    const a = await reg('Rob', '1.1.1.1');
    const b = await reg('Mia', '2.2.2.2');
    clock.advance(0);
    await lb.record(run('f0', 2000, a, b));
    expect((await lb.view('duo', 'overall', 'week', null)).entries).toHaveLength(1);
    clock.advance(8 * 86_400_000);
    expect((await lb.view('duo', 'overall', 'week', null)).entries).toHaveLength(0);
    expect((await lb.view('duo', 'overall', 'all', null)).entries).toHaveLength(1);
  });

  it('marks you and friends, and shows your position when outside the shown list', async () => {
    const { lb, reg, social } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await reg(`Pl${String.fromCharCode(65 + i)}x`, `9.9.9.${i}`));
    await social.db.run("INSERT INTO friendships (a, b, state, requester, created) VALUES (?, ?, 'accepted', ?, 1)", [ids[0]! < ids[1]! ? ids[0] : ids[1], ids[0]! < ids[1]! ? ids[1] : ids[0], ids[0]]);
    await lb.record(run('f0', 3000, ids[1]!, null));
    await lb.record(run('f0', 2000, ids[2]!, null));
    await lb.record(run('f0', 1000, ids[0]!, null));
    const v = await lb.view('player', 'factory', 'all', ids[0]!, 2);
    expect(v.entries.map((e) => [e.name, e.friend, e.me])).toEqual([['PlBx', true, false], ['PlCx', false, false]]);
    expect(v.me).toMatchObject({ rank: 3, me: true, score: 1000 });
  });

  it('hides blocked players and profane names, and Delete me removes their scores', async () => {
    const { lb, reg, social, db } = await setup();
    const a = await reg('Rob', '1.1.1.1');
    const b = await reg('Mia', '2.2.2.2');
    await lb.record(run('f0', 2000, a, b));
    await social.adminBlock(b, true);
    expect((await lb.view('duo', 'overall', 'all', null)).entries).toHaveLength(0);
    expect((await lb.view('player', 'overall', 'all', null)).entries.map((e) => e.name)).toEqual(['Rob']);
    await social.adminBlock(b, false);
    await db.run('UPDATE players SET name = ? WHERE id = ?', ['fuck', b]);
    expect((await lb.view('player', 'overall', 'all', null)).entries.map((e) => e.name)).toEqual(['Rob']);
    await social.deleteMe(a);
    expect(await db.all('SELECT id FROM scores WHERE p1 = ? OR p2 = ?', [a, a])).toHaveLength(0);
    expect((await lb.view('duo', 'overall', 'all', null)).entries).toHaveLength(0);
  });

  it('refuses implausible runs and anonymous-only runs', async () => {
    const { lb, reg, db } = await setup();
    const a = await reg('Rob');
    expect(await lb.record(run('f0', 9_999_999, a, null))).toBeNull();
    expect(await lb.record(run('f0', 2000, null, null))).toBeNull();
    expect(await lb.record(run('f0', 2000, 'nobody123', null))).toBeNull();
    expect(await db.all('SELECT id FROM scores')).toHaveLength(0);
  });

  it('admin can list, hide and delete scores (behind ADMIN_KEY)', async () => {
    const { lb, reg, social, clock } = await setup();
    const a = await reg('Rob');
    await lb.record(run('f0', 2000, a, null));
    const handler = createAdminHandler(social, 'k', clock.now, {}, lb);
    const call = async (method: string, url: string, key = 'k') => {
      let status = 0;
      let body = '';
      const res: any = { writeHead: (s: number) => (status = s), end: (b: string) => (body = b) };
      const req: any = { method, url, headers: { 'x-admin-key': key }, on: () => undefined };
      await handler(req, res, '1.1.1.1');
      return { status, json: body ? JSON.parse(body) : null };
    };
    expect((await call('GET', '/api/admin/scores', 'wrong')).status).toBe(401);
    const list = await call('GET', '/api/admin/scores');
    expect(list.json.scores).toHaveLength(1);
    const id = list.json.scores[0].id as string;
    expect((await call('POST', `/api/admin/scores/${id}/hide`)).status).toBe(200);
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(0);
    await call('POST', `/api/admin/scores/${id}/unhide`);
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(1);
    expect((await call('DELETE', `/api/admin/scores/${id}`)).status).toBe(200);
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(0);
  });

  it('caches reads for a short time and rate-limits per IP', async () => {
    const { social, db, clock, reg } = await setup();
    const lb = new Leaderboard(db, social, { now: clock.now, randomBytes: (n) => randomBytes(n), cacheMs: 10_000, readsPerMinutePerIp: 3 });
    const a = await reg('Rob');
    await lb.view('player', 'overall', 'all', null);
    await db.run("INSERT INTO scores (id, kind, p1, p2, env, level, score, time_ms, created, week, hidden) VALUES ('x00000000001', 'player', ?, '', 'factory', 'f0', 5, 1, 1, 1, 0)", [a]);
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(0);
    clock.advance(11_000);
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(1);
    expect([1, 2, 3, 4].map(() => lb.allow('5.5.5.5'))).toEqual([true, true, true, false]);
  });
});

describe('hub: server-side registration of online runs', () => {
  it('records an endless run from the authenticated seats and tells each player their rank', async () => {
    const h = await mkHub();
    const A = h.client('1.1.1.1');
    const B = h.client('2.2.2.2');
    await A.say({ t: 'reg', name: 'Rob' });
    await B.say({ t: 'reg', name: 'Mia' });
    const G1 = h.client('1.1.1.1');
    const G2 = h.client('2.2.2.2');
    await G1.say({ t: 'auth', token: A.conn.last('reg_ok')!.token });
    await G2.say({ t: 'auth', token: B.conn.last('reg_ok')!.token });
    await G1.say({ t: 'create', v: 1 });
    await G2.say({ t: 'join', room: G1.conn.last('joined')!.room });
    await G1.say({ t: 'level', id: 'endless' });
    await G1.say({ t: 'ready', ready: true });
    await G2.say({ t: 'ready', ready: true });
    const room = h.mgr.roomByCode(G1.conn.last('joined')!.room) as any;
    for (let i = 0; i < 600 && !(room.game && room.game.state.tick > 600); i++) {
      h.clock.advance(100);
      h.mgr.tick();
    }
    expect(room.game.state.tick).toBeGreaterThan(600);
    room.game.state.score = 700;
    room.game.state.gameOver = true;
    h.clock.advance(100);
    h.mgr.tick();
    await tick();
    expect(G1.conn.last('end')).toBeTruthy();
    const lbMsg = G1.conn.last('lb');
    expect(lbMsg).toMatchObject({ env: 'endless', score: 700 });
    {
      expect(lbMsg!.duo).toMatchObject({ week: 1, all: 1 });
      expect(G2.conn.last('lb')!.player).toMatchObject({ week: 1, all: 1 });
      const v = await h.lb.view('duo', 'endless', 'all', null);
      expect(v.entries[0]!.name).toBe('Mia & Rob');
    }
  });

  it('a client cannot claim an identity: no token, no score', async () => {
    const h = await mkHub();
    const G1 = h.client('1.1.1.1');
    await G1.say({ t: 'auth', token: 'f'.repeat(48) });
    expect(G1.hc.ctx.playerId).toBeNull();
  });
});

describe('solo list', () => {
  const solo = (level: string, score: number, time: number, distance = 0) => ({ level, score, time, distance });

  it('keeps plausible solo runs in their own list; dubious ones are stored flagged and never shown', async () => {
    const { lb, reg, db } = await setup();
    const a = await reg('Rob');
    const ok = await lb.submitSolo(a, solo('f0', 2500, 80));
    expect(ok).toMatchObject({ status: 'ok', env: 'factory', rank: { week: 1, all: 1 } });
    expect(await lb.submitSolo(a, solo('f0', 900_000, 80))).toEqual({ status: 'unexpected' });
    expect(await lb.submitSolo(a, solo('f0', 2500, 2))).toEqual({ status: 'unexpected' });
    expect(await lb.submitSolo(a, solo('endless', 600, 30, 5000))).toEqual({ status: 'unexpected' });
    expect(await lb.submitSolo(a, solo('nope', 1, 80))).toEqual({ status: 'rejected' });
    expect(await lb.submitSolo('ghost12345', solo('f0', 100, 80))).toEqual({ status: 'rejected' });
    const v = await lb.view('solo', 'overall', 'all', a);
    expect(v.entries.map((e) => [e.name, e.score, e.me])).toEqual([['Rob', 2500, true]]);
    const flagged = await db.all<{ hidden: number }>("SELECT hidden FROM scores WHERE kind = 'solo' AND hidden = 2");
    expect(flagged).toHaveLength(3);
    // Strictly separate from the server-authoritative lists.
    expect((await lb.view('player', 'overall', 'all', null)).entries).toHaveLength(0);
    expect((await lb.view('duo', 'overall', 'all', null)).entries).toHaveLength(0);
    await lb.record(run('f0', 9000, a, null));
    expect((await lb.view('solo', 'factory', 'all', null)).entries.map((e) => e.score)).toEqual([2500]);
    expect((await lb.view('player', 'factory', 'all', null)).entries.map((e) => e.score)).toEqual([9000]);
  });

  it('limits are per environment and sensible: realistic runs pass, speed and points beyond the limits do not', () => {
    expect(plausible({ level: 'r1', score: 4000, ticks: 100 * 60, distance: 0 })).toBe(true);
    expect(plausible({ level: 'r1', score: 4000, ticks: 20 * 60, distance: 0 })).toBe(false);
    expect(plausible({ level: 'f0', score: 3000, ticks: 40 * 60, distance: 0 })).toBe(true);
    expect(plausible({ level: 'f0', score: 3000, ticks: Math.floor(levelById('f0').data.length / 9 - 1) * 60, distance: 0 })).toBe(false);
    expect(plausible({ level: 'endless', score: 9000, ticks: 60 * 60, distance: 500 })).toBe(true);
    expect(plausible({ level: 'endless', score: 40_000, ticks: 60 * 60, distance: 600 })).toBe(false);
    expect(plausible({ level: 'f0', score: 3000, ticks: 4 * 3600 * 60, distance: 0 })).toBe(false);
  });

  it('Delete me, profanity, blocking and admin hide/delete apply to solo scores too', async () => {
    const { lb, reg, social, db, clock } = await setup();
    const a = await reg('Rob', '1.1.1.1');
    const b = await reg('Mia', '2.2.2.2');
    await lb.submitSolo(a, solo('s1', 2000, 90));
    await lb.submitSolo(b, solo('s1', 1800, 90));
    await db.run('UPDATE players SET name = ? WHERE id = ?', ['shit', b]);
    expect((await lb.view('solo', 'studio', 'all', null)).entries.map((e) => e.name)).toEqual(['Rob']);
    await db.run('UPDATE players SET name = ? WHERE id = ?', ['Mia', b]);
    await social.adminBlock(b, true);
    expect((await lb.view('solo', 'studio', 'all', null)).entries.map((e) => e.name)).toEqual(['Rob']);
    await social.adminBlock(b, false);
    const handler = createAdminHandler(social, 'k', clock.now, {}, lb);
    const call = async (method: string, url: string) => {
      let body = '';
      const res: any = { writeHead: () => undefined, end: (x: string) => (body = x) };
      await handler({ method, url, headers: { 'x-admin-key': 'k' }, on: () => undefined } as any, res, '1.1.1.1');
      return body ? JSON.parse(body) : null;
    };
    const list = await call('GET', '/api/admin/scores?env=studio');
    const mia = list.scores.find((x: any) => x.names === 'Mia');
    expect(mia.kind).toBe('solo');
    await call('POST', `/api/admin/scores/${mia.id}/hide`);
    expect((await lb.view('solo', 'studio', 'all', null)).entries.map((e) => e.name)).toEqual(['Rob']);
    await call('DELETE', `/api/admin/scores/${mia.id}`);
    await social.deleteMe(a);
    expect(await db.all("SELECT id FROM scores WHERE kind = 'solo'")).toHaveLength(0);
  });

  it('the HTTP endpoint needs a device token, validates input and is rate limited per player', async () => {
    const { lb, social, reg } = await setup();
    const r = await social.register('Rob', '7.7.7.7');
    if (!r.ok) throw new Error('reg');
    const handler = createLeaderboardHandler(lb, social);
    const post = async (body: unknown, token: string | null = r.token) => {
      let status = 0;
      let out = '';
      const res: any = { writeHead: (s: number) => (status = s), end: (x: string) => (out = x) };
      const listeners: Record<string, (a?: Buffer) => void> = {};
      const req: any = { method: 'POST', url: '/api/leaderboard/solo', headers: token ? { 'x-dd-token': token } : {}, on: (e: string, f: (a?: Buffer) => void) => (listeners[e] = f) };
      const done = handler(req, res, '8.8.8.8');
      await new Promise((x) => setTimeout(x, 5));
      listeners.data?.(Buffer.from(JSON.stringify(body)));
      listeners.end?.();
      await done;
      return { status, json: out ? JSON.parse(out) : null };
    };
    expect((await post({ level: 'f0', score: 100, time: 80 }, null)).status).toBe(401);
    expect((await post({ level: 'f0', score: 100, time: 80 }, 'f'.repeat(48))).status).toBe(401);
    expect((await post({ nonsense: 1 })).status).toBe(400);
    const good = await post({ level: 'f0', score: 2500, time: 80 });
    expect(good).toMatchObject({ status: 200, json: { status: 'ok', rank: { week: 1 } } });
    expect((await post({ level: 'f0', score: 2500000, time: 80 })).json).toEqual({ status: 'unexpected' });
    for (let i = 0; i < 3; i++) await post({ level: 'f0', score: 100, time: 80 });
    await post({ level: 'f0', score: 100, time: 80 });
    await post({ level: 'f0', score: 100, time: 80 });
    expect((await post({ level: 'f0', score: 100, time: 80 })).status).toBe(429);
    void reg;
  });
});
