import webpush from 'web-push';
import type { Db } from './db';

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url?: string;
  tag?: string;
}

export type PushResult = 'ok' | 'gone' | 'error';

export interface PushSender {
  /** VAPID public key handed to clients, or null when push is not configured. */
  readonly publicKey: string | null;
  send(sub: PushSub, payload: PushPayload): Promise<PushResult>;
}

export const noPush: PushSender = { publicKey: null, send: async () => 'error' };

/** Web Push via VAPID. Returns a disabled sender unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set. */
export function createPushSender(env: Record<string, string | undefined>): PushSender {
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return noPush;
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com';
  try {
    webpush.setVapidDetails(subject, pub, priv);
  } catch {
    return noPush;
  }
  return {
    publicKey: pub,
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
        return 'ok';
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? 'gone' : 'error';
      }
    },
  };
}

export const generateVapidKeys = (): { publicKey: string; privateKey: string } => webpush.generateVAPIDKeys();

export interface VapidConfig {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  source: 'env' | 'db';
}

export const DEFAULT_VAPID_SUBJECT = 'mailto:admin@example.invalid';

/**
 * VAPID settings: environment variables win; otherwise a key pair is generated once and kept in the
 * `settings` table so it survives restarts (and stays the same across instances sharing the database).
 */
export async function resolveVapid(db: Db, env: Record<string, string | undefined>): Promise<VapidConfig> {
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) return { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject, source: 'env' };
  const read = async (): Promise<{ publicKey: string; privateKey: string } | null> => {
    const a = await db.get<{ v: string }>('SELECT v FROM settings WHERE k = ?', ['vapid_public']);
    const b = await db.get<{ v: string }>('SELECT v FROM settings WHERE k = ?', ['vapid_private']);
    return a && b ? { publicKey: a.v, privateKey: b.v } : null;
  };
  let keys = await read();
  if (!keys) {
    const fresh = generateVapidKeys();
    await db.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING', ['vapid_public', fresh.publicKey]);
    await db.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING', ['vapid_private', fresh.privateKey]);
    keys = (await read()) ?? fresh;
  }
  return { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: subject, source: 'db' };
}
