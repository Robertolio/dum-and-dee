import type { IncomingMessage, ServerResponse } from 'node:http';
import { levelById } from '@dd/sim';
import { isProfane } from './filter';
import { randomId, type RandomBytes } from './codes';
import type { Db } from './db';
import { RateLimiter } from './ratelimit';
import type { Social } from './service';

export const LB_ENVS = ['factory', 'studio', 'boathouse', 'rowing', 'endless'] as const;
export type LbEnv = (typeof LB_ENVS)[number];
export type LbFilter = LbEnv | 'overall';
export type LbKind = 'duo' | 'player';
export type LbRange = 'week' | 'all';

const TZ = 'Europe/Amsterdam';
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function wall(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number } {
  const p: Record<string, string> = {};
  for (const x of FMT.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second!, dow: DOW[p.weekday!] ?? 0 };
}
const offsetAt = (ms: number): number => {
  const w = wall(ms);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
};

/** The start (UTC ms) of the leaderboard week that contains `ms`: Monday 00:00 in Europe/Amsterdam. */
export function weekStart(ms: number): number {
  const w = wall(ms);
  const localMidnight = Date.UTC(w.y, w.mo - 1, w.d - w.dow);
  return localMidnight - offsetAt(localMidnight - 3600_000);
}

export interface RunInput {
  level: string;
  score: number;
  ticks: number;
  distance: number;
  /** Authenticated players of the seats; null for an anonymous seat. */
  players: [string | null, string | null];
}

export interface LbEntry {
  rank: number;
  name: string;
  score: number;
  me: boolean;
  friend: boolean;
}
export interface LbView {
  kind: LbKind;
  env: LbFilter;
  range: LbRange;
  entries: LbEntry[];
  /** The caller's best position when it is not in `entries`. */
  me: LbEntry | null;
  total: number;
  weekStart: number;
}
export interface Ranks {
  env: LbEnv;
  score: number;
  duo: { week: number; all: number } | null;
  player: { week: number; all: number } | null;
}

interface Full {
  list: Array<{ ent: string; ids: string[]; name: string; score: number; rank: number }>;
}

const MAX_SCORE_PER_SECOND = 800;
const MAX_SPEED = 9;

/** Pure plausibility check for a finished run: not faster than anyone can run, and a score that fits the time played. */
export function plausible(run: Pick<RunInput, 'level' | 'score' | 'ticks' | 'distance'>): boolean {
  const def = levelById(run.level);
  const seconds = run.ticks / 60;
  if (!Number.isFinite(run.score) || run.score < 0 || run.score > 2_000_000 || seconds < 5) return false;
  if (def.endless) return run.distance <= seconds * MAX_SPEED + 30 && run.score <= seconds * MAX_SCORE_PER_SECOND + 3000;
  return def.data.length / MAX_SPEED <= seconds && run.score <= seconds * MAX_SCORE_PER_SECOND + 3000;
}

export interface LbOptions {
  now: () => number;
  randomBytes: RandomBytes;
  cacheMs?: number;
  readsPerMinutePerIp?: number;
}

/** Scores of server-authoritative online runs only. Duos and players, this week and all time, per environment. */
export class Leaderboard {
  private readonly cache = new Map<string, { at: number; full: Full }>();
  private readonly readLimit: RateLimiter;
  private readonly o: Required<LbOptions>;

  constructor(readonly db: Db, readonly social: Social, opts: LbOptions) {
    this.o = { cacheMs: 15_000, readsPerMinutePerIp: 60, ...opts };
    this.readLimit = new RateLimiter(this.o.readsPerMinutePerIp, 60_000, opts.now);
  }

  allow(ip: string): boolean {
    return this.readLimit.hit(`lb:${ip}`);
  }

  invalidate(): void {
    this.cache.clear();
  }

  // ---- writing ----

