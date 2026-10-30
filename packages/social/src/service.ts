import { createHash } from 'node:crypto';
import type { Db } from './db';
import { makeFriendCode, normalizeFriendCode, randomHex, randomId, type RandomBytes } from './codes';
import { validateName } from './filter';
import { RateLimiter } from './ratelimit';

export interface PlayerRow {
  id: string;
  name: string;
  code: string;
  blocked: number;
}

export interface FriendView {
  id: string;
  name: string;
  online: boolean;
  team: { name: string; custom: boolean; pending: null | { name: string; by: 'me' | 'them' } };
}

export interface MeView {
  id: string;
  name: string;
  code: string;
  friends: FriendView[];
  incoming: Array<{ id: string; name: string }>;
  outgoing: Array<{ id: string; name: string }>;
  blocked: Array<{ id: string; name: string }>;
  invites: Array<{ id: string; from: string; name: string; room: string }>;
}

export type SocialError =
  | 'bad_name'
  | 'name_length'
  | 'name_chars'
  | 'name_profane'
  | 'unknown_code'
  | 'bad_code'
  | 'self'
  | 'already_friends'
  | 'already_sent'
  | 'unblock_first'
  | 'rate_limited'
  | 'not_found'
  | 'not_friends'
  | 'blocked';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: SocialError };

export interface SocialOptions {
  now: () => number;
  randomBytes: RandomBytes;
  /** Friend-code lookups per minute per device and per IP. */
  codeAttemptsPerMinute?: number;
  registrationsPerHourPerIp?: number;
  inviteTtlMs?: number;
}

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');
const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const nameError = (r: 'length' | 'chars' | 'profane'): SocialError => (r === 'length' ? 'name_length' : r === 'chars' ? 'name_chars' : 'name_profane');
export const defaultTeamName = (mine: string, theirs: string): string => `${mine} & ${theirs}`;

/** Identity, friends, teams, invites and push subscriptions on top of a Db. No tokens are stored in clear or logged. */
export class Social {
  private readonly o: Required<SocialOptions>;
  private readonly codeLimit: RateLimiter;
  private readonly regLimit: RateLimiter;

  constructor(readonly db: Db, opts: SocialOptions) {
    this.o = { codeAttemptsPerMinute: 10, registrationsPerHourPerIp: 8, inviteTtlMs: 15 * 60_000, ...opts };
    this.codeLimit = new RateLimiter(this.o.codeAttemptsPerMinute, 60_000, opts.now);
    this.regLimit = new RateLimiter(this.o.registrationsPerHourPerIp, 3_600_000, opts.now);
  }

  // ---- identity ----

  async register(rawName: unknown, ip: string): Promise<Result<{ token: string; player: PlayerRow }>> {
    const v = validateName(rawName);
    if (!v.ok) return { ok: false, error: nameError(v.reason) };
    if (!this.regLimit.hit(`reg:${ip}`)) return { ok: false, error: 'rate_limited' };
    const rb = this.o.randomBytes;
    const token = randomHex(24, rb);
    const id = randomId(10, rb);
    const code = await this.freeCode(v.name);
    const now = this.o.now();
    await this.db.run('INSERT INTO players (id, token_hash, name, code, blocked, created, last_seen) VALUES (?, ?, ?, ?, 0, ?, ?)', [id, hashToken(token), v.name, code, now, now]);
    return { ok: true, token, player: { id, name: v.name, code, blocked: 0 } };
  }

  private async freeCode(name: string): Promise<string> {
    for (let i = 0; i < 30; i++) {
      const code = makeFriendCode(name, this.o.randomBytes);
      if (!(await this.db.get('SELECT id FROM players WHERE code = ?', [code]))) return code;
    }
    throw new Error('no free friend code');
  }

