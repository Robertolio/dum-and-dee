import { loadProgress, saveProgress } from '../progress';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  const nav = navigator as unknown as { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
}

/** One-time, dismissible tip on iPhone Safari when not launched from the home screen. */
export function mountInstallTip(): void {
  if (!isIOS() || isStandalone() || loadProgress().tipDismissed) return;
  const tip = document.createElement('div');
  tip.id = 'a2hs';
  tip.dataset.testid = 'a2hs-tip';
  const text = document.createElement('span');
  text.textContent = 'Add to Home Screen for full screen: tap Share, then "Add to Home Screen".';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => {
    const p = loadProgress();
    p.tipDismissed = true;
    saveProgress(p);
    tip.remove();
  });
  tip.append(text, close);
  document.body.append(tip);
}
