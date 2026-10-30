import { describe, expect, it } from 'vitest';
import { mkHub } from './helpers';

const setup = async () => {
  const h = await mkHub();
  const A = h.client('1.1.1.1');
  const B = h.client('2.2.2.2');
  await A.say({ t: 'reg', name: 'Rob' });
  await B.say({ t: 'reg', name: 'Mia' });
  const codeA = A.conn.last('me')!.me.code as string;
  const codeB = B.conn.last('me')!.me.code as string;
  return { ...h, A, B, codeA, codeB, idA: A.conn.last('me')!.me.id as string, idB: B.conn.last('me')!.me.id as string };
};

describe('hub', () => {
  it('registers and returns token, me and vapid cfg', async () => {
    const { A } = await setup();
    expect(A.conn.last('reg_ok')!.token).toMatch(/^[0-9a-f]{48}$/);
    expect(A.conn.last('cfg')!.vapid).toBe('PUB');
    expect(A.conn.last('me')!.me.name).toBe('Rob');
  });
  it('re-authenticates with the token on a new socket', async () => {
    const { client, A } = await setup();
    const token = A.conn.last('reg_ok')!.token;
    const A2 = client('1.1.1.1');
    await A2.say({ t: 'auth', token });
    expect(A2.conn.last('me')!.me.name).toBe('Rob');
    const bad = client('3.3.3.3');
    await bad.say({ t: 'auth', token: 'f'.repeat(48) });
    expect(bad.conn.last('auth_fail')).toBeTruthy();
  });
  it('social actions need auth', async () => {
    const { client } = await setup();
    const x = client('9.9.9.9');
    await x.say({ t: 'fr_add', code: 'AAA-222' });
    expect(x.conn.last('soc_err')!.code).toBe('auth_required');
  });
  it('friend request flow updates both sides live incl. presence', async () => {
    const { A, B, codeB, idA, idB } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    expect(B.conn.last('me')!.me.incoming.map((x: any) => x.name)).toEqual(['Rob']);
    await B.say({ t: 'fr_yes', id: idA });
    expect(A.conn.last('me')!.me.friends).toMatchObject([{ id: idB, name: 'Mia', online: true }]);
    expect(B.conn.last('me')!.me.friends).toMatchObject([{ id: idA, name: 'Rob', online: true }]);
  });
  it('goes offline for friends on disconnect', async () => {
    const { A, B, codeB, idA, hub } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    await B.say({ t: 'fr_yes', id: idA });
    hub.disconnect(A.hc);
    await new Promise((r) => setTimeout(r, 30));
    expect(B.conn.last('me')!.me.friends[0].online).toBe(false);
  });
  it('team name needs both sides', async () => {
    const { A, B, codeB, idA, idB } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    await B.say({ t: 'fr_yes', id: idA });
    await A.say({ t: 'team_set', id: idB, name: 'Ladder Pros' });
    expect(B.conn.last('me')!.me.friends[0].team.pending).toEqual({ name: 'Ladder Pros', by: 'them' });
    await B.say({ t: 'team_yes', id: idA });
    expect(A.conn.last('me')!.me.friends[0].team.name).toBe('Ladder Pros');
    await A.say({ t: 'team_set', id: idB, name: 'fuck' });
    expect(A.conn.last('soc_err')!.code).toBe('name_profane');
  });
  it('Play with: invite goes live to an online friend, who can join the room', async () => {
    const { A, B, codeB, idA, idB, mgr } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    await B.say({ t: 'fr_yes', id: idA });
    await A.say({ t: 'create', v: 1 });
    const room = A.conn.last('joined')!.room as string;
    await A.say({ t: 'invite', id: idB, room });
    expect(A.conn.last('invite_sent')).toMatchObject({ delivered: 'live' });
    expect(B.conn.last('invite')).toMatchObject({ name: 'Rob', room });
    expect(B.conn.last('me')!.me.invites).toMatchObject([{ name: 'Rob', room }]);
    await B.say({ t: 'join', room, v: 1 });
    expect(B.conn.last('joined')!.room).toBe(room);
    expect(mgr.roomByCode(room)!.phase).toBe('lobby');
  });
  it('refuses invites for rooms you are not in, and to non-friends', async () => {
    const { A, B, idB, mgr } = await setup();
    await B.say({ t: 'create', v: 1 });
    const room = B.conn.last('joined')!.room as string;
    await A.say({ t: 'invite', id: idB, room });
    expect(A.conn.last('soc_err')!.code).toBe('no_room');
    await A.say({ t: 'create', v: 1 });
    const mine = A.conn.last('joined')!.room as string;
    await A.say({ t: 'invite', id: idB, room: mine });
    expect(A.conn.last('soc_err')!.code).toBe('not_friends');
    expect(mgr.roomCount).toBe(2);
  });
  it('offline friend gets a web push and the invite is waiting at app open', async () => {
    const { A, B, codeB, idA, idB, hub, sent, client } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    await B.say({ t: 'fr_yes', id: idA });
    await B.say({ t: 'push_sub', endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' });
    expect(B.conn.last('push_ok')).toBeTruthy();
    const tokenB = B.conn.last('reg_ok')!.token;
    hub.disconnect(B.hc);
    await A.say({ t: 'create', v: 1 });
    const room = A.conn.last('joined')!.room as string;
    await A.say({ t: 'invite', id: idB, room });
    expect(A.conn.last('invite_sent')).toMatchObject({ delivered: 'push' });
    expect(sent).toMatchObject([{ endpoint: 'https://push.example/abc', payload: { title: 'Rob is waiting' } }]);
    const B2 = client('2.2.2.2');
    await B2.say({ t: 'auth', token: tokenB });
    expect(B2.conn.last('me')!.me.invites).toMatchObject([{ name: 'Rob', room }]);
  });
  it('drops dead subscriptions and reports none when push fails', async () => {
    const h = await mkHub({ publicKey: 'P', send: async () => 'gone' });
    const A = h.client('1.1.1.1');
    const B = h.client('2.2.2.2');
    await A.say({ t: 'reg', name: 'Rob' });
    await B.say({ t: 'reg', name: 'Mia' });
    const idA = A.conn.last('me')!.me.id;
    const idB = B.conn.last('me')!.me.id;
    await A.say({ t: 'fr_add', code: B.conn.last('me')!.me.code });
    await B.say({ t: 'fr_yes', id: idA });
    await B.say({ t: 'push_sub', endpoint: 'https://push.example/dead', p256dh: 'k', auth: 'a' });
    h.hub.disconnect(B.hc);
    await A.say({ t: 'create', v: 1 });
    await A.say({ t: 'invite', id: idB, room: A.conn.last('joined')!.room });
    expect(A.conn.last('invite_sent')).toMatchObject({ delivered: 'none' });
    expect(await h.social.subscriptions(idB)).toEqual([]);
  });
  it('validates push subscriptions and ignores malformed social input', async () => {
    const { A, idA } = await setup();
    await A.say({ t: 'push_sub', endpoint: 'http://insecure', p256dh: 'k', auth: 'a' });
    expect(A.conn.last('soc_err')!.code).toBe('bad_push');
    await A.say({ t: 'fr_yes', id: '../etc' });
    expect(A.conn.last('soc_err')!.code).toBe('not_found');
    await A.say({ t: 'fr_add', code: { x: 1 } });
    expect(A.conn.last('soc_err')!.code).toBe('bad_code');
    void idA;
  });
  it('rate limits social messages per connection', async () => {
    const { A } = await setup();
    for (let i = 0; i < 40; i++) A.hc && (await A.say({ t: 'sync' }).catch(() => undefined));
    expect(A.conn.got.some((m) => m.t === 'soc_err' && m.code === 'rate_limited')).toBe(true);
  });
  it('delete me wipes the account and tells friends', async () => {
    const { A, B, codeB, idA, social } = await setup();
    await A.say({ t: 'fr_add', code: codeB });
    await B.say({ t: 'fr_yes', id: idA });
    await A.say({ t: 'delete_me' });
    expect(A.conn.last('deleted')).toBeTruthy();
    expect(await social.player(idA)).toBeUndefined();
    expect(B.conn.last('me')!.me.friends).toEqual([]);
  });
  it('does not break the room protocol', async () => {
    const { A, B } = await setup();
    await A.say({ t: 'create', v: 1 });
    const room = A.conn.last('joined')!.room;
    await B.say({ t: 'join', room, v: 1 });
    await A.say({ t: 'ready', ready: true });
    await B.say({ t: 'ready', ready: true });
    expect(A.conn.last('count')).toBeTruthy();
  });
});
