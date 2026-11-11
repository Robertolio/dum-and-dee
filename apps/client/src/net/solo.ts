import { loadIdentity } from '../social/identity';

export type SoloOutcome = { status: 'ok'; rank: { week: number; all: number } | null } | { status: 'unexpected' } | { status: 'error'; message: string };

export interface SoloRun {
  level: string;
  score: number;
  time: number;
  distance: number;
  /** True when the level was not finished (game over or left early). */
  partial: boolean;
}

/** Sends a solo run for the Solo list. The server checks it; every failure comes back as a readable message. */
export async function submitSolo(run: SoloRun): Promise<SoloOutcome> {
  const id = loadIdentity();
  if (!id) return { status: 'error', message: 'Add your name to get on the leaderboard.' };
  try {
    const res = await fetch('/api/leaderboard/solo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dd-token': id.token }, body: JSON.stringify(run) });
    if (res.status === 429) return { status: 'error', message: 'Too many scores sent. Try again in a minute.' };
    if (res.status === 401) return { status: 'error', message: 'This device is not signed in any more. Open Play with a friend to sign in again.' };
    const v = (await res.json().catch(() => ({}))) as { status?: string; rank?: { week: number; all: number } | null };
    if (!res.ok) return { status: 'error', message: `The server did not accept the score (${res.status}).` };
    if (v.status === 'unexpected') return { status: 'unexpected' };
    if (v.status === 'ok') return { status: 'ok', rank: v.rank ?? null };
  } catch {
    /* handled below */
  }
  return { status: 'error', message: 'Could not reach the server. Your score was not sent.' };
}

export const describeSolo = (o: SoloOutcome): string =>
  o.status === 'unexpected' ? 'Unexpected score (not on the leaderboard)' : o.status === 'error' ? o.message : o.rank ? `You are #${o.rank.all} on the leaderboard` : 'Score sent';
