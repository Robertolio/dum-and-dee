import { describe, expect, it } from 'vitest';
import { mkClock, mkSocial } from './helpers';

const two = async (extra = {}) => {
  const ctx = await mkSocial(mkClock(), extra);
  const a = await ctx.social.register('Rob', '1.1.1.1');
  const b = await ctx.social.register('Mia', '2.2.2.2');
  if (!a.ok || !b.ok) throw new Error('reg');
  return { ...ctx, a: a.player, b: b.player, ta: a.token, tb: b.token };
};
const online = () => false;
const open = () => true;

describe('identity', () => {
  it('registers, authenticates by token, never stores the token in clear', async () => {
    const { social, db, a, ta } = await two();
    expect(a.code).toMatch(/^ROB-[2-9A-Z]{3}$/);
    expect((await social.authenticate(ta))?.id).toBe(a.id);
    expect(await social.authenticate('0'.repeat(48))).toBeNull();
    expect(await social.authenticate('nope')).toBeNull();
    const rows = await db.all<{ token_hash: string }>('SELECT token_hash FROM players');
    expect(rows.every((r) => !r.token_hash.includes(ta))).toBe(true);
  });
  it('rejects bad and profane names', async () => {
    const { social } = await two();
    expect(await social.register('x', 'ip')).toEqual({ ok: false, error: 'name_length' });
    expect(await social.register('fuck', 'ip')).toEqual({ ok: false, error: 'name_profane' });
    expect(await social.register('<script>', 'ip')).toEqual({ ok: false, error: 'name_chars' });
  });
  it('rate limits registrations per IP', async () => {
    const { social } = await mkSocial(mkClock(), { registrationsPerHourPerIp: 2 });
    expect((await social.register('Abc', 'ip')).ok).toBe(true);
    expect((await social.register('Abd', 'ip')).ok).toBe(true);
    expect(await social.register('Abe', 'ip')).toEqual({ ok: false, error: 'rate_limited' });
    expect((await social.register('Abe', 'other')).ok).toBe(true);
  });
  it('renews the code and renames', async () => {
    const { social, a } = await two();
    const { code } = await social.renewCode(a.id);
    expect(code).not.toBe(a.code);
    expect((await social.player(a.id))?.code).toBe(code);
    expect(await social.rename(a.id, 'Robert')).toEqual({ ok: true, name: 'Robert' });
  });
  it('delete me wipes everything about the player', async () => {
    const { social, db, a, b, ta } = await two();
    await social.addFriend(a.id, b.code, 'x');
    await social.respond(b.id, a.id, true);
    await social.proposeTeam(a.id, b.id, 'Dynamo');
    await social.saveSubscription(a.id, { endpoint: 'https://p/1', p256dh: 'k', auth: 'a' });
    await social.createInvite(a.id, b.id, 'ABCDEF');
    await social.deleteMe(a.id);
    expect(await social.authenticate(ta)).toBeNull();
    for (const t of ['friendships', 'teams', 'invites', 'push_subscriptions', 'blocks']) expect(await db.all(`SELECT * FROM ${t}`), t).toEqual([]);
    expect((await social.view(b.id, online, open))?.friends).toEqual([]);
  });
});

