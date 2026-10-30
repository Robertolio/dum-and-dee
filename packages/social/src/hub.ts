import type { Conn, ConnCtx, RoomManager } from '@dd/net';
import type { PushSender } from './push';
import type { Result, Social } from './service';

export interface HubOptions {
  now: () => number;
}

export interface HubConn {
  ctx: ConnCtx;
  conn: Conn;
  playerId: string | null;
  tokens: number;
  at: number;
}

const SOCIAL = new Set([
  'reg', 'auth', 'rename', 'renew', 'delete_me', 'fr_add', 'fr_yes', 'fr_no', 'fr_del', 'fr_block', 'fr_unblock',
  'team_set', 'team_yes', 'team_no', 'invite', 'invite_dismiss', 'push_sub', 'push_unsub', 'sync',
]);

const ID = /^[A-Za-z0-9]{10}$/;
const ROOM = /^[A-Z0-9]{6}$/;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** Social layer in front of RoomManager: identity, friends, teams, invites and presence over the same WebSocket. */
export class Hub {
  private readonly online = new Map<string, Set<HubConn>>();

  constructor(
    readonly mgr: RoomManager,
    readonly social: Social,
    readonly push: PushSender,
    private readonly o: HubOptions,
  ) {}

  isOnline = (id: string): boolean => (this.online.get(id)?.size ?? 0) > 0;

  connect(conn: Conn, ip: string): HubConn | null {
    const ctx = this.mgr.connect(conn, ip);
    if (!ctx) return null;
    return { ctx, conn, playerId: null, tokens: 15, at: this.o.now() };
  }

  message(hc: HubConn, raw: string): void {
    if (raw.length <= 600 && !raw.includes('"t":"in"') && !raw.includes('"t":"ping"')) {
      const msg = parse(raw);
      if (msg && typeof msg.t === 'string' && SOCIAL.has(msg.t)) {
        void this.social$(hc, msg).catch(() => this.send(hc, { t: 'soc_err', code: 'server' }));
        return;
      }
    } else if (raw.length > 600 && raw.includes('"t":"push_sub"')) {
      const msg = parse(raw);
      if (msg?.t === 'push_sub') void this.social$(hc, msg).catch(() => undefined);
      return;
    }
    this.mgr.message(hc.ctx, raw);
  }

  disconnect(hc: HubConn): void {
    this.mgr.disconnect(hc.ctx);
    const id = hc.playerId;
    if (!id) return;
    const set = this.online.get(id);
    set?.delete(hc);
    if (set && set.size === 0) {
      this.online.delete(id);
      void this.refreshFriends(id).catch(() => undefined);
    }
  }

  /** Drop live sockets of a player (admin delete/block). */
  kick(id: string): void {
    const set = this.online.get(id);
    if (!set) return;
    for (const hc of [...set]) {
      this.send(hc, { t: 'deleted' });
      hc.conn.close(4001, 'removed');
    }
  }

  async refresh(id: string): Promise<void> {
    const set = this.online.get(id);
    if (!set || set.size === 0) return;
    const view = await this.social.view(id, this.isOnline, (r) => this.mgr.roomByCode(r)?.phase === 'lobby');
    if (!view) return;
    for (const hc of set) this.send(hc, { t: 'me', me: view });
  }

  private async refreshFriends(id: string): Promise<void> {
    for (const f of await this.social.friendIds(id)) await this.refresh(f);
  }

  private send(hc: HubConn, msg: object): void {
    hc.conn.send(JSON.stringify(msg));
  }

  private err(hc: HubConn, code: string): void {
    this.send(hc, { t: 'soc_err', code });
  }

  private async attach(hc: HubConn, id: string): Promise<void> {
    if (hc.playerId && hc.playerId !== id) this.online.get(hc.playerId)?.delete(hc);
    hc.playerId = id;
    const first = !this.isOnline(id);
    let set = this.online.get(id);
    if (!set) this.online.set(id, (set = new Set()));
    set.add(hc);
    this.send(hc, { t: 'cfg', vapid: this.push.publicKey });
    await this.refresh(id);
    if (first) await this.refreshFriends(id);
  }

  private async afterChange(hc: HubConn, r: Result, other?: string): Promise<void> {
    if (!r.ok) return this.err(hc, r.error);
    if (hc.playerId) await this.refresh(hc.playerId);
    if (other) await this.refresh(other);
  }

