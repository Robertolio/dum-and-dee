import { loadIdentity } from '../social/identity';

export type SoloOutcome = { status: 'ok'; rank: { week: number; all: number } | null } | { status: 'unexpected' } | { status: 'none' };

/** Sends a finished solo run for the Solo list. The server checks it; anonymous devices and failures simply give 'none'. */
export async function submitSolo(run: { level: string; score: number; time: number; distance: number }): Promise<SoloOutcome> {
  const id = loadIdentity();
  if (!id) return { status: 'none' };
  try {
    const res = await fetch('/api/leaderboard/solo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dd-token': id.token }, body: JSON.stringify(run) });
    if (!res.ok) return { status: 'none' };
    const v = (await res.json()) as { status?: string; rank?: { week: number; all: number } | null };
    if (v.status === 'unexpected') return { status: 'unexpected' };
    if (v.status === 'ok') return { status: 'ok', rank: v.rank ?? null };
  } catch {
    /* offline: the run is simply not on the board */
  }
  return { status: 'none' };
}
