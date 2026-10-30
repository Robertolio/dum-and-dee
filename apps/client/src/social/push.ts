import type { SocialClient } from '../net/social';

export function pushSupport(): { ok: true } | { ok: false; reason: string } {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return { ok: false, reason: 'On iPhone, notifications only work from the home screen app (iOS 16.4 or newer): tap Share, "Add to Home Screen", then open the app from there.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'This browser cannot receive notifications.' };
  return { ok: true };
}

export async function pushEnabled(): Promise<boolean> {
  try {
    if (!pushSupport().ok || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

const b64 = (s: string): Uint8Array => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const toB64 = (buf: ArrayBuffer | null): string => {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function enablePush(social: SocialClient): Promise<'ok' | 'denied' | 'novapid' | 'error'> {
  try {
    if (!social.vapid) return 'novapid';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(social.vapid) as BufferSource }));
    social.send({ t: 'push_sub', endpoint: sub.endpoint, p256dh: toB64(sub.getKey('p256dh')), auth: toB64(sub.getKey('auth')) });
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function disablePush(social?: SocialClient): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      social?.send({ t: 'push_unsub', endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}
