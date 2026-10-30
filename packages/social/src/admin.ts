import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RateLimiter } from './ratelimit';
import type { Social } from './service';

export interface AdminHooks {
  /** Called after a player was deleted or blocked so live sockets can be dropped. */
  onPlayerRemoved?: (id: string) => void;
  onPlayerChanged?: (id: string) => void;
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 4096) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        resolve(typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });

/** Basic admin API under /api/admin/*, protected by the ADMIN_KEY env var (disabled, 404, when unset). Returns true when the request was handled. */
export function createAdminHandler(social: Social, adminKey: string | undefined, now: () => number, hooks: AdminHooks = {}) {
  const fails = new RateLimiter(10, 60_000, now);
  return async (req: IncomingMessage, res: ServerResponse, ip: string): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/admin/')) return false;
    if (!adminKey) return json(res, 404, { error: 'disabled' }), true;
    const given = req.headers['x-admin-key'];
    if (typeof given !== 'string' || !same(given, adminKey)) {
      if (!fails.hit(`admin:${ip}`)) return json(res, 429, { error: 'rate_limited' }), true;
      return json(res, 401, { error: 'unauthorized' }), true;
    }
    const parts = url.pathname.split('/').filter(Boolean); // api admin players [id [action]]
    if (parts[2] !== 'players') return json(res, 404, { error: 'not_found' }), true;
    const id = parts[3];
    if (!id) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method' }), true;
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return json(res, 200, { players: await social.adminList(Number.isFinite(limit) ? limit : 100) }), true;
    }
    if (!/^[A-Za-z0-9]{10}$/.test(id)) return json(res, 400, { error: 'bad_id' }), true;
    const action = parts[4];
    if (req.method === 'DELETE' && !action) {
      if (!(await social.player(id))) return json(res, 404, { error: 'not_found' }), true;
      await social.deleteMe(id);
      hooks.onPlayerRemoved?.(id);
      return json(res, 200, { ok: true }), true;
    }
    if (req.method === 'POST' && action === 'rename') {
      const body = await readBody(req);
      const ok = await social.adminSetName(id, String(body.name ?? ''));
      if (ok) hooks.onPlayerChanged?.(id);
      return json(res, ok ? 200 : 400, { ok }), true;
    }
    if (req.method === 'POST' && (action === 'block' || action === 'unblock')) {
      const ok = await social.adminBlock(id, action === 'block');
      if (ok && action === 'block') hooks.onPlayerRemoved?.(id);
      return json(res, ok ? 200 : 404, { ok }), true;
    }
    return json(res, 404, { error: 'not_found' }), true;
  };
}
