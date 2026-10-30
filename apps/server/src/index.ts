import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MSG_BYTES, RoomManager, type ConnCtx } from '@dd/net';

const clientIp = (req: IncomingMessage): string => {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
};

/** Attach the /ws game endpoint to existing HTTP servers (same port as the static files). */
export function attachOnline(servers: Server[]): RoomManager {
  const t0 = performance.now();
  const mgr = new RoomManager({ now: () => performance.now() - t0, randomBytes: (n) => randomBytes(n) });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, number>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ctx: ConnCtx | null = mgr.connect(
      {
        send: (d) => {
          if (ws.readyState === ws.OPEN) ws.send(d);
        },
        close: (code, reason) => ws.close(code, reason),
      },
      clientIp(req),
    );
    if (!ctx) return;
    alive.set(ws, Date.now());
    ws.on('message', (data, isBinary) => {
      alive.set(ws, Date.now());
      if (isBinary) return;
      mgr.message(ctx, data.toString());
    });
    ws.on('pong', () => alive.set(ws, Date.now()));
    ws.on('close', () => mgr.disconnect(ctx));
    ws.on('error', () => mgr.disconnect(ctx));
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
  return mgr;
}