  /** Stores one run: a duo row when both players are identified, and one row per identified player. */
  async record(run: RunInput): Promise<Ranks | null> {
    const def = levelById(run.level);
    const env: LbEnv = def.endless ? 'endless' : (def.theme as LbEnv);
    if (!LB_ENVS.includes(env) || !plausible(run)) return null;
    const known = async (id: string | null): Promise<string | null> => {
      const p = id ? await this.social.player(id) : undefined;
      return p && !p.blocked ? p.id : null;
    };
    const a = await known(run.players[0]);
    const b = await known(run.players[1]);
    if (!a && !b) return null;
    const now = this.o.now();
    const week = weekStart(now);
    const timeMs = Math.round((run.ticks / 60) * 1000);
    const score = Math.round(run.score);
    const put = async (kind: LbKind, p1: string, p2: string): Promise<void> => {
      await this.db.run('INSERT INTO scores (id, kind, p1, p2, env, level, score, time_ms, created, week, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)', [randomId(12, this.o.randomBytes), kind, p1, p2, env, run.level, score, timeMs, now, week]);
    };
    if (a && b && a !== b) {
      const [p1, p2] = a < b ? [a, b] : [b, a];
      await put('duo', p1, p2);
    }
    for (const id of new Set([a, b])) if (id) await put('player', id, '');
    this.invalidate();
    return this.ranksFor(env, score, a, b);
  }

  async ranksFor(env: LbEnv, score: number, a: string | null, b: string | null): Promise<Ranks> {
    const pos = async (kind: LbKind, ent: string): Promise<{ week: number; all: number } | null> => {
      const w = (await this.full(kind, env, 'week')).list.find((e) => e.ent === ent);
      const l = (await this.full(kind, env, 'all')).list.find((e) => e.ent === ent);
      return w && l ? { week: w.rank, all: l.rank } : null;
    };
    return { env, score, duo: a && b && a !== b ? await pos('duo', a < b ? `${a}|${b}` : `${b}|${a}`) : null, player: null };
  }

  /** Rank of one player for the "You are #n" line. */
  async playerRanks(env: LbEnv, id: string): Promise<{ week: number; all: number } | null> {
    const w = (await this.full('player', env, 'week')).list.find((e) => e.ent === id);
    const l = (await this.full('player', env, 'all')).list.find((e) => e.ent === id);
    return w && l ? { week: w.rank, all: l.rank } : null;
  }

  // ---- reading ----