describe('friendship flow', () => {
  it('request must be accepted by the other side (mutual)', async () => {
    const { social, a, b } = await two();
    const r = await social.addFriend(a.id, ` ${b.code.toLowerCase()} `, 'x');
    expect(r).toMatchObject({ ok: true, state: 'sent' });
    let va = (await social.view(a.id, online, open))!;
    let vb = (await social.view(b.id, online, open))!;
    expect(va.friends).toEqual([]);
    expect(va.outgoing.map((x) => x.name)).toEqual(['Mia']);
    expect(vb.incoming.map((x) => x.name)).toEqual(['Rob']);
    expect(await social.areFriends(a.id, b.id)).toBe(false);
    expect(await social.respond(a.id, b.id, true)).toMatchObject({ ok: false });
    expect(await social.respond(b.id, a.id, true)).toEqual({ ok: true });
    va = (await social.view(a.id, (id) => id === b.id, open))!;
    vb = (await social.view(b.id, online, open))!;
    expect(va.friends.map((f) => [f.name, f.online])).toEqual([['Mia', true]]);
    expect(vb.friends.map((f) => [f.name, f.online])).toEqual([['Rob', false]]);
    expect(va.friends[0]!.team.name).toBe('Rob & Mia');
    expect(vb.friends[0]!.team.name).toBe('Mia & Rob');
  });
  it('declining removes the request; errors are specific', async () => {
    const { social, a, b } = await two();
    expect(await social.addFriend(a.id, a.code, 'x')).toEqual({ ok: false, error: 'self' });
    expect(await social.addFriend(a.id, 'ZZZ-ZZZ', 'x')).toEqual({ ok: false, error: 'unknown_code' });
    expect(await social.addFriend(a.id, 'nonsense', 'x')).toEqual({ ok: false, error: 'bad_code' });
    await social.addFriend(a.id, b.code, 'x');
    expect(await social.addFriend(a.id, b.code, 'x')).toEqual({ ok: false, error: 'already_sent' });
    await social.respond(b.id, a.id, false);
    expect((await social.view(b.id, online, open))!.incoming).toEqual([]);
    expect(await social.addFriend(a.id, b.code, 'x')).toMatchObject({ ok: true });
  });
  it('crossing requests auto-accept', async () => {
    const { social, a, b } = await two();
    await social.addFriend(a.id, b.code, 'x');
    expect(await social.addFriend(b.id, a.code, 'y')).toMatchObject({ ok: true, state: 'accepted' });
    expect(await social.areFriends(a.id, b.id)).toBe(true);
    expect(await social.addFriend(b.id, a.code, 'y')).toEqual({ ok: false, error: 'already_friends' });
  });
  it('remove ends the friendship for both', async () => {
    const { social, a, b } = await two();
    await social.addFriend(a.id, b.code, 'x');
    await social.respond(b.id, a.id, true);
    await social.remove(a.id, b.id);
    expect((await social.view(a.id, online, open))!.friends).toEqual([]);
    expect((await social.view(b.id, online, open))!.friends).toEqual([]);
  });
  it('block removes the friendship, stops requests silently, unblock restores the option', async () => {
    const { social, a, b } = await two();
    await social.addFriend(a.id, b.code, 'x');
    await social.respond(b.id, a.id, true);
    await social.block(b.id, a.id);
    expect(await social.areFriends(a.id, b.id)).toBe(false);
    expect((await social.view(b.id, online, open))!.blocked.map((x) => x.name)).toEqual(['Rob']);
    expect(await social.addFriend(a.id, b.code, 'x')).toMatchObject({ ok: true });
    expect((await social.view(b.id, online, open))!.incoming).toEqual([]);
    expect(await social.addFriend(b.id, a.code, 'y')).toEqual({ ok: false, error: 'unblock_first' });
    await social.unblock(b.id, a.id);
    expect(await social.addFriend(b.id, a.code, 'y')).toMatchObject({ ok: true });
  });
  it('rate limits code attempts per device', async () => {
    const { social, a } = await two({ codeAttemptsPerMinute: 3 });
    const res = [];
    for (let i = 0; i < 5; i++) res.push(await social.addFriend(a.id, `AAA-${i + 2}22`, `ip${i}`));
    expect(res.map((r) => (r.ok ? 'ok' : r.error))).toEqual(['unknown_code', 'unknown_code', 'unknown_code', 'rate_limited', 'rate_limited']);
  });
  it('rate limits code attempts per IP across devices', async () => {
    const { social, a, b } = await two({ codeAttemptsPerMinute: 2 });
    await social.addFriend(a.id, 'AAA-222', 'same');
    await social.addFriend(b.id, 'AAA-222', 'same');
    expect(await social.addFriend(b.id, 'AAA-222', 'same')).toEqual({ ok: false, error: 'rate_limited' });
  });
  it('shows no friends-of-friends and no strangers', async () => {
    const { social, a, b } = await two();
    const c = await social.register('Cleo', '3.3.3.3');
    if (!c.ok) throw new Error();
    await social.addFriend(a.id, b.code, 'x');
    await social.respond(b.id, a.id, true);
    await social.addFriend(b.id, c.player.code, 'y');
    await social.respond(c.player.id, b.id, true);
    const va = (await social.view(a.id, online, open))!;
    expect(va.friends.map((f) => f.name)).toEqual(['Mia']);
    expect(JSON.stringify(va)).not.toContain('Cleo');
    expect(await social.areFriends(a.id, c.player.id)).toBe(false);
  });
});

