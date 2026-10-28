/** Real fullscreen on desktop/Android via the Fullscreen API. iPhone Safari has no API; use Add to Home Screen. */
export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled;
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function toggleFullscreen(target: HTMLElement = document.documentElement): Promise<void> {
  if (!fullscreenSupported()) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* user gesture missing or denied */
  }
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}