  private async social$(hc: HubConn, m: Record<string, unknown>): Promise<void> {
    const now = this.o.now();
    hc.tokens = Math.min(15, hc.tokens + ((now - hc.at) / 1000) * 5);
    hc.at = now;
    if (hc.tokens < 1) return this.err(hc, 'rate_limited');
    hc.tokens -= 1;
    const s = this.social;

    if (m.t === 'reg') {
      if (hc.playerId) return this.err(hc, 'already_registered');
      const r = await s.register(m.name, hc.ctx.ip);
      if (!r.ok) return this.err(hc, r.error);
      this.send(hc, { t: 'reg_ok', token: r.token });
      return this.attach(hc, r.player.id);
    }
    if (m.t === 'auth') {
      const p = await s.authenticate(m.token);
      if (!p) return this.send(hc, { t: 'auth_fail' });
      return this.attach(hc, p.id);
    }
    const me = hc.playerId;
    if (!me) return this.err(hc, 'auth_required');
    const other = typeof m.id === 'string' && ID.test(m.id) ? m.id : null;

    switch (m.t) {
      case 'sync':
        return this.refresh(me);
      case 'rename': {
        const r = await s.rename(me, m.name);
        await this.afterChange(hc, r);
        if (r.ok) await this.refreshFriends(me);
        return;
      }
      case 'renew':
        await s.renewCode(me);
        return this.refresh(me);
      case 'delete_me': {
        const friends = await s.friendIds(me);
        await s.deleteMe(me);
        this.send(hc, { t: 'deleted' });
        this.online.get(me)?.delete(hc);
        hc.playerId = null;
        for (const f of friends) await this.refresh(f);
        return;
      }
      case 'fr_add': {
        const r = await s.addFriend(me, m.code, hc.ctx.ip);
        await this.afterChange(hc, r, r.ok ? r.other : undefined);
        return;
      }
      case 'fr_yes':
      case 'fr_no':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.respond(me, other, m.t === 'fr_yes'), other);
      case 'fr_del':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.remove(me, other), other);
      case 'fr_block':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.block(me, other), other);
      case 'fr_unblock':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.unblock(me, other), other);
      case 'team_set':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.proposeTeam(me, other, m.name), other);
      case 'team_yes':
      case 'team_no':
        if (!other) return this.err(hc, 'not_found');
        return this.afterChange(hc, await s.answerTeam(me, other, m.t === 'team_yes'), other);
      case 'invite_dismiss': {
        const id = str(m.id, 10);
        if (id) await s.dismissInvite(me, id);
        return this.refresh(me);
      }
      case 'push_sub': {
        const endpoint = str(m.endpoint, 700);
        const p256dh = str(m.p256dh, 200);
        const auth = str(m.auth, 100);
        if (!endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint)) return this.err(hc, 'bad_push');
        await s.saveSubscription(me, { endpoint, p256dh, auth });
        return this.send(hc, { t: 'push_ok' });
      }
      case 'push_unsub': {
        const endpoint = str(m.endpoint, 700);
        if (endpoint) await s.removeSubscription(me, endpoint);
        return;
      }
      case 'invite':
        return this.invite(hc, me, other, m.room);
    }
  }

  private async invite(hc: HubConn, me: string, to: string | null, room: unknown): Promise<void> {
    if (!to) return this.err(hc, 'not_found');
    const code = typeof room === 'string' && ROOM.test(room) ? room : null;
    const live = code ? this.mgr.roomByCode(code) : undefined;
    if (!code || !live || live.phase !== 'lobby' || hc.ctx.room?.code !== code) return this.err(hc, 'no_room');
    const r = await this.social.createInvite(me, to, code);
    if (!r.ok) return this.err(hc, r.error);
    const mine = await this.social.player(me);
    if (!mine) return;
    if (this.isOnline(to)) {
      for (const t of this.online.get(to) ?? []) this.send(t, { t: 'invite', id: r.id, from: me, name: mine.name, room: code });
      await this.refresh(to);
      return this.send(hc, { t: 'invite_sent', to, delivered: 'live' });
    }
    let sent = 0;
    for (const sub of await this.social.subscriptions(to)) {
      const res = await this.push.send(sub, { title: `${mine.name} is waiting`, body: 'Tap to join Dum & Dee', url: '/', tag: 'dd-invite' });
      if (res === 'ok') sent++;
      else if (res === 'gone') await this.social.dropEndpoint(sub.endpoint);
    }
    this.send(hc, { t: 'invite_sent', to, delivered: sent > 0 ? 'push' : 'none' });
  }
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
