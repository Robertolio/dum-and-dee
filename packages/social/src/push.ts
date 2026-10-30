import webpush from 'web-push';

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