describe('team names', () => {
  const friends = async () => {
    const x = await two();
    await x.social.addFriend(x.a.id, x.b.code, 'x');
    await x.social.respond(x.b.id, x.a.id, true);
    return x;
  };
  it('needs confirmation of the other side before it changes', async () => {
    const { social, a, b } = await friends();
    expect(await social.proposeTeam(a.id, b.id, 'The Ladders')).toEqual({ ok: true });
    let fa = (await social.view(a.id, online, open))!.friends[0]!;
    let fb = (await social.view(b.id, online, open))!.friends[0]!;
    expect(fa.team).toMatchObject({ name: 'Rob & Mia', custom: false, pending: { name: 'The Ladders', by: 'me' } });
    expect(fb.team.pending).toEqual({ name: 'The Ladders', by: 'them' });
    expect(await social.answerTeam(a.id, b.id, true)).toMatchObject({ ok: false });
    expect(await social.teamName(a.id, b.id)).toBeNull();
    expect(await social.answerTeam(b.id, a.id, true)).toEqual({ ok: true });
    fa = (await social.view(a.id, online, open))!.friends[0]!;
    fb = (await social.view(b.id, online, open))!.friends[0]!;
    expect(fa.team).toEqual({ name: 'The Ladders', custom: true, pending: null });
    expect(fb.team.name).toBe('The Ladders');
    expect(await social.teamName(b.id, a.id)).toBe('The Ladders');
  });
  it('declining keeps the old name', async () => {
    const { social, a, b } = await friends();
    await social.proposeTeam(a.id, b.id, 'Alpha Duo');
    await social.answerTeam(b.id, a.id, true);
    await social.proposeTeam(b.id, a.id, 'Beta Duo');
    await social.answerTeam(a.id, b.id, false);
    expect(await social.teamName(a.id, b.id)).toBe('Alpha Duo');
    expect((await social.view(a.id, online, open))!.friends[0]!.team.pending).toBeNull();
  });
  it('filters profanity, validates, needs friendship', async () => {
    const { social, a, b } = await friends();
    expect(await social.proposeTeam(a.id, b.id, 'shit show')).toEqual({ ok: false, error: 'name_profane' });
    expect(await social.proposeTeam(a.id, b.id, '<b>')).toMatchObject({ ok: false });
    const c = await social.register('Cleo', '3.3.3.3');
    if (!c.ok) throw new Error();
    expect(await social.proposeTeam(a.id, c.player.id, 'Nope')).toEqual({ ok: false, error: 'not_friends' });
  });
});

describe('invites', () => {
  it('only friends, expire, can be dismissed', async () => {
    const { social, a, b, clock } = await two();
    expect(await social.createInvite(a.id, b.id, 'ABCDEF')).toEqual({ ok: false, error: 'not_friends' });
    await social.addFriend(a.id, b.code, 'x');
    await social.respond(b.id, a.id, true);
    expect((await social.createInvite(a.id, b.id, 'ABCDEF')).ok).toBe(true);
    let v = (await social.view(b.id, online, open))!;
    expect(v.invites).toMatchObject([{ from: a.id, name: 'Rob', room: 'ABCDEF' }]);
    expect((await social.view(b.id, online, () => false))!.invites).toEqual([]);
    await social.dismissInvite(b.id, v.invites[0]!.id);
    expect((await social.view(b.id, online, open))!.invites).toEqual([]);
    await social.createInvite(a.id, b.id, 'ABCDEF');
    clock.advance(16 * 60_000);
    v = (await social.view(b.id, online, open))!;
    expect(v.invites).toEqual([]);
  });
});

describe('admin helpers', () => {
  it('lists, renames (with filter), blocks', async () => {
    const { social, a, ta } = await two();
    expect((await social.adminList()).length).toBe(2);
    expect(await social.adminSetName(a.id, 'Bobby')).toBe(true);
    expect(await social.adminSetName(a.id, 'fuck')).toBe(false);
    expect(await social.adminBlock(a.id, true)).toBe(true);
    expect(await social.authenticate(ta)).toBeNull();
    await social.adminBlock(a.id, false);
    expect((await social.authenticate(ta))?.name).toBe('Bobby');
  });
});
