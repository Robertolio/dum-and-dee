import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createAdminHandler, migrate, openSqlite, openStore, Social, wrapPg } from '../src';
import { mkClock, mkSocial } from './helpers';

describe('store', () => {
  it('migrations are idempotent', async () => {
    const db = await openSqlite(':memory:');
    await migrate(db);
    await migrate(db);
    expect((await db.get<{ v: number }>('SELECT MAX(v) AS v FROM schema_version'))!.v).toBeGreaterThan(0);
  });
  it('openStore falls back to a persistent sqlite file without DATABASE_URL', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const file = `${mkdtempSync(`${tmpdir()}/dd-`)}/sub/dd.sqlite`;
    const db = await openStore({ SQLITE_FILE: file });
    expect(db.kind).toBe('sqlite');
    const s1 = new Social(db, { now: Date.now, randomBytes: (n) => randomBytes(n) });
    const r = await s1.register('Rob', 'ip');
    await db.close();
    const again = await openStore({ SQLITE_FILE: file });
    expect((await new Social(again, { now: Date.now, randomBytes: (n) => randomBytes(n) }).player(r.ok ? r.player.id : ''))?.name).toBe('Rob');
    await again.close();
  });
  it('runs the same service on the pg adapter (pg-mem, not a real Postgres)', async () => {
    const { newDb } = await import('pg-mem');
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    const db = wrapPg(new Pool());
    await migrate(db);
    const clock = mkClock();
    const social = new Social(db, { now: clock.now, randomBytes: (n) => randomBytes(n) });
    const a = await social.register('Rob', 'ip1');
    const b = await social.register('Mia', 'ip2');
    if (!a.ok || !b.ok) throw new Error('reg');
    expect(await social.addFriend(a.player.id, b.player.code, 'x')).toMatchObject({ ok: true });
    await social.respond(b.player.id, a.player.id, true);
    await social.proposeTeam(a.player.id, b.player.id, 'Duo X');
    await social.answerTeam(b.player.id, a.player.id, true);
    await social.createInvite(a.player.id, b.player.id, 'ABCDEF');
    const v = (await social.view(b.player.id, () => true, () => true))!;
    expect(v.friends[0]).toMatchObject({ name: 'Rob', team: { name: 'Duo X' } });
    expect(v.invites.length).toBe(1);
    await social.deleteMe(a.player.id);
    expect((await social.view(b.player.id, () => true, () => true))!.friends).toEqual([]);
  });
});

describe('admin API', () => {
  const run = async (key: string | undefined) => {
    const { social } = await mkSocial();
    const a = await social.register('Rob', 'ip');
    if (!a.ok) throw new Error();
    const removed: string[] = [];
    const handle = createAdminHandler(social, key, Date.now, { onPlayerRemoved: (id) => removed.push(id) });
    const srv = createServer((req, res) => void handle(req, res, 'ip').then((h) => h || (res.writeHead(404), res.end())));
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const call = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: object) =>
      fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { srv, call, social, id: a.player.id, removed };
  };
  it('is disabled without ADMIN_KEY', async () => {
    const { srv, call } = await run(undefined);
    expect((await call('/api/admin/players', 'GET', { 'x-admin-key': 'x' })).status).toBe(404);
    srv.close();
  });
  it('requires the key, lists, renames, blocks and deletes', async () => {
    const { srv, call, social, id, removed } = await run('sekret');
    const h = { 'x-admin-key': 'sekret' };
    expect((await call('/api/admin/players')).status).toBe(401);
    expect((await call('/api/admin/players', 'GET', { 'x-admin-key': 'wrong' })).status).toBe(401);
    const list = (await (await call('/api/admin/players', 'GET', h)).json()) as { players: Array<{ id: string; token_hash?: string }> };
    expect(list.players.map((p) => p.id)).toEqual([id]);
    expect(JSON.stringify(list)).not.toContain('token');
    expect((await call(`/api/admin/players/${id}/rename`, 'POST', h, { name: 'Bobby' })).status).toBe(200);
    expect((await social.player(id))?.name).toBe('Bobby');
    expect((await call(`/api/admin/players/${id}/rename`, 'POST', h, { name: 'fuck' })).status).toBe(400);
    expect((await call(`/api/admin/players/${id}/block`, 'POST', h)).status).toBe(200);
    expect(removed).toEqual([id]);
    expect((await call(`/api/admin/players/${id}`, 'DELETE', h)).status).toBe(200);
    expect(await social.player(id)).toBeUndefined();
    expect((await call(`/api/admin/players/${id}`, 'DELETE', h)).status).toBe(404);
    srv.close();
  });
  it('rate limits wrong keys', async () => {
    const { srv, call } = await run('sekret');
    let last = 0;
    for (let i = 0; i < 14; i++) last = (await call('/api/admin/players', 'GET', { 'x-admin-key': 'bad' })).status;
    expect(last).toBe(429);
    srv.close();
  });
});

describe('VAPID keys', () => {
  it('generates once, persists in settings, env overrides', async () => {
    const { resolveVapid, DEFAULT_VAPID_SUBJECT } = await import('../src');
    const db = await openSqlite(':memory:');
    const a = await resolveVapid(db, {});
    expect(a.source).toBe('db');
    expect(a.VAPID_PUBLIC_KEY.length).toBeGreaterThan(40);
    expect(a.VAPID_SUBJECT).toBe(DEFAULT_VAPID_SUBJECT);
    const b = await resolveVapid(db, { VAPID_SUBJECT: 'mailto:me@x.nl' });
    expect(b.VAPID_PUBLIC_KEY).toBe(a.VAPID_PUBLIC_KEY);
    expect(b.VAPID_PRIVATE_KEY).toBe(a.VAPID_PRIVATE_KEY);
    expect(b.VAPID_SUBJECT).toBe('mailto:me@x.nl');
    const c = await resolveVapid(db, { VAPID_PUBLIC_KEY: 'P', VAPID_PRIVATE_KEY: 'Q' });
    expect(c).toMatchObject({ source: 'env', VAPID_PUBLIC_KEY: 'P', VAPID_PRIVATE_KEY: 'Q' });
  });
  it('works on the pg adapter (pg-mem)', async () => {
    const { newDb } = await import('pg-mem');
    const { Pool } = newDb().adapters.createPg();
    const db = wrapPg(new Pool());
    await migrate(db);
    const { resolveVapid } = await import('../src');
    const a = await resolveVapid(db, {});
    expect((await resolveVapid(db, {})).VAPID_PRIVATE_KEY).toBe(a.VAPID_PRIVATE_KEY);
  });
});
