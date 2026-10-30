/** Name validation and a simple profanity filter (English and Dutch). Matching ignores case, accents, leetspeak, spacing and repeated letters. */

const BAD = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'asshole', 'nigger', 'nigga', 'faggot', 'retard', 'rape', 'nazi', 'hitler', 'wank', 'twat', 'porn', 'penis', 'vagina', 'dildo', 'cum', 'ass', 'sex', 'fag', 'tit', 'tits',
  'kanker', 'kut', 'klootzak', 'tering', 'tyfus', 'hoer', 'slet', 'lul', 'pik', 'neuken', 'neger', 'mongool', 'homo', 'flikker', 'sukkel', 'eikel', 'hoerenzoon', 'kankerlijer', 'trut', 'debiel', 'idioot', 'zak', 'rotzak', 'godverdomme', 'verdomme', 'shitzooi', 'kloot', 'poep', 'stront', 'tiet', 'tieten', 'doos', 'pot', 'mietje',
];
// Words that are only blocked as a whole word (short or common inside other words).
const WHOLE_ONLY = new Set(['cunt', 'ass', 'sex', 'fag', 'tit', 'cum', 'kut', 'lul', 'pik', 'zak', 'pot', 'doos', 'poep', 'homo', 'slet', 'hoer', 'trut', 'rape', 'dick', 'cock', 'kloot', 'tiet', 'nazi']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '+': 't' };

function base(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134577@$!+]/g, (c) => LEET[c] ?? c);
}
const collapse = (s: string): string => s.replace(/(.)\1+/g, '$1');

export function isProfane(text: string): boolean {
  const b = base(text);
  const tokens = b.split(/[^a-z]+/).filter(Boolean).map(collapse);
  const joined = collapse(b.replace(/[^a-z]/g, ''));
  for (const w of BAD) {
    const cw = collapse(w);
    if (WHOLE_ONLY.has(w)) {
      if (tokens.includes(cw) || joined === cw) return true;
    } else if (joined.includes(cw) || tokens.some((t) => t.includes(cw))) return true;
  }
  return false;
}

export type NameResult = { ok: true; name: string } | { ok: false; reason: 'length' | 'chars' | 'profane' };

/** Names and team names: letters, digits, spaces and a few symbols; 2 to `max` characters. */
export function validateName(raw: unknown, max = 16): NameResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'length' };
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > max) return { ok: false, reason: 'length' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'_&-]*$/u.test(name)) return { ok: false, reason: 'chars' };
  if (isProfane(name)) return { ok: false, reason: 'profane' };
  return { ok: true, name };
}