  private async full(kind: LbKind, env: LbFilter, range: LbRange): Promise<Full> {
    const now = this.o.now();
    const wk = weekStart(now);
    const key = `${kind}:${env}:${range}:${range === 'week' ? wk : 0}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < this.o.cacheMs) return hit.full;
    const params: unknown[] = [kind];
    let where = 'hidden = 0 AND kind = ?';
    if (range === 'week') {
      where += ' AND week = ?';
      params.push(wk);
    }
    if (env !== 'overall') {
      where += ' AND env = ?';
      params.push(env);
    }
    const rows = await this.db.all<{ p1: string; p2: string; env: string; score: number | string }>(`SELECT p1, p2, env, MAX(score) AS score FROM scores WHERE ${where} GROUP BY p1, p2, env`, params);
    const sums = new Map<string, number>();
    for (const r of rows) {
      const ent = r.p2 ? `${r.p1}|${r.p2}` : r.p1;
      sums.set(ent, (sums.get(ent) ?? 0) + Number(r.score));
    }
    const names = new Map<string, string>();
    for (const p of await this.db.all<{ id: string; name: string }>('SELECT id, name FROM players WHERE blocked = 0')) if (!isProfane(p.name)) names.set(p.id, p.name);
    const list: Full['list'] = [];
    for (const [ent, score] of sums) {
      const ids = ent.split('|');
      const ns = ids.map((i) => names.get(i));
      if (ns.some((n) => !n)) continue;
      list.push({ ent, ids, name: ids.length > 1 ? [...(ns as string[])].sort((x, y) => x.localeCompare(y)).join(' & ') : ns[0]!, score, rank: 0 });
    }
    list.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    list.forEach((e, i) => {
      e.rank = i > 0 && list[i - 1]!.score === e.score ? list[i - 1]!.rank : i + 1;
    });
    const full = { list };
    this.cache.set(key, { at: now, full });
    if (this.cache.size > 200) this.cache.clear();
    return full;
  }

  async view(kind: LbKind, env: LbFilter, range: LbRange, me: string | null, limit = 25): Promise<LbView> {
    const { list } = await this.full(kind, env, range);
    const friends = me ? new Set(await this.social.friendIds(me)) : new Set<string>();
    const mark = (e: Full['list'][number]): LbEntry => ({
      rank: e.rank,
      name: e.name,
      score: e.score,
      me: !!me && e.ids.includes(me),
      friend: e.ids.some((i) => i !== me && friends.has(i)),
    });
    const entries = list.slice(0, limit).map(mark);
    let mine: LbEntry | null = null;
    if (me && !entries.some((e) => e.me)) {
      const m = list.find((e) => e.ids.includes(me));
      if (m) mine = mark(m);
    }
    return { kind, env, range, entries, me: mine, total: list.length, weekStart: weekStart(this.o.now()) };
  }

  // ---- admin ----

  async adminList(limit = 100, env?: string): Promise<Array<{ id: string; kind: string; names: string; env: string; level: string; score: number; created: number; week: number; hidden: number }>> {
    const rows = await this.db.all<{ id: string; kind: string; p1: string; p2: string; env: string; level: string; score: number; created: number; week: number; hidden: number }>(
      `SELECT id, kind, p1, p2, env, level, score, created, week, hidden FROM scores ${env ? 'WHERE env = ?' : ''} ORDER BY created DESC LIMIT ?`,
      env ? [env, Math.max(1, Math.min(500, limit))] : [Math.max(1, Math.min(500, limit))],
    );
    const out = [];
    for (const r of rows) {
      const ns: string[] = [];
      for (const id of [r.p1, r.p2]) if (id) ns.push((await this.social.player(id))?.name ?? '?');
      out.push({ id: r.id, kind: r.kind, names: ns.join(' & '), env: r.env, level: r.level, score: r.score, created: r.created, week: r.week, hidden: r.hidden });
    }
    return out;
  }
  async adminHide(id: string, hidden: boolean): Promise<boolean> {
    if (!(await this.db.get('SELECT id FROM scores WHERE id = ?', [id]))) return false;
    await this.db.run('UPDATE scores SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
    this.invalidate();
    return true;
  }
  async adminDelete(id: string): Promise<boolean> {
    if (!(await this.db.get('SELECT id FROM scores WHERE id = ?', [id]))) return false;
    await this.db.run('DELETE FROM scores WHERE id = ?', [id]);
    this.invalidate();
    return true;
  }
}

const json = (res: ServerResponse, status: number, body: unknown, cache = 'no-store'): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': cache });
  res.end(JSON.stringify(body));
};

/** GET /api/leaderboard?kind=duo|player&env=overall|factory|...&range=week|all. The optional x-dd-token header marks "you" and friends. */
export function createLeaderboardHandler(lb: Leaderboard, social: Social) {
  return async (req: IncomingMessage, res: ServerResponse, ip: string): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/leaderboard') return false;
    if (req.method !== 'GET') return json(res, 405, { error: 'method' }), true;
    if (!lb.allow(ip)) return json(res, 429, { error: 'rate_limited' }), true;
    const kind = url.searchParams.get('kind') === 'player' ? 'player' : 'duo';
    const e = url.searchParams.get('env') ?? 'overall';
    const env: LbFilter = e === 'overall' || (LB_ENVS as readonly string[]).includes(e) ? (e as LbFilter) : 'overall';
    const range: LbRange = url.searchParams.get('range') === 'all' ? 'all' : 'week';
    const token = req.headers['x-dd-token'];
    const p = typeof token === 'string' ? await social.authenticate(token) : null;
    json(res, 200, await lb.view(kind, env, range, p?.id ?? null), p ? 'no-store' : 'public, max-age=10');
    return true;
  };
}
