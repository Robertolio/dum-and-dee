import { randomBytes } from 'node:crypto';
import type { GameState, PlayerInput } from '@dd/sim';
import { ClientSync } from './clientsync';
import { encode } from './game';
import { RoomManager, type ConnCtx } from './rooms';
import type { ServerMsg } from './protocol';

export interface LinkOpts {
  /** One-way latency (ms). */
  latency: number;
  jitter: number;
  loss: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pkt {
  at: number;
  fn: () => void;
}

/** A deterministic virtual-time harness: one server (RoomManager) and two predicted clients over lossy, delayed links. */
export class NetSim {
  now = 1000;
  readonly mgr: RoomManager;
  readonly clients: SimClient[] = [];
  private q: Pkt[] = [];
  readonly rand: () => number;
  /** Server state per tick, for comparisons. */
  readonly serverHistory = new Map<number, { x: [number, number]; theta: number; phi: number; score: number; lives: number }>();
  code = '';

  constructor(readonly link: LinkOpts, seed = 1) {
    this.rand = rng(seed);
    this.mgr = new RoomManager({ now: () => this.now, randomBytes: (n) => randomBytes(n), countdownMs: 3000 });
  }

  schedule(delay: number, fn: () => void): void {
    this.q.push({ at: this.now + delay, fn });
  }

  /** Send over a link: loss and jittered delay, order may change (as on a real network). */
  transmit(fn: () => void): void {
    if (this.rand() < this.link.loss) return;
    const d = Math.max(1, this.link.latency + (this.rand() * 2 - 1) * this.link.jitter);
    this.schedule(d, fn);
  }

  addClient(inputFn: (tick: number, seat: 0 | 1) => PlayerInput): SimClient {
    const c = new SimClient(this, inputFn);
    this.clients.push(c);
    return c;
  }

  /** Advance virtual time in 1 ms steps; clients run at 60 fps, the server loop every 4 ms. */
  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 1;
      this.q.sort((a, b) => a.at - b.at);
      while (this.q.length > 0 && this.q[0]!.at <= this.now) this.q.shift()!.fn();
      if (this.now % 4 === 0) {
        this.mgr.tick();
        const room = this.mgr.roomByCode(this.code);
        const g = (room as unknown as { game: { state: GameState } | null } | undefined)?.game;
        if (g) {
          const s = g.state;
          this.serverHistory.set(s.tick, { x: [s.players[0].x, s.players[1].x], theta: s.ladder.theta, phi: s.bucket.phi, score: s.score, lives: s.lives });
        }
      }
      for (const c of this.clients) c.frame();
    }
  }
}

export class SimClient {
  ctx: ConnCtx | null = null;
  sync: ClientSync | null = null;
  seat: 0 | 1 = 0;
  token = '';
  online = true;
  msgs: ServerMsg[] = [];
  readonly seen = new Set<string>();
  /** error samples: prediction at tick k vs the server's state at tick k */
  readonly errX: number[] = [];
  readonly errTheta: number[] = [];
  readonly predAt = new Map<number, { x: [number, number]; theta: number }>();
  private lastFrame = 0;
  private lastPing = 0;
  private lastSend = 0;
  private level = '';

  constructor(private readonly net: NetSim, private readonly inputFn: (tick: number, seat: 0 | 1) => PlayerInput) {
    this.ctx = net.mgr.connect({ send: (d) => this.fromServer(d), close: () => void 0 }, `10.0.0.${net.clients.length + 1}`);
  }

  private fromServer(data: string): void {
    if (!this.online) return;
    this.net.transmit(() => {
      if (this.online) this.receive(JSON.parse(data) as ServerMsg);
    });
  }

  send(msg: unknown): void {
    const ctx = this.ctx;
    if (!ctx || !this.online) return;
    const raw = encode(msg);
    this.net.transmit(() => this.net.mgr.message(ctx, raw));
  }

  private receive(m: ServerMsg): void {
    this.seen.add(m.t);
    this.msgs.push(m);
    if (this.msgs.length > 50) this.msgs.shift();
    switch (m.t) {
      case 'joined':
        this.seat = m.seat;
        this.token = m.token;
        this.net.code = m.room;
        break;
      case 'room':
        this.level = m.level;
        this.seat = m.you;
        break;
      case 'start':
        this.level = m.level;
        this.sync = new ClientSync(m.level, this.seat);
        break;
      case 'snap':
        if (!this.sync) this.sync = new ClientSync(this.level, this.seat);
        this.sync.onSnap(m);
        break;
      case 'pause':
        this.sync?.pause();
        break;
      case 'resume':
        this.sync?.resume();
        break;
      case 'pong':
        this.sync?.onPong(m.c, m.s, this.net.now);
        break;
    }
  }

  frame(): void {
    const now = this.net.now;
    if (now - this.lastPing >= 500) {
      this.lastPing = now;
      this.send({ t: 'ping', c: now });
    }
    if (now - this.lastFrame < 16.6) return;
    this.lastFrame = now;
    const sync = this.sync;
    if (!sync) return;
    if (sync.running) {
      sync.advance(now, (tick) => this.inputFn(tick, this.seat));
      const p = sync.pred;
      this.predAt.set(p.tick, { x: [p.players[0].x, p.players[1].x], theta: p.ladder.theta });
      if (this.predAt.size > 2400) this.predAt.delete(this.predAt.keys().next().value as number);
      const m = sync.takeInputMessage();
      if (m && now - this.lastSend >= 16) {
        this.lastSend = now;
        this.send(m);
      }
    }
  }
}

/** Create a room with two clients, ready both and run until the game starts. */
export function startGame(net: NetSim, level: string): [SimClient, SimClient] {
  const a = net.addClient((t) => scriptedInput(t, 0));
  const b = net.addClient((t) => scriptedInput(t, 1));
  a.send({ t: 'create', v: 1 });
  net.run(600);
  b.send({ t: 'join', room: net.code });
  net.run(600);
  a.send({ t: 'level', id: level });
  net.run(400);
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  net.run(3600);
  return [a, b];
}

/** Deterministic "player": walks, speeds up and slows down, bends, jumps now and then. */
export function scriptedInput(tick: number, seat: 0 | 1): PlayerInput {
  const sec = tick / 60;
  const ph = seat === 0 ? 0 : 1.3;
  const push = 0.6 + 0.35 * Math.sin((sec + ph) * 0.9);
  const hTarget = 0.8 - 0.35 * Math.max(0, Math.sin((sec + ph) * 0.5));
  const jump = Math.floor((sec + ph * 2) * 4) % 23 === 0 && Math.floor(sec * 60) % 4 === 0;
  return { push, hTarget, jump };
}
