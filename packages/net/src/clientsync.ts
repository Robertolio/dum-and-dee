import { createState, DEFAULT_TUNING, levelById, step, type GameState, type PlayerInput, type Tuning } from '@dd/sim';
import { fromWire, toWire, type EndMsg, type InputFrame, type Seat, type SnapMsg } from './protocol';

type Path = readonly [string, number | null, string];

/** Values shown on screen that are smoothed instead of jumping when a snapshot corrects the prediction. */
const SMOOTH: Array<{ path: Path; snap: number }> = [];
for (const i of [0, 1]) {
  for (const f of ['x', 'y', 'jumpY', 'yFloor']) SMOOTH.push({ path: ['players', i, f], snap: f === 'x' ? 1.5 : 1.0 });
}
for (const f of ['theta', 'kickX', 'kickY', 'lift']) SMOOTH.push({ path: ['ladder', null, f], snap: f === 'theta' ? 0.6 : 1.0 });
for (const f of ['phi', 'xP', 'yP']) SMOOTH.push({ path: ['bucket', null, f], snap: f === 'phi' ? 1.2 : 1.5 });

type Rec = Record<string, number>;
const rec = (s: GameState, p: Path): Rec => (p[1] === null ? ((s as unknown as Record<string, Rec>)[p[0]] as Rec) : (((s as unknown as Record<string, Rec[]>)[p[0]] as Rec[])[p[1]] as Rec));

export interface ClockSample {
  rtt: number;
  offset: number;
}

/**
 * Client-side prediction for one seat of a server-authoritative game.
 * - runs the shared sim ahead of the server by `lead` ticks, using the own input immediately and holding the partner's last known input;
 * - on every snapshot restarts from the server state and replays the own, not yet confirmed inputs (reconciliation);
 * - the on-screen state is the prediction plus decaying offsets, so corrections glide instead of jerking.
 */
export class ClientSync {
  pred!: GameState;
  ended: EndMsg | null = null;
  private readonly initial: GameState;
  private readonly tickMs: number;
  private readonly hist = new Map<number, PlayerInput>();
  private lastOwn: PlayerInput;
  private remote: PlayerInput;
  private anchor: { tick: number; ms: number } | null = null;
  private samples: ClockSample[] = [];
  private offset = 0;
  rtt = 100;
  jitter = 10;
  private readonly off = new Map<string, number>();
  private view!: GameState;
  private outQ: InputFrame[] = [];
  private seq = 0;
  /** Number of snapshots applied and total re-simulated ticks, for diagnostics. */
  stats = { snaps: 0, resim: 0, hardSnaps: 0 };

  constructor(readonly levelId: string, readonly seat: Seat, private readonly tuning: Tuning = DEFAULT_TUNING) {
    this.initial = createState(levelById(levelId).data, tuning);
    this.tickMs = 1000 * tuning.dt;
    this.lastOwn = { push: 0, hTarget: tuning.hUpright };
    this.remote = { push: 0, hTarget: tuning.hUpright };
  }

  private frozen = false;
  private needSnap = false;

  get ready(): boolean {
    return this.anchor !== null && this.pred !== undefined;
  }

  /** The server paused (partner gone): stop predicting until it resumes and sends a fresh snapshot. */
  pause(): void {
    this.frozen = true;
    this.needSnap = true;
  }

  resume(): void {
    this.frozen = false;
  }

  get running(): boolean {
    return this.ready && !this.frozen && !this.needSnap;
  }

  /** A pong came back: update the clock offset using the lowest-rtt recent samples. */
  onPong(clientSent: number, serverMs: number, clientNow: number): void {
    const rtt = Math.max(0, clientNow - clientSent);
    this.samples.push({ rtt, offset: serverMs + rtt / 2 - clientNow });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = this.samples.length === 1 ? best.offset : this.offset + (best.offset - this.offset) * 0.3;
    const mean = this.samples.reduce((a, b) => a + b.rtt, 0) / this.samples.length;
    this.rtt = this.rtt + (mean - this.rtt) * 0.3;
    const dev = this.samples.reduce((a, b) => a + Math.abs(b.rtt - mean), 0) / this.samples.length;
    this.jitter = this.jitter + (dev - this.jitter) * 0.3;
  }

  /** Start from an already measured clock (pings sent before the game began). */
  seedClock(offset: number, rtt: number): void {
    this.offset = offset;
    this.rtt = rtt;
    this.samples = [{ rtt, offset }];
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offset;
  }

  /** Ticks the prediction runs ahead of the server so inputs arrive before they are needed. */
  get lead(): number {
    return Math.max(2, Math.min(30, Math.ceil((this.rtt / 2 + 1.5 * this.jitter + 20) / this.tickMs)));
  }

