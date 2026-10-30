import type { GameState, LevelResult, PlayerInput } from '@dd/sim';

export const PROTO = 1;
export type Seat = 0 | 1;
export type CtlMode = 'analog' | 'digital';
export type Phase = 'lobby' | 'countdown' | 'play' | 'paused';

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LEN = 6;
export const MAX_MSG_BYTES = 4096;
export const SIM_HZ = 60;
export const SNAP_EVERY = 3;
export const RECONNECT_GRACE_MS = 60_000;

/** One input sample for one sim tick, in compact wire form. */
export interface InputFrame {
  tick: number;
  push: number;
  h: number;
  jump: 0 | 1;
}

export interface SeatInfo {
  ctl: CtlMode;
  ready: boolean;
  connected: boolean;
}

export type ClientMsg =
  | { t: 'create'; v: number }
  | { t: 'join'; room: string; token?: string; v: number }
  | { t: 'seat'; seat: Seat }
  | { t: 'ctl'; mode: CtlMode }
  | { t: 'ready'; ready: boolean }
  | { t: 'level'; id: string }
  | { t: 'in'; seq: number; f: InputFrame[] }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

export interface SnapMsg {
  t: 'snap';
  tick: number;
  /** Server clock (ms) when this tick was simulated. */
  ms: number;
  /** Last input applied per seat: [push, h, jump]. */
  inp: [[number, number, number], [number, number, number]];
  /** Lowest x included for obstacle arrays; things beyond hi are pristine level data. */
  hi: number;
  st: GameState;
}

export interface EndMsg {
  t: 'end';
  kind: 'gameover' | 'complete';
  result: LevelResult | null;
  score: number;
  distance: number;
}

export type ServerMsg =
  | { t: 'hello'; v: number; ms: number }
  | { t: 'joined'; room: string; token: string; seat: Seat; host: Seat }
  | { t: 'room'; room: string; phase: Phase; level: string; host: Seat; you: Seat; seats: [SeatInfo | null, SeatInfo | null]; pauseUntil?: number }
  | { t: 'count'; at: number }
  | { t: 'start'; level: string; at: number }
  | SnapMsg
  | EndMsg
  | { t: 'pause'; until: number }
  | { t: 'resume' }
  | { t: 'pong'; c: number; s: number }
  | { t: 'closed'; reason: 'partner_left' | 'timeout' | 'idle' | 'server' }
  | { t: 'err'; code: string };

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const normalizeCode = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const c = s.trim().toUpperCase();
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
};

/** Parse and strictly validate one client message. Returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MSG_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'create':
      return { t: 'create', v: isNum(o.v, 0, 1000) ? o.v : 0 };
    case 'join': {
      const room = normalizeCode(o.room);
      if (!room) return null;
      const token = typeof o.token === 'string' && /^[0-9a-f]{32}$/.test(o.token) ? o.token : undefined;
      return { t: 'join', room, token, v: isNum(o.v, 0, 1000) ? o.v : 0 };
    }
    case 'seat':
      return o.seat === 0 || o.seat === 1 ? { t: 'seat', seat: o.seat } : null;
    case 'ctl':
      return o.mode === 'analog' || o.mode === 'digital' ? { t: 'ctl', mode: o.mode } : null;
    case 'ready':
      return typeof o.ready === 'boolean' ? { t: 'ready', ready: o.ready } : null;
    case 'level':
      return typeof o.id === 'string' && /^[a-z0-9-]{1,16}$/.test(o.id) ? { t: 'level', id: o.id } : null;
    case 'ping':
      return isNum(o.c, 0, 1e13) ? { t: 'ping', c: o.c } : null;
    case 'leave':
      return { t: 'leave' };
    case 'in': {
      if (!isNum(o.seq, 0, 2 ** 31) || !Array.isArray(o.f) || o.f.length === 0 || o.f.length > 8) return null;
      const f: InputFrame[] = [];
      for (const raw of o.f) {
        const r = raw as Record<string, unknown>;
        if (!r || !isNum(r.tick, 0, 2 ** 31) || !isNum(r.push, -2, 2) || !isNum(r.h, -1, 2)) return null;
        f.push({ tick: Math.floor(r.tick), push: r.push, h: r.h, jump: r.jump ? 1 : 0 });
      }
      return { t: 'in', seq: Math.floor(o.seq), f };
    }
    default:
      return null;
  }
}

export const toWire = (tick: number, i: PlayerInput): InputFrame => ({ tick, push: round3(i.push), h: round3(i.hTarget), jump: i.jump ? 1 : 0 });
export const fromWire = (f: Pick<InputFrame, 'push' | 'h' | 'jump'>): PlayerInput => ({ push: f.push, hTarget: f.h, jump: f.jump === 1 });
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
