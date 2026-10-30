const KEY = 'dd-progress';

export interface LevelRecord {
  stars: number;
  best: number;
}
export interface Progress {
  levels: Record<string, LevelRecord>;
  endless: Record<string, { bestDistance: number; bestScore: number }>;
  tipDismissed?: boolean;
}

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Progress>;
    return { levels: raw.levels ?? {}, endless: raw.endless ?? {}, tipDismissed: !!raw.tipDismissed };
  } catch {
    return { levels: {}, endless: {} };
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress simply is not remembered */
  }
}

export function recordLevel(id: string, stars: number, score: number): Progress {
  const p = loadProgress();
  const old = p.levels[id];
  p.levels[id] = { stars: Math.max(old?.stars ?? 0, stars), best: Math.max(old?.best ?? 0, score) };
  saveProgress(p);
  return p;
}

export function recordEndless(id: string, distance: number, score: number): Progress {
  const p = loadProgress();
  const old = p.endless[id];
  p.endless[id] = { bestDistance: Math.max(old?.bestDistance ?? 0, distance), bestScore: Math.max(old?.bestScore ?? 0, score) };
  saveProgress(p);
  return p;
}