  async authenticate(token: unknown): Promise<PlayerRow | null> {
    if (typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return null;
    const p = await this.db.get<PlayerRow>('SELECT id, name, code, blocked FROM players WHERE token_hash = ?', [hashToken(token)]);
    if (!p || p.blocked) return null;
    await this.db.run('UPDATE players SET last_seen = ? WHERE id = ?', [this.o.now(), p.id]);
    return p;
  }

  async rename(id: string, rawName: unknown): Promise<Result<{ name: string }>> {
    const v = validateName(rawName);
    if (!v.ok) return { ok: false, error: nameError(v.reason) };
    await this.db.run('UPDATE players SET name = ? WHERE id = ?', [v.name, id]);
    return { ok: true, name: v.name };
  }

  async renewCode(id: string): Promise<{ code: string }> {
    const p = await this.player(id);
    const code = await this.freeCode(p?.name ?? 'XXX');
    await this.db.run('UPDATE players SET code = ? WHERE id = ?', [code, id]);
    return { code };
  }

  /** "Delete me": every trace of the player. */
  async deleteMe(id: string): Promise<void> {
    const q = (sql: string, ...p: unknown[]): Promise<void> => this.db.run(sql, p);
    await q('DELETE FROM friendships WHERE a = ? OR b = ?', id, id);
    await q('DELETE FROM blocks WHERE blocker = ? OR blocked = ?', id, id);
    await q('DELETE FROM teams WHERE a = ? OR b = ?', id, id);
    await q('DELETE FROM invites WHERE from_id = ? OR to_id = ?', id, id);
    await q('DELETE FROM push_subscriptions WHERE player_id = ?', id);
    await q('DELETE FROM players WHERE id = ?', id);
  }

  async player(id: string): Promise<PlayerRow | undefined> {
    return this.db.get<PlayerRow>('SELECT id, name, code, blocked FROM players WHERE id = ?', [id]);
  }

  /** Players not seen for a long time are removed (data minimisation). */
  async purgeInactive(olderThanMs = 180 * 86_400_000): Promise<number> {
    const rows = await this.db.all<{ id: string }>('SELECT id FROM players WHERE last_seen < ?', [this.o.now() - olderThanMs]);
    for (const r of rows) await this.deleteMe(r.id);
    return rows.length;
  }

  // ---- friends ----

  private async isBlocked(by: string, other: string): Promise<boolean> {
    return !!(await this.db.get('SELECT blocker FROM blocks WHERE blocker = ? AND blocked = ?', [by, other]));
  }

  /** Add by friend code. Mutual: the other side has to accept (unless they already asked us, then it is accepted). */
  async addFriend(me: string, rawCode: unknown, ip: string): Promise<Result<{ state: 'sent' | 'accepted'; other: string }>> {
    if (!this.codeLimit.hit(`dev:${me}`) || !this.codeLimit.hit(`ip:${ip}`)) return { ok: false, error: 'rate_limited' };
    const code = normalizeFriendCode(rawCode);
    if (!code) return { ok: false, error: 'bad_code' };
    const other = await this.db.get<PlayerRow>('SELECT id, name, code, blocked FROM players WHERE code = ?', [code]);
    if (!other || other.blocked) return { ok: false, error: 'unknown_code' };
    if (other.id === me) return { ok: false, error: 'self' };
    if (await this.isBlocked(me, other.id)) return { ok: false, error: 'unblock_first' };
    const [a, b] = pair(me, other.id);
    const f = await this.db.get<{ state: string; requester: string }>('SELECT state, requester FROM friendships WHERE a = ? AND b = ?', [a, b]);
    // Blocked by them: pretend it worked, store nothing.
    if (await this.isBlocked(other.id, me)) return { ok: true, state: 'sent', other: other.id };
    if (f?.state === 'accepted') return { ok: false, error: 'already_friends' };
    if (f && f.requester === me) return { ok: false, error: 'already_sent' };
    if (f) {
      await this.db.run("UPDATE friendships SET state = 'accepted' WHERE a = ? AND b = ?", [a, b]);
      return { ok: true, state: 'accepted', other: other.id };
    }
    await this.db.run("INSERT INTO friendships (a, b, state, requester, created) VALUES (?, ?, 'pending', ?, ?)", [a, b, me, this.o.now()]);
    return { ok: true, state: 'sent', other: other.id };
  }

  async respond(me: string, otherId: string, accept: boolean): Promise<Result> {
    const [a, b] = pair(me, otherId);
    const f = await this.db.get<{ state: string; requester: string }>('SELECT state, requester FROM friendships WHERE a = ? AND b = ?', [a, b]);
    if (!f || f.state !== 'pending' || f.requester === me) return { ok: false, error: 'not_found' };
    if (accept) await this.db.run("UPDATE friendships SET state = 'accepted' WHERE a = ? AND b = ?", [a, b]);
    else await this.db.run('DELETE FROM friendships WHERE a = ? AND b = ?', [a, b]);
    return { ok: true };
  }

  /** Remove a friend or cancel a request. */
  async remove(me: string, otherId: string): Promise<Result> {
    const [a, b] = pair(me, otherId);
    await this.db.run('DELETE FROM friendships WHERE a = ? AND b = ?', [a, b]);
    await this.db.run('DELETE FROM teams WHERE a = ? AND b = ?', [a, b]);
    await this.db.run('DELETE FROM invites WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', [me, otherId, otherId, me]);
    return { ok: true };
  }

  async block(me: string, otherId: string): Promise<Result> {
    if (!(await this.player(otherId))) return { ok: false, error: 'not_found' };
    await this.remove(me, otherId);
    await this.db.run('DELETE FROM blocks WHERE blocker = ? AND blocked = ?', [me, otherId]);
    await this.db.run('INSERT INTO blocks (blocker, blocked, created) VALUES (?, ?, ?)', [me, otherId, this.o.now()]);
    return { ok: true };
  }

  async unblock(me: string, otherId: string): Promise<Result> {
    await this.db.run('DELETE FROM blocks WHERE blocker = ? AND blocked = ?', [me, otherId]);
    return { ok: true };
  }

  async areFriends(x: string, y: string): Promise<boolean> {
    const [a, b] = pair(x, y);
    return (await this.db.get<{ state: string }>('SELECT state FROM friendships WHERE a = ? AND b = ?', [a, b]))?.state === 'accepted';
  }

  async friendIds(me: string): Promise<string[]> {
    const rows = await this.db.all<{ a: string; b: string }>("SELECT a, b FROM friendships WHERE state = 'accepted' AND (a = ? OR b = ?)", [me, me]);
    return rows.map((r) => (r.a === me ? r.b : r.a));
  }

  // ---- teams ----

  /** Propose a team name for a duo. The partner has to confirm; the default is "<A> & <B>". */
  async proposeTeam(me: string, friend: string, rawName: unknown): Promise<Result> {
    if (!(await this.areFriends(me, friend))) return { ok: false, error: 'not_friends' };
    const v = validateName(rawName, 24);
    if (!v.ok) return { ok: false, error: nameError(v.reason) };
    const [a, b] = pair(me, friend);
    const now = this.o.now();
    const t = await this.db.get('SELECT a FROM teams WHERE a = ? AND b = ?', [a, b]);
    if (t) await this.db.run('UPDATE teams SET pending_name = ?, proposer = ?, updated = ? WHERE a = ? AND b = ?', [v.name, me, now, a, b]);
    else await this.db.run('INSERT INTO teams (a, b, name, pending_name, proposer, updated) VALUES (?, ?, NULL, ?, ?, ?)', [a, b, v.name, me, now]);
    return { ok: true };
  }

  async answerTeam(me: string, friend: string, accept: boolean): Promise<Result> {
    const [a, b] = pair(me, friend);
    const t = await this.db.get<{ pending_name: string | null; proposer: string | null }>('SELECT pending_name, proposer FROM teams WHERE a = ? AND b = ?', [a, b]);
    if (!t?.pending_name) return { ok: false, error: 'not_found' };
    // The proposer can only cancel; the other one confirms.
    if (accept && t.proposer === me) return { ok: false, error: 'not_found' };
    if (accept) await this.db.run('UPDATE teams SET name = pending_name, pending_name = NULL, proposer = NULL, updated = ? WHERE a = ? AND b = ?', [this.o.now(), a, b]);
    else await this.db.run('UPDATE teams SET pending_name = NULL, proposer = NULL, updated = ? WHERE a = ? AND b = ?', [this.o.now(), a, b]);
    return { ok: true };
  }

  async teamName(x: string, y: string): Promise<string | null> {
    const [a, b] = pair(x, y);
    return (await this.db.get<{ name: string | null }>('SELECT name FROM teams WHERE a = ? AND b = ?', [a, b]))?.name ?? null;
  }

  // ---- invites ----

  async createInvite(from: string, to: string, room: string): Promise<Result<{ id: string }>> {
    if (!(await this.areFriends(from, to))) return { ok: false, error: 'not_friends' };
    const id = randomId(10, this.o.randomBytes);
    const now = this.o.now();
    await this.db.run('DELETE FROM invites WHERE from_id = ? AND to_id = ?', [from, to]);
    await this.db.run('INSERT INTO invites (id, from_id, to_id, room, created, expires) VALUES (?, ?, ?, ?, ?, ?)', [id, from, to, room, now, now + this.o.inviteTtlMs]);
    return { ok: true, id };
  }

  async dismissInvite(me: string, id: string): Promise<void> {
    await this.db.run('DELETE FROM invites WHERE id = ? AND to_id = ?', [id, me]);
  }

  // ---- push ----

  async saveSubscription(playerId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
    await this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
    await this.db.run('INSERT INTO push_subscriptions (id, player_id, endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?, ?, ?)', [randomId(10, this.o.randomBytes), playerId, sub.endpoint, sub.p256dh, sub.auth, this.o.now()]);
  }
  async removeSubscription(playerId: string, endpoint: string): Promise<void> {
    await this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND player_id = ?', [endpoint, playerId]);
  }
  async dropEndpoint(endpoint: string): Promise<void> {
    await this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  }
  async subscriptions(playerId: string): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
    return this.db.all('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE player_id = ?', [playerId]);
  }

