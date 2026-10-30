import { cloneState, createState, DEFAULT_TUNING, levelById, step, type GameState, type PlayerInput, type Tuning } from '@dd/sim';
import { fromWire, SIM_HZ, SNAP_EVERY, type InputFrame, type Seat, type SnapMsg } from './protocol';

const NEUTRAL: PlayerInput = { push: 0, hTarget: DEFAULT_TUNING.hUpright };
const MAX_AHEAD = 120;
const MAX_BUFFER = 400;
/** Obstacles this far behind the pair are left out of snapshots; this far ahead the client's own level data is used. */
export const WINDOW_BACK = 16;
export const WINDOW_AHEAD = 90;

/** The authoritative simulation of one room: fixed 60 Hz steps, inputs taken from per-seat tick buffers. */
export class ServerGame {
  state: GameState;
  private readonly buf: [Map<number, InputFrame>, Map<number, InputFrame>] = [new Map(), new Map()];
  private readonly last: [PlayerInput, PlayerInput] = [NEUTRAL, NEUTRAL];
  private lastWire: [[number, number, number], [number, number, number]] = [
    [0, NEUTRAL.hTarget, 0],
    [0, NEUTRAL.hTarget, 0],
  ];
  private readonly lastTick: [number, number] = [-1, -1];
  private anchorMs = 0;
  private anchorTick = 0;
  private running = true;
  /** Seconds-per-tick in ms. */
  readonly tickMs: number;

  constructor(readonly levelId: string, startMs: number, readonly tuning: Tuning = DEFAULT_TUNING) {
    this.state = createState(levelById(levelId).data, tuning);
    this.tickMs = (1000 * tuning.dt) as number;
    this.anchorMs = startMs;
    void SIM_HZ;
  }

  /** Accept input frames from a seat: stored by their target tick, bounded in the future and in total. */
  submit(seat: Seat, frames: InputFrame[]): void {
    const b = this.buf[seat];
    for (const f of frames) {
      if (f.tick > this.state.tick + MAX_AHEAD) continue;
      if (f.tick < this.state.tick) {
        // Too late to use directly: it still becomes the hold value if it is the newest we know.
        if (f.tick > this.lastTick[seat]) this.hold(seat, f);
        continue;
      }
      b.set(f.tick, f);
    }
    if (b.size > MAX_BUFFER) {
      const keys = [...b.keys()].sort((x, y) => x - y);
      for (let i = 0; i < keys.length - MAX_BUFFER; i++) b.delete(keys[i]!);
    }
  }

  setRunning(running: boolean, nowMs: number): void {
    if (running === this.running) return;
    this.running = running;
    if (running) {
      this.anchorMs = nowMs;
      this.anchorTick = this.state.tick;
    }
  }

  /** The tick the clock says we should be at (without the pause adjustments applied twice). */
  dueTick(nowMs: number): number {
    return this.anchorTick + Math.floor((nowMs - this.anchorMs) / this.tickMs);
  }

  clock(): { tick: number; ms: number } {
    return { tick: this.anchorTick, ms: this.anchorMs };
  }

  /** Step to the current time; returns snapshots produced on the way (20 Hz) and whether the game ended. */
  advance(nowMs: number): { snaps: SnapMsg[]; ended: boolean } {
    const snaps: SnapMsg[] = [];
    if (!this.running) return { snaps, ended: false };
    let due = this.dueTick(nowMs);
    // After a long stall do not fast-forward the game: re-anchor instead.
    if (due - this.state.tick > 30) {
      this.anchorMs = nowMs;
      this.anchorTick = this.state.tick;
      due = this.state.tick;
    }
    while (this.state.tick < due && !this.state.gameOver && !this.state.finished) {
      this.stepOnce();
      if (this.state.tick % SNAP_EVERY === 0) snaps.push(this.snapshot(this.anchorMs + (this.state.tick - this.anchorTick) * this.tickMs));
    }
    const ended = this.state.gameOver || this.state.finished;
    if (ended) snaps.push(this.snapshot(nowMs));
    return { snaps, ended };
  }

  private hold(seat: Seat, f: InputFrame): void {
    this.last[seat] = fromWire(f);
    this.lastWire[seat] = [f.push, f.h, f.jump];
    this.lastTick[seat] = Math.max(this.lastTick[seat], f.tick);
  }

  private stepOnce(): void {
    const t = this.state.tick;
    const ins: [PlayerInput, PlayerInput] = [this.last[0], this.last[1]];
    for (const seat of [0, 1] as const) {
      const f = this.buf[seat].get(t);
      if (f) {
        ins[seat] = fromWire(f);
        this.hold(seat, f);
      }
      this.buf[seat].delete(t);
    }
    // Old, never-used frames are dropped so the maps stay small.
    for (const seat of [0, 1] as const) {
      if (this.buf[seat].size > 0 && t % 60 === 0) for (const k of this.buf[seat].keys()) if (k < t) this.buf[seat].delete(k);
    }
    step(this.state, ins, this.tuning);
  }

  snapshot(ms: number): SnapMsg {
    return packSnapshot(this.state, this.lastWire, ms);
  }
}

/** Snapshot of the state with the far-behind obstacles dropped. Scripted far-ahead ones are restored client-side. */
export function packSnapshot(s: GameState, inp: SnapMsg['inp'], ms: number): SnapMsg {
  const mid = (s.players[0].x + s.players[1].x) / 2;
  const lo = mid - WINDOW_BACK;
  const hi = mid + WINDOW_AHEAD;
  const st: GameState = {
    ...s,
    events: [],
    steps: s.steps.filter((o) => o.x1 >= lo && o.x0 <= hi),
    lamps: s.lamps.filter((o) => o.x >= lo && o.x <= hi),
    beams: s.beams.filter((o) => o.x1 >= lo && o.x0 <= hi),
    softs: s.softs.filter((o) => o.x >= lo && o.x <= hi),
  };
  return { t: 'snap', tick: s.tick, ms, inp: [[...inp[0]], [...inp[1]]], hi, st };
}

/** JSON with numbers rounded to 1e-4: keeps snapshots small. */
export function encode(msg: unknown): string {
  return JSON.stringify(msg, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v));
}

export { cloneState };
