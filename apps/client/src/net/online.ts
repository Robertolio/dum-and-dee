import { loadIdentity } from '../social/identity';
import {
  ClientSync,
  type CtlMode,
  type EndMsg,
  type Seat,
  type SeatInfo,
  type ServerMsg,
} from '@dd/net';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'lost';
export interface RoomView {
  code: string;
  phase: 'lobby' | 'countdown' | 'play' | 'paused';
  level: string;
  host: Seat;
  you: Seat;
  seats: [SeatInfo | null, SeatInfo | null];
}

export type OnlineEvent =
  | { type: 'status'; status: NetStatus }
  | { type: 'room'; room: RoomView }
  | { type: 'count'; at: number }
  | { type: 'start'; level: string; sync: ClientSync }
  | { type: 'end'; end: EndMsg }
  | { type: 'pause'; until: number }
  | { type: 'resume' }
  | { type: 'closed'; reason: string }
  | { type: 'error'; code: string }
  | { type: 'invite_sent'; delivered: 'live' | 'push' | 'none' };

const SESSION_KEY = 'dd-online';
const GIVE_UP_MS = 70_000;

export function wsUrl(): string {
  const o = new URLSearchParams(location.search).get('ws');
  if (o) return o;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** One online session: WebSocket with automatic reconnect (token), clock sync and the prediction layer. */
export class OnlineClient {
  status: NetStatus = 'idle';
  room: RoomView | null = null;
  sync: ClientSync | null = null;
  seat: Seat = 0;
  token = '';
  code = '';
  pingMs = 0;
  /** Offset to the server clock (ms), from the best ping sample. */
  offset = 0;
  private ws: WebSocket | null = null;
  private listeners = new Set<(e: OnlineEvent) => void>();
  private pings: Array<{ rtt: number; offset: number }> = [];
  private lostSince = 0;
  private retry = 0;
  private timer = 0;
  private pingTimer = 0;
  private sendTimer = 0;
  private intentional = false;
  private pendingJoin: { room: string; token?: string } | null = null;
  private pendingCreate = false;
  private lastPong = 0;
  private level = 'f0';
  private lastRoomPhase: RoomView['phase'] = 'lobby';

  on(fn: (e: OnlineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: OnlineEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit({ type: 'status', status: s });
  }

  static savedSession(): { room: string; token: string } | null {
    try {
      const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { room?: string; token?: string } | null;
      return v?.room && v.token ? { room: v.room, token: v.token } : null;
    } catch {
      return null;
    }
  }
  private save(): void {
    try {
      if (this.code && this.token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ room: this.code, token: this.token }));
    } catch {
      /* private mode */
    }
  }
  static clearSession(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  create(): void {
    this.reset();
    this.pendingCreate = true;
    this.open();
  }

  join(code: string, token?: string): void {
    this.reset();
    this.pendingJoin = { room: code.toUpperCase(), token };
    this.code = code.toUpperCase();
    this.open();
  }

  /** Leave on purpose: tells the server and forgets the session. */
  leave(): void {
    this.intentional = true;
    this.sendMsg({ t: 'leave' });
    this.shutdown();
  }

  private shutdown(): void {
    OnlineClient.clearSession();
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    clearInterval(this.sendTimer);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.sync = null;
    this.room = null;
    this.setStatus('idle');
  }

  private reset(): void {
    this.intentional = false;
    this.pendingJoin = null;
    this.pendingCreate = false;
    this.room = null;
    this.sync = null;
    this.pings = [];
    this.retry = 0;
    this.lostSince = 0;
    this.code = '';
    this.token = '';
    clearTimeout(this.timer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private open(): void {
    this.setStatus(this.lostSince ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      const id = loadIdentity();
      if (id) this.sendMsg({ t: 'auth', token: id.token });
      if (this.pendingCreate) {
        this.pendingCreate = false;
        this.sendMsg({ t: 'create', v: 1 });
      } else if (this.pendingJoin) {
        this.sendMsg({ t: 'join', room: this.pendingJoin.room, token: this.pendingJoin.token || undefined, v: 1 });
      }
      this.startTimers();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ServerMsg | { t: 'invite_sent'; delivered: 'live' | 'push' | 'none' };
        if (msg.t === 'invite_sent') this.emit({ type: 'invite_sent', delivered: msg.delivered });
        else this.onMessage(msg as ServerMsg);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      clearInterval(this.sendTimer);
      if (this.intentional) return;
      this.onDropped();
    };
    ws.onerror = () => undefined;
  }

  private onDropped(): void {
    if (!this.code || !this.token) {
      // Never got into a room: surface a connection error.
      if (this.pendingJoin || this.pendingCreate || this.status === 'connecting') {
        this.setStatus('lost');
        this.emit({ type: 'error', code: 'connect_failed' });
      }
      return;
    }
    if (!this.lostSince) this.lostSince = performance.now();
    this.sync?.pause();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (performance.now() - this.lostSince > GIVE_UP_MS) {
      this.setStatus('lost');
      OnlineClient.clearSession();
      this.emit({ type: 'closed', reason: 'connection_lost' });
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(3000, 300 * 2 ** Math.min(this.retry++, 4));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.pendingJoin = { room: this.code, token: this.token };
      this.open();
    }, delay);
  }

  /** The page came back (iOS unlock, tab switch): check the socket right away instead of waiting for a timeout. */
  wake(): void {
    if (this.intentional || this.status === 'idle' || !this.code) return;
    const ws = this.ws;
    if (!ws || ws.readyState > 1) {
      clearTimeout(this.timer);
      if (!this.lostSince) this.lostSince = performance.now();
      this.pendingJoin = { room: this.code, token: this.token };
      this.open();
      return;
    }
    const before = this.lastPong;
    this.sendMsg({ t: 'ping', c: performance.now() });
    window.setTimeout(() => {
      if (this.ws === ws && this.lastPong === before && !this.intentional) ws.close();
    }, 2500);
  }

  private startTimers(): void {
    clearInterval(this.pingTimer);
    clearInterval(this.sendTimer);
    this.pingTimer = window.setInterval(() => this.sendMsg({ t: 'ping', c: performance.now() }), 1000);
    this.sendTimer = window.setInterval(() => {
      const m = this.sync?.takeInputMessage();
      if (m && this.sync?.running) this.sendMsg(m);
    }, 16);
    this.sendMsg({ t: 'ping', c: performance.now() });
  }

  sendMsg(m: object): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  /** Tell a friend which room is waiting for them (the room must be ours). */
  invite(friendId: string): void {
    this.sendMsg({ t: 'invite', id: friendId, room: this.code });
  }

  setSeat(seat: Seat): void {
    this.sendMsg({ t: 'seat', seat });
  }
  setCtl(mode: CtlMode): void {
    this.sendMsg({ t: 'ctl', mode });
  }
  setReady(ready: boolean): void {
    this.sendMsg({ t: 'ready', ready });
  }
  setLevel(id: string): void {
    this.sendMsg({ t: 'level', id });
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'joined':
        this.code = m.room;
        this.token = m.token;
        this.seat = m.seat;
        this.lostSince = 0;
        this.pendingJoin = null;
        this.sync?.resume();
        this.save();
        break;
      case 'room': {
        this.level = m.level;
        this.seat = m.you;
        this.room = { code: m.room, phase: m.phase, level: m.level, host: m.host, you: m.you, seats: m.seats };
        this.lastRoomPhase = m.phase;
        if (m.phase === 'lobby' && this.sync) this.sync = null;
        if (m.phase === 'play' && !this.sync) this.ensureSync();
        this.emit({ type: 'room', room: this.room });
        break;
      }
      case 'count':
        this.emit({ type: 'count', at: m.at });
        break;
      case 'start':
        this.sync = new ClientSync(m.level, this.seat);
        this.replayPongs();
        this.emit({ type: 'start', level: m.level, sync: this.sync });
        break;
      case 'snap':
        if (!this.sync) this.ensureSync();
        this.sync?.onSnap(m);
        break;
      case 'end':
        this.sync = null;
        this.emit({ type: 'end', end: m });
        break;
      case 'pause':
        this.sync?.pause();
        this.emit({ type: 'pause', until: m.until });
        break;
      case 'resume':
        this.sync?.resume();
        this.emit({ type: 'resume' });
        break;
      case 'pong': {
        const now = performance.now();
        this.lastPong = now;
        const rtt = Math.max(0, now - m.c);
        this.pingMs = Math.round(rtt);
        this.pings.push({ rtt, offset: m.s + rtt / 2 - now });
        if (this.pings.length > 12) this.pings.shift();
        this.offset = this.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
        this.sync?.onPong(m.c, m.s, now);
        break;
      }
      case 'closed':
        this.intentional = true;
        this.shutdown();
        this.emit({ type: 'closed', reason: m.reason });
        break;
      case 'err':
        if (m.code === 'no_such_room' || m.code === 'in_progress' || m.code === 'room_full') OnlineClient.clearSession();
        this.emit({ type: 'error', code: m.code });
        break;
      case 'hello':
        break;
    }
  }

  /** Reconnected in the middle of a game: there was no 'start', so build the prediction from the first snapshot. */
  private ensureSync(): void {
    if (this.sync || this.lastRoomPhase === 'lobby') return;
    this.sync = new ClientSync(this.level, this.seat);
    this.replayPongs();
    this.emit({ type: 'start', level: this.level, sync: this.sync });
  }

  private replayPongs(): void {
    if (!this.sync || this.pings.length === 0) return;
    const best = this.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.sync.seedClock(best.offset, best.rtt);
  }
}
