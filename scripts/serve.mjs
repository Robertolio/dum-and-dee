import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../apps/client/dist', import.meta.url)));
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = join(root, rel);
  if (!file.startsWith(root)) return null;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
    return file;
  } catch {
    return null;
  }
}

let api = null;

const server = () => createServer(async (req, res) => {
  const headers = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' };
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname.startsWith('/api/')) {
      if (api && (await api.handleHttp(req, res))) return;
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, headers).end();
      return;
    }
    const file = await resolveFile(pathname);
    if (!file) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = extname(file);
    const cache = file.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    const body = await readFile(file);
    res.writeHead(200, {
      ...headers,
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cache,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(400, headers).end();
  }
});

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

console.log(`node ${process.version}, cwd ${process.cwd()}, PORT=${process.env.PORT ?? '(unset, using 3000)'}`);
if (!existsSync(join(root, 'index.html'))) {
  console.error(`WARNING: ${root}/index.html not found: the client build is missing (check the build logs). Serving 404s.`);
}

// Primary port from Railway, plus the usual dev/preview ports as a safety net in case the public
// domain's target port was set to one of them in Railway's networking settings.
const ports = process.env.DD_SINGLE_PORT ? [port] : [...new Set([port, 4173, 5173, 3000, 8080])];
const servers = [];
for (const p of ports) {
  const srv = server();
  servers.push(srv);
  srv.on('error', (e) => console.error(`port ${p}: ${e.code ?? e.message}`));
  srv.listen(p, '0.0.0.0', () => console.log(`Serving ${root} on 0.0.0.0:${p}${p === port ? ' (PORT)' : ''}`));
}

// Online two-player endpoint (/ws) on the same HTTP ports. Static serving keeps working if it fails to load.
try {
  const online = await import('../apps/server/dist/online.mjs');
  api = await online.attachOnline(servers);
  console.log('Online play: WebSocket endpoint at /ws');
} catch (e) {
  console.error('Online play disabled:', e?.message ?? e);
}
