import type { PlayerInput } from '@dd/sim';

export type PostureMode = 'analog' | 'digital';
export type InputSource = 'touch' | 'keyboard';

export interface ControlSettings {
  posture: PostureMode;
  source: InputSource;
}

/** Visual state of one player's thumb for on-screen feedback. */
export interface ThumbState {
  active: boolean;
  /** Canvas coordinates (game pixels). */
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** Latest input produced for this player. */
  input: PlayerInput;
}

export interface InputProvider {
  /** Called once per sim tick; returns the inputs for Dum and Dee. */
  sample(dt: number): [PlayerInput, PlayerInput];
  thumbs(): [ThumbState, ThumbState];
  settings(): ControlSettings;
  setSettings(s: Partial<ControlSettings>): void;
}

/** Push mapping shared by touch and keyboard: hold = walk 0.6, +120 px = run 1.0, −120 px = brake −0.3. */
export function pushFromOffset(dxPx: number): number {
  if (dxPx >= 0) return 0.6 + 0.4 * Math.min(1, dxPx / 120);
  return 0.6 - 0.9 * Math.min(1, -dxPx / 120);
}

/** Analog posture: thumb down = 0.8, drag down 120 px → 0.0, drag up 60 px → 1.0. */
export function postureFromOffset(dyPx: number): number {
  if (dyPx >= 0) return 0.8 - 0.8 * Math.min(1, dyPx / 120);
  return 0.8 + 0.2 * Math.min(1, -dyPx / 60);
}
