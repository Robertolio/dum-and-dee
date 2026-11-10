const KEY = 'dd-id';
const SKIP = 'dd-skip';

export interface Identity {
  token: string;
  name: string;
}

/** The only things stored on this device: a secret token and the chosen name. */
export function loadIdentity(): Identity | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Identity> | null;
    return v && typeof v.token === 'string' && /^[0-9a-f]{48}$/.test(v.token) ? { token: v.token, name: String(v.name ?? '') } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
    localStorage.removeItem(SKIP);
  } catch {
    /* private mode */
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const skippedIdentity = (): boolean => {
  try {
    return localStorage.getItem(SKIP) === '1';
  } catch {
    return false;
  }
};

export function skipIdentity(): void {
  try {
    localStorage.setItem(SKIP, '1');
  } catch {
    /* ignore */
  }
}

export const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function parseInviteCode(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toUpperCase();
  const m = /(?<![A-Z0-9])[A-Z]{3}-[A-Z0-9]{3}(?![A-Z0-9])/.exec(v);
  if (m) return m[0];
  const bare = /^\s*([A-Z]{3})([A-Z0-9]{3})\s*$/.exec(v);
  return bare ? `${bare[1]}-${bare[2]}` : null;
}

export const inviteFromUrl = (): string | null => parseInviteCode(new URLSearchParams(location.search).get('invite'));
