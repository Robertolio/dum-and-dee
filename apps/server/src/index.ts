import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MSG_BYTES, RoomManager } from '@dd/net';
import { Hub, Social, createAdminHandler, createPushSender, openStore, type HubConn } from '@dd/social';

interface ConnLike {
  message(raw: string): void;
  disconnect(): void;
}

const clientIp = (req: IncomingMessage): string => {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
};

/** Attach the /ws game endpoint to existing HTTP servers (same port as the static files). */
export interface Online {
  mgr: RoomManager;
  hub: Hub | null;
  /** HTTP handler for /api/*. Resolves true when it answered the request. */
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

export async function attachOnline(servers: Server[]): Promise<Online> {
  const t0 = performance.now();
  const clock = () => performance.now() - t0;
  const mgr = new RoomManager({ now: clock, randomBytes: (n) => randomBytes(n) });
  let hub: Hub | null = null;
  let admin: ReturnType<typeof createAdminHandler> | null = null;
  try {
    const db = await openStore(process.env);
    const social = new Social(db, { now: () => Date.now(), randomBytes: (n) => randomBytes(n) });
    hub = new Hub(mgr, social, createPushSender(process.env), { now: () => Date.now() });
    const h = hub;
    admin = createAdminHandler(social, process.env.ADMIN_KEY, () => Date.now(), { onPlayerRemoved: (id) => h.kick(id), onPlayerChanged: (id) => void h.refresh(id) });
    console.log(`Social: ${db.kind} store, push ${h.push.publicKey ? 'on' : 'off (no VAPID keys)'}, admin ${process.env.ADMIN_KEY ? 'on' : 'off'}`);
    void social.purgeInactive().catch(() => undefined);
    setInterval(() => void social.purgeInactive().catch(() => undefined), 24 * 3600_000).unref();
  } catch (e) {
    console.error('Social features disabled:', (e as Error).message);
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, number>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const conn = {
      send: (d: string) => {
        if (ws.readyState === ws.OPEN) ws.send(d);
      },
      close: (code?: number, reason?: string) => ws.close(code, reason),
    };
    const ip = clientIp(req);
    let ctx: ConnLike | null;
    if (hub) {
      const hc: HubConn | null = hub.connect(conn, ip);
      ctx = hc && { message: (m) => hub!.message(hc, m), disconnect: () => hub!.disconnect(hc) };
    } else {
      const c = mgr.connect(conn, ip);
      ctx = c && { message: (m) => mgr.message(c, m), disconnect: () => mgr.disconnect(c) };
    }
    if (!ctx) return;
    alive.set(ws, Date.now());
    ws.on('message', (data, isBinary) => {
      alive.set(ws, Date.now());
      if (isBinary) return;
      ctx.message(data.toString());
    });
    ws.on('pong', () => alive.set(ws, Date.now()));
    ws.on('close', () => ctx.disconnect());
    ws.on('error', () => ctx.disconnect());
  });

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const origin = req.headers.origin;
    let ok = path === '/ws';
    if (ok && origin) {
      try {
        ok = new URL(origin).host === req.headers.host;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  for (const s of servers) s.on('upgrade', upgrade);

  setInterval(() => mgr.tick(), 8).unref();
  // Sockets that went silent (locked phone, lost radio) are dropped so the partner gets the pause overlay.
  setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (now - (alive.get(ws) ?? now) > 25_000) ws.terminate();
      else if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 8000).unref();
  return {
    mgr,
    hub,
    async handleHttp(req, res) {
      if (!admin) return false;
      return admin(req, res, clientIp(req));
    },
  };
}
