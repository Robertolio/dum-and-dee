import type { ControlSettings } from '../input/types';

const KEY = 'dd-controls';

/** Touch phones/tablets use thumbs (analog); everything with a precise pointer and no touch uses the keyboard. */
export function autoControls(): ControlSettings {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  const fine = window.matchMedia?.('(any-pointer: fine)').matches === true;
  const touch = coarse || (navigator.maxTouchPoints > 0 && !fine) || ('ontouchstart' in window && !fine);
  return { source: touch ? 'touch' : 'keyboard', posture: 'analog' };
}

export function savedControls(): Partial<ControlSettings> | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ControlSettings> | null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function saveControls(c: Partial<ControlSettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...savedControls(), ...c }));
  } catch {
    /* ignore */
  }
}

/** Automatic choice unless the player overrode it in settings. */
export function initialControls(): ControlSettings {
  return { ...autoControls(), ...savedControls() };
}