  // ---- view ----

  /** Everything one player may see: own data, own friends (name, online, team name), own requests. Nothing about others' friendships. */
  async view(me: string, online: (id: string) => boolean, roomOpen: (room: string) => boolean): Promise<MeView | null> {
    const p = await this.player(me);
    if (!p) return null;
    const rows = await this.db.all<{ a: string; b: string; state: string; requester: string }>('SELECT a, b, state, requester FROM friendships WHERE a = ? OR b = ?', [me, me]);
    const names = new Map<string, string>();
    const ids = rows.map((r) => (r.a === me ? r.b : r.a));
    const blocks = await this.db.all<{ blocked: string }>('SELECT blocked FROM blocks WHERE blocker = ?', [me]);
    for (const id of [...ids, ...blocks.map((b) => b.blocked)]) {
      const o = await this.player(id);
      if (o) names.set(id, o.name);
    }
    const friends: FriendView[] = [];
    const incoming: MeView['incoming'] = [];
    const outgoing: MeView['outgoing'] = [];
    for (const r of rows) {
      const other = r.a === me ? r.b : r.a;
      const name = names.get(other);
      if (!name) continue;
      if (r.state === 'accepted') {
        const [a, b] = pair(me, other);
        const t = await this.db.get<{ name: string | null; pending_name: string | null; proposer: string | null }>('SELECT name, pending_name, proposer FROM teams WHERE a = ? AND b = ?', [a, b]);
        friends.push({
          id: other,
          name,
          online: online(other),
          team: {
            name: t?.name ?? defaultTeamName(p.name, name),
            custom: !!t?.name,
            pending: t?.pending_name ? { name: t.pending_name, by: t.proposer === me ? 'me' : 'them' } : null,
          },
        });
      } else if (r.requester === me) outgoing.push({ id: other, name });
      else incoming.push({ id: other, name });
    }
    const now = this.o.now();
    const inv = await this.db.all<{ id: string; from_id: string; room: string; expires: number }>('SELECT id, from_id, room, expires FROM invites WHERE to_id = ?', [me]);
    const invites: MeView['invites'] = [];
    for (const i of inv) {
      if (i.expires < now || !roomOpen(i.room)) {
        await this.db.run('DELETE FROM invites WHERE id = ?', [i.id]);
        continue;
      }
      const from = await this.player(i.from_id);
      if (from && (await this.areFriends(me, from.id))) invites.push({ id: i.id, from: from.id, name: from.name, room: i.room });
    }
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      friends: friends.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name)),
      incoming,
      outgoing,
      blocked: blocks.map((b) => ({ id: b.blocked, name: names.get(b.blocked) ?? '?' })),
      invites,
    };
  }

  // ---- admin ----

  async adminList(limit = 100): Promise<Array<{ id: string; name: string; code: string; blocked: number; created: number; last_seen: number }>> {
    return this.db.all('SELECT id, name, code, blocked, created, last_seen FROM players ORDER BY created DESC LIMIT ?', [Math.max(1, Math.min(500, limit))]);
  }
  async adminSetName(id: string, name: string): Promise<boolean> {
    const v = validateName(name);
    if (!v.ok || !(await this.player(id))) return false;
    await this.db.run('UPDATE players SET name = ? WHERE id = ?', [v.name, id]);
    return true;
  }
  async adminBlock(id: string, blocked: boolean): Promise<boolean> {
    if (!(await this.player(id))) return false;
    await this.db.run('UPDATE players SET blocked = ? WHERE id = ?', [blocked ? 1 : 0, id]);
    return true;
  }
}

export { normalizeFriendCode };
