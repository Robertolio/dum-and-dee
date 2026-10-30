export const FRIEND_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LETTERS = FRIEND_ALPHABET.replace(/[2-9]/g, '');

export type RandomBytes = (n: number) => Uint8Array;

function pickFrom(alphabet: string, n: number, rb: RandomBytes): string {
  let s = '';
  while (s.length < n) for (const b of rb(n * 4)) if (b < 248 && s.length < n) s += alphabet[b % alphabet.length];
  return s;
}

/** `ROB-7K2`: three letters from the name (confusing ones dropped, padded randomly) plus three random characters. */
export function makeFriendCode(name: string, rb: RandomBytes): string {
  const letters = name
    .normalize('NFKD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 3);
  const head = letters + pickFrom(LETTERS, 3 - letters.length, rb);
  return `${head}-${pickFrom(FRIEND_ALPHABET, 3, rb)}`;
}

export function normalizeFriendCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase().replace(/[\s_]/g, '').replace(/^([A-Z]{3})-?(.{3})$/, '$1-$2');
  if (!/^[A-Z]{3}-[A-Z0-9]{3}$/.test(c)) return null;
  for (const ch of c.slice(4)) if (!FRIEND_ALPHABET.includes(ch)) return null;
  return c;
}

export function randomId(n: number, rb: RandomBytes): string {
  return pickFrom(FRIEND_ALPHABET, n, rb);
}
export function randomHex(n: number, rb: RandomBytes): string {
  return [...rb(n)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
