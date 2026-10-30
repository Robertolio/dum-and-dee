/** Keep the screen on while playing (Screen Wake Lock API; silently skipped where unsupported). */
type Sentinel = { release: () => Promise<void>; addEventListener: (t: string, cb: () => void) => void };
let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
  if (!wl || !wanted || sentinel) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export function keepScreenOn(): void {
  wanted = true;
  void acquire();
}

export function installWakeLockRecovery(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
