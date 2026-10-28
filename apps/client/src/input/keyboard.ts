import type { PlayerInput } from '@dd/sim';
import { DEFAULT_TUNING } from '@dd/sim';

interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  run: string[];
  jump: string[];
}

const MAPS: [KeyMap, KeyMap] = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], run: ['ShiftLeft'], jump: ['Space'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], run: ['ShiftRight'], jump: ['Enter', 'NumpadEnter'] },
];

const GAME_KEYS = new Set(MAPS.flatMap((m) => [...m.up, ...m.down, ...m.left, ...m.right, ...m.run, ...m.jump]));

export interface KeyboardSample {
  /** True when any key of this player is held (keyboard takes priority over touch). */
  active: boolean;
  input: PlayerInput;
}

/**
 * Two players on one keyboard: Dum on W/S/A/D + left Shift, Dee on the arrows + right Shift.
 * W/S move the posture target at 3.0/s; releasing springs back to upright. Shift alone = crouch,
 * Shift + walk = run.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly hTargets = [DEFAULT_TUNING.hUpright, DEFAULT_TUNING.hUpright];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) {
        e.preventDefault();
        this.held.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.held.delete(e.code);
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  sample(dt: number): [KeyboardSample, KeyboardSample] {
    const out: KeyboardSample[] = [];
    for (let i = 0; i < 2; i++) {
      const m = MAPS[i]!;
      const up = this.any(m.up);
      const down = this.any(m.down);
      const left = this.any(m.left);
      const right = this.any(m.right);
      const run = this.any(m.run);
      const jump = this.any(m.jump);
      let h = this.hTargets[i]!;
      if (up) h = Math.min(1, h + 3 * dt);
      else if (down) h = Math.max(0, h - 3 * dt);
      else h = DEFAULT_TUNING.hUpright;
      this.hTargets[i] = h;
      let hTarget = h;
      if (run && !right && !left) hTarget = DEFAULT_TUNING.hBent;
      let push = 0;
      if (right) push = run ? 1 : 0.6;
      else if (left) push = -0.3;
      out.push({ active: up || down || left || right || run || jump, input: { push, hTarget, jump } });
    }
    return out as [KeyboardSample, KeyboardSample];
  }
}