  /** Where the server is now, in (fractional) ticks. */
  serverTick(clientNow: number): number {
    if (!this.anchor) return 0;
    return this.anchor.tick + (this.serverNow(clientNow) - this.anchor.ms) / this.tickMs;
  }

  targetTick(clientNow: number): number {
    return Math.floor(this.serverTick(clientNow)) + this.lead;
  }

  /** Apply a server snapshot: restart from it and replay the own inputs that are not confirmed yet. */
  onSnap(msg: SnapMsg): void {
    if (this.frozen) return;
    this.needSnap = false;
    this.anchor = { tick: msg.tick, ms: msg.ms };
    const st = this.unpack(msg);
    const other = (1 - this.seat) as Seat;
    this.remote = fromWire({ push: msg.inp[other][0], h: msg.inp[other][1], jump: msg.inp[other][2] === 1 ? 1 : 0 });
    const prev = this.pred ? this.compose(0) : null;
    const oldTick = this.pred ? this.pred.tick : st.tick;
    this.pred = st;
    for (let t = st.tick; t < oldTick && !st.gameOver && !st.finished; t++) {
      this.stepWith(st, t);
      this.stats.resim++;
    }
    this.stats.snaps++;
    for (const k of this.hist.keys()) if (k < st.tick - 2) this.hist.delete(k);
    if (prev) {
      for (const s of SMOOTH) {
        const key = s.path.join('.');
        const shown = rec(prev, s.path)[s.path[2]]!;
        const err = shown - rec(st, s.path)[s.path[2]]!;
        if (Math.abs(err) > s.snap) {
          this.off.set(key, 0);
          this.stats.hardSnaps++;
        } else this.off.set(key, err);
      }
    } else this.off.clear();
    this.view = this.compose(0);
  }

  private stepWith(s: GameState, tick: number): void {
    const own = this.hist.get(tick) ?? this.lastOwn;
    step(s, this.seat === 0 ? [own, this.remote] : [this.remote, own], this.tuning);
  }

  /** Step the prediction up to the target tick, sampling the own input per tick. Returns the number of steps made. */
  advance(clientNow: number, sample: (tick: number) => PlayerInput, onStep?: (s: GameState) => void): number {
    if (!this.running) return 0;
    const target = this.targetTick(clientNow);
    let n = 0;
    while (this.pred.tick < target && n < 10) {
      const tick = this.pred.tick;
      const own = sample(tick);
      this.hist.set(tick, own);
      this.lastOwn = own;
      this.outQ.push(toWire(tick, own));
      if (this.outQ.length > 24) this.outQ.shift();
      this.stepWith(this.pred, tick);
      onStep?.(this.pred);
      n++;
    }
    return n;
  }

  /** The newest few input frames (redundancy against lost packets) as a ready-to-send message. */
  takeInputMessage(): { t: 'in'; seq: number; f: InputFrame[] } | null {
    if (this.outQ.length === 0) return null;
    return { t: 'in', seq: this.seq++, f: this.outQ.slice(-5) };
  }

  /** State to draw: prediction plus smoothly decaying correction offsets. */
  getView(dtSec: number): GameState {
    const decay = Math.exp(-dtSec / 0.12);
    this.view = this.compose(decay, dtSec);
    return this.view;
  }

  private compose(decay: number, dtSec = 0): GameState {
    for (const [k, v] of this.off) this.off.set(k, Math.abs(v) < 1e-4 ? 0 : dtSec > 0 ? v * decay : v);
    const p = this.pred;
    const v: GameState = { ...p, players: [{ ...p.players[0] }, { ...p.players[1] }], ladder: { ...p.ladder }, bucket: { ...p.bucket } };
    for (const s of SMOOTH) {
      const o = this.off.get(s.path.join('.')) ?? 0;
      if (o !== 0) rec(v, s.path)[s.path[2]] = rec(v, s.path)[s.path[2]]! + o;
    }
    return v;
  }

  private unpack(msg: SnapMsg): GameState {
    const st = msg.st;
    if (st.levelLength == null) st.levelLength = Infinity;
    const hi = msg.hi;
    const ini = this.initial;
    st.steps = [...st.steps, ...ini.steps.filter((o) => o.x0 > hi)];
    st.lamps = [...st.lamps, ...ini.lamps.filter((o) => o.x > hi)];
    st.beams = [...st.beams, ...ini.beams.filter((o) => o.x0 > hi)];
    st.softs = [...st.softs, ...ini.softs.filter((o) => o.x > hi)];
    st.events = [];
    return st;
  }
}
