import { levelById, LEVELS } from '@dd/sim';
import { ServerGame, encode } from './game';
import {
  CODE_ALPHABET,
  CODE_LEN,
  MAX_MSG_BYTES,
  PROTO,
  RECONNECT_GRACE_MS,
  parseClientMsg,
  type ClientMsg,
  type CtlMode,
  type Phase,
  type Seat,
  type SeatInfo,
  type ServerMsg,
} from './protocol';

export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  now: () => number;
  /** Secure random bytes. */
  randomBytes: (n: number) => Uint8Array;
  maxRooms?: number;
  maxConns?: number;
  maxConnsPerIp?: number;
  /** Rooms with no traffic at all are dropped after this long. */
  idleMs?: number;
  graceMs?: number;
  countdownMs?: number;
  createsPerMinutePerIp?: number;
}

interface Member {
  seat: Seat;
  token: string;
  conn: ConnCtx | null;
  ctl: CtlMode;
  ready: boolean;
  lostAt: number | null;
}

interface Room {
  code: string;
  phase: Phase;
  level: string;
  host: Seat;
  members: [Member | null, Member | null];
  game: ServerGame | null;
  countAt: number;
  pauseUntil: number;
  lastActive: number;
}

class Bucket {
  private tokens: number;
  private at: number;
  constructor(private readonly rate: number, private readonly burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface ConnCtx {
  id: number;
  ip: string;
  conn: Conn;
  room: Room | null;
  member: Member | null;
  inBucket: Bucket;
  ctlBucket: Bucket;
  strikes: number;
  closed: boolean;
}

const VALID_LEVELS = new Set(LEVELS.map((l) => l.id));

/** Transport-independent room logic: lobby, countdown, play, pause/reconnect, closing. Driven by messages and tick(). */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Set<ConnCtx>();
  private nextId = 1;
  private readonly createLog = new Map<string, number[]>();
  private readonly o: Required<RoomOptions>;

  constructor(opts: RoomOptions) {
    this.o = {
      maxRooms: 200,
      maxConns: 600,
      maxConnsPerIp: 16,
      idleMs: 10 * 60_000,
      graceMs: RECONNECT_GRACE_MS,
      countdownMs: 3000,
      createsPerMinutePerIp: 12,
      ...opts,
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }
  get connCount(): number {
    return this.conns.size;
  }
  roomByCode(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Register a new socket. Returns null (after closing it) when over a limit. */
  connect(conn: Conn, ip = 'unknown'): ConnCtx | null {
    const now = this.o.now();
    let perIp = 0;
    for (const c of this.conns) if (c.ip === ip) perIp++;
    if (this.conns.size >= this.o.maxConns || perIp >= this.o.maxConnsPerIp) {
      conn.close(1013, 'busy');
      return null;
    }
    const ctx: ConnCtx = {
      id: this.nextId++,
      ip,
      conn,
      room: null,
      member: null,
      inBucket: new Bucket(150, 300, now),
      ctlBucket: new Bucket(8, 20, now),
      strikes: 0,
      closed: false,
    };
    this.conns.add(ctx);
    this.send(ctx, { t: 'hello', v: PROTO, ms: now });
    return ctx;
  }

  message(ctx: ConnCtx, raw: string): void {
    if (ctx.closed) return;
    const now = this.o.now();
    if (raw.length > MAX_MSG_BYTES) return this.strike(ctx, true);
    const msg = parseClientMsg(raw);
    if (!msg) return this.strike(ctx, false);
    const bucket = msg.t === 'in' || msg.t === 'ping' ? ctx.inBucket : ctx.ctlBucket;
    if (!bucket.take(now)) return this.strike(ctx, false);
    if (ctx.room) ctx.room.lastActive = now;
    this.handle(ctx, msg, now);
  }

  disconnect(ctx: ConnCtx): void {
    if (ctx.closed) return;
    ctx.closed = true;
    this.conns.delete(ctx);
    const room = ctx.room;
    const m = ctx.member;
    if (!room || !m || m.conn !== ctx) return;
    m.conn = null;
    m.lostAt = this.o.now();
    m.ready = false;
    if (room.phase === 'play') this.pause(room);
    else if (room.phase === 'countdown') this.toLobby(room);
    this.broadcastRoom(room);
  }

  /** Advance games, expire rooms. Call every few ms. */
  tick(): void {
    const now = this.o.now();
    for (const room of [...this.rooms.values()]) {
      if (room.phase === 'countdown' && now >= room.countAt) this.begin(room, now);
      if (room.phase === 'play' && room.game) {
        const { snaps, ended } = room.game.advance(now);
        if (snaps.length > 0) for (const sn of snaps) this.broadcast(room, encode(sn));
        if (ended) this.finish(room);
      }
      if (room.phase === 'paused' && now >= room.pauseUntil) this.close(room, 'timeout');
      else if (room.phase === 'lobby') {
        for (const m of room.members) if (m && !m.conn && m.lostAt !== null && now - m.lostAt > this.o.graceMs) this.dropMember(room, m);
        if (room.members.every((m) => m === null)) this.close(room, 'idle');
      }
      if (now - room.lastActive > this.o.idleMs) this.close(room, 'idle');
    }
    for (const [ip, log] of this.createLog) {
      const fresh = log.filter((t) => now - t < 60_000);
      if (fresh.length === 0) this.createLog.delete(ip);
      else this.createLog.set(ip, fresh);
    }
  }

  // ---- handlers ----

  private handle(ctx: ConnCtx, msg: ClientMsg, now: number): void {
    switch (msg.t) {
      case 'ping':
        this.send(ctx, { t: 'pong', c: msg.c, s: now });
        return;
      case 'create':
        return this.create(ctx, now);
      case 'join':
        return this.join(ctx, msg.room, msg.token, now);
      case 'leave':
        return this.leave(ctx);
    }
    const room = ctx.room;
    const me = ctx.member;
    if (!room || !me) return this.sendErr(ctx, 'no_room');
    switch (msg.t) {
      case 'in':
        if (room.phase === 'play' && room.game) room.game.submit(me.seat, msg.f);
        return;
      case 'seat': {
        if (room.phase !== 'lobby') return this.sendErr(ctx, 'not_lobby');
        if (msg.seat === me.seat) return;
        if (room.members[msg.seat]) return this.sendErr(ctx, 'seat_taken');
        room.members[me.seat] = null;
        room.members[msg.seat] = me;
        if (room.host === me.seat) room.host = msg.seat;
        me.seat = msg.seat;
        me.ready = false;
        for (const m of room.members) if (m) m.ready = false;
        this.sendJoined(ctx, room, me);
        return this.broadcastRoom(room);
      }
      case 'ctl':
        me.ctl = msg.mode;
        return this.broadcastRoom(room);
      case 'level':
        if (room.phase !== 'lobby') return this.sendErr(ctx, 'not_lobby');
        if (me.seat !== room.host) return this.sendErr(ctx, 'not_host');
        if (!VALID_LEVELS.has(msg.id)) return this.sendErr(ctx, 'bad_level');
        room.level = msg.id;
        for (const m of room.members) if (m) m.ready = false;
        return this.broadcastRoom(room);
      case 'ready': {
        if (room.phase !== 'lobby' && room.phase !== 'countdown') return;
        me.ready = msg.ready;
        if (room.phase === 'countdown' && !msg.ready) this.toLobby(room);
        else if (room.phase === 'lobby') this.maybeCountdown(room, now);
        return this.broadcastRoom(room);
      }
    }
  }

  private create(ctx: ConnCtx, now: number): void {
    if (ctx.room) return this.sendErr(ctx, 'already_in_room');
    if (this.rooms.size >= this.o.maxRooms) return this.sendErr(ctx, 'server_full');
    const log = this.createLog.get(ctx.ip) ?? [];
    if (log.filter((t) => now - t < 60_000).length >= this.o.createsPerMinutePerIp) return this.sendErr(ctx, 'rate_limited');
    log.push(now);
    this.createLog.set(ctx.ip, log);
    let code = '';
    for (let tries = 0; tries < 20; tries++) {
      code = this.makeCode();
      if (!this.rooms.has(code)) break;
      code = '';
    }
    if (!code) return this.sendErr(ctx, 'server_full');
    const room: Room = { code, phase: 'lobby', level: 'f0', host: 0, members: [null, null], game: null, countAt: 0, pauseUntil: 0, lastActive: now };
    this.rooms.set(code, room);
    const me = this.seatIn(room, 0, ctx);
    this.sendJoined(ctx, room, me);
    this.broadcastRoom(room);
  }

  private join(ctx: ConnCtx, code: string, token: string | undefined, now: number): void {
    if (ctx.room) return this.sendErr(ctx, 'already_in_room');
    const room = this.rooms.get(code);
    if (!room) return this.sendErr(ctx, 'no_such_room');
    // Reconnect with the token of a member who lost its connection.
    const mine = token ? room.members.find((m) => m && m.token === token) : undefined;
    if (mine) {
      const old = mine.conn;
      if (old) {
        old.room = null;
        old.member = null;
        old.conn.close(4000, 'replaced');
      }
      mine.conn = ctx;
      mine.lostAt = null;
      ctx.room = room;
      ctx.member = mine;
      this.sendJoined(ctx, room, mine);
      room.lastActive = now;
      if (room.phase === 'paused' && room.members.every((m) => m?.conn)) this.resume(room, now);
      this.broadcastRoom(room);
      return;
    }
    if (room.phase !== 'lobby') return this.sendErr(ctx, 'in_progress');
    const free = room.members[0] ? (room.members[1] ? null : 1) : 0;
    if (free === null) return this.sendErr(ctx, 'room_full');
    const me = this.seatIn(room, free, ctx);
    this.sendJoined(ctx, room, me);
    this.broadcastRoom(room);
  }

  private leave(ctx: ConnCtx): void {
    const room = ctx.room;
    const me = ctx.member;
    if (!room || !me) return;
    ctx.room = null;
    ctx.member = null;
    me.conn = null;
    if (room.phase === 'lobby' && room.host !== me.seat) {
      room.members[me.seat] = null;
      for (const m of room.members) if (m) m.ready = false;
      this.broadcastRoom(room);
    } else this.close(room, 'partner_left');
  }

  // ---- state changes ----

  private seatIn(room: Room, seat: Seat, ctx: ConnCtx): Member {
    const m: Member = { seat, token: this.hex(16), conn: ctx, ctl: 'analog', ready: false, lostAt: null };
    room.members[seat] = m;
    ctx.room = room;
    ctx.member = m;
    return m;
  }

  private maybeCountdown(room: Room, now: number): void {
    const [a, b] = room.members;
    if (a && b && a.ready && b.ready && a.conn && b.conn) {
      room.phase = 'countdown';
      room.countAt = now + this.o.countdownMs;
      this.broadcast(room, encode({ t: 'count', at: room.countAt } satisfies ServerMsg));
    }
  }

  private begin(room: Room, now: number): void {
    room.phase = 'play';
    room.game = new ServerGame(room.level, now);
    this.broadcast(room, encode({ t: 'start', level: room.level, at: now } satisfies ServerMsg));
    this.broadcastRoom(room);
  }

  private finish(room: Room): void {
    const g = room.game;
    if (!g) return;
    const s = g.state;
    this.broadcast(room, encode({ t: 'end', kind: s.finished ? 'complete' : 'gameover', result: s.result, score: Math.floor(s.score), distance: s.distance } satisfies ServerMsg));
    this.toLobby(room);
    this.broadcastRoom(room);
  }

  private toLobby(room: Room): void {
    room.phase = 'lobby';
    room.game = null;
    for (const m of room.members) if (m) m.ready = false;
  }

  private pause(room: Room): void {
    room.phase = 'paused';
    room.pauseUntil = this.o.now() + this.o.graceMs;
    room.game?.setRunning(false, this.o.now());
    this.broadcast(room, encode({ t: 'pause', until: room.pauseUntil } satisfies ServerMsg));
  }

  private resume(room: Room, now: number): void {
    room.phase = 'play';
    room.game?.setRunning(true, now);
    this.broadcast(room, encode({ t: 'resume' } satisfies ServerMsg));
  }

  private dropMember(room: Room, m: Member): void {
    room.members[m.seat] = null;
    if (room.host === m.seat) {
      this.close(room, 'partner_left');
      return;
    }
    this.broadcastRoom(room);
  }

  private close(room: Room, reason: 'partner_left' | 'timeout' | 'idle' | 'server'): void {
    if (!this.rooms.delete(room.code)) return;
    const msg = encode({ t: 'closed', reason } satisfies ServerMsg);
    for (const m of room.members) {
      if (m?.conn) {
        m.conn.conn.send(msg);
        m.conn.room = null;
        m.conn.member = null;
      }
    }
  }

  // ---- output ----

  private info(m: Member | null): SeatInfo | null {
    return m ? { ctl: m.ctl, ready: m.ready, connected: !!m.conn } : null;
  }

  private sendJoined(ctx: ConnCtx, room: Room, me: Member): void {
    this.send(ctx, { t: 'joined', room: room.code, token: me.token, seat: me.seat, host: room.host });
  }

  private broadcastRoom(room: Room): void {
    for (const m of room.members) {
      if (!m?.conn) continue;
      const msg: ServerMsg = {
        t: 'room',
        room: room.code,
        phase: room.phase,
        level: room.level,
        host: room.host,
        you: m.seat,
        seats: [this.info(room.members[0]), this.info(room.members[1])],
        ...(room.phase === 'paused' ? { pauseUntil: room.pauseUntil } : {}),
      };
      this.send(m.conn, msg);
    }
  }

  private broadcast(room: Room, data: string): void {
    for (const m of room.members) if (m?.conn) m.conn.conn.send(data);
  }

  private send(ctx: ConnCtx, msg: ServerMsg): void {
    try {
      ctx.conn.send(encode(msg));
    } catch {
      /* socket already gone */
    }
  }

  private sendErr(ctx: ConnCtx, code: string): void {
    this.send(ctx, { t: 'err', code });
  }

  private strike(ctx: ConnCtx, hard: boolean): void {
    ctx.strikes += hard ? 5 : 1;
    if (ctx.strikes >= 20) ctx.conn.close(1008, 'policy');
  }

  private hex(n: number): string {
    return [...this.o.randomBytes(n)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private makeCode(): string {
    let s = '';
    while (s.length < CODE_LEN) {
      // Rejection sampling: 31 symbols, so values >= 248 would bias the choice.
      for (const b of this.o.randomBytes(CODE_LEN * 2)) {
        if (b < 248 && s.length < CODE_LEN) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
      }
    }
    return s;
  }
}

export { levelById };
