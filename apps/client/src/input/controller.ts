import type { PlayerInput } from '@dd/sim';
import { DEFAULT_TUNING } from '@dd/sim';
import { postureFromOffset, pushFromOffset, type ControlSettings, type InputProvider, type ThumbState } from './types';
import { KeyboardInput } from './keyboard';

interface TouchSlot {
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Push keeps its last value after release so one thumb can both walk and bend. */
  latchedPush: number;
  /** Recent samples (ms, game y) for flick detection, down time for tap detection, pending jump. */
  trail: { t: number; y: number }[];
  downAt: number;
  moved: number;
  jumpPending: boolean;
  lastJumpAt: number;
}

const H_UP = DEFAULT_TUNING.hUpright;
const H_BENT = DEFAULT_TUNING.hBent;

/**
 * One-screen controller: left half of the canvas is Dum, right half is Dee.
 * Each player has one thumb: vertical drag = posture (analog) or hold/release (digital),
 * horizontal drag = push. Keyboard (two players on one keyboard) is always active as well.
 */
export class Controller implements InputProvider {
  private readonly slots: [TouchSlot, TouchSlot] = [newSlot(), newSlot()];
  private readonly keyboard: KeyboardInput;
  private cfg: ControlSettings = { posture: 'analog', source: 'touch' };
  private override: [PlayerInput, PlayerInput] | null = null;
  private cssToGame = 1;
  private readonly thumbStates: [ThumbState, ThumbState] = [newThumb(), newThumb()];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.keyboard = new KeyboardInput();
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onUp, { passive: false });
    canvas.addEventListener('lostpointercapture', this.onUp as EventListener);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Ratio of game pixels per CSS pixel, used for drawing the thumb feedback. */
  setScale(gamePxPerCssPx: number): void {
    this.cssToGame = gamePxPerCssPx;
  }

  settings(): ControlSettings {
    return { ...this.cfg };
  }

  setSettings(s: Partial<ControlSettings>): void {
    this.cfg = { ...this.cfg, ...s };
    if (this.cfg.source === 'keyboard') {
      for (const slot of this.slots) {
        slot.pointerId = null;
        slot.latchedPush = 0;
      }
    }
  }

  /** Test hook: force inputs regardless of touch/keyboard. */
  setOverride(inputs: [PlayerInput, PlayerInput] | null): void {
    this.override = inputs;
  }

  thumbs(): [ThumbState, ThumbState] {
    return this.thumbStates;
  }

  sample(dt: number): [PlayerInput, PlayerInput] {
    const kb = this.keyboard.sample(dt);
    const out: [PlayerInput, PlayerInput] = [
      { push: 0, hTarget: H_UP },
      { push: 0, hTarget: H_UP },
    ];
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i]!;
      const touching = slot.pointerId !== null;
      let input: PlayerInput;
      if (this.cfg.source === 'touch') {
        if (touching) {
          const dx = (slot.x - slot.startX) / this.cssToGame;
          const dy = (slot.y - slot.startY) / this.cssToGame;
          const push = pushFromOffset(dx);
          slot.latchedPush = push;
          const hTarget = this.cfg.posture === 'analog' ? postureFromOffset(dy) : dy > 40 ? H_BENT : H_UP;
          input = { push, hTarget, jump: this.takeJump(slot) };
        } else {
          input = { push: slot.latchedPush, hTarget: this.cfg.posture === 'analog' ? H_UP : H_BENT, jump: this.takeJump(slot) };
        }
        // Keyboard can always take over (useful on a laptop next to the phone).
        const k = kb[i]!;
        if (k.active) input = k.input;
      } else {
        input = kb[i]!.input;
      }
      if (this.override) input = this.override[i]!;
      out[i] = input;
      const th = this.thumbStates[i]!;
      th.active = touching;
      th.x = slot.x;
      th.y = slot.y;
      th.startX = slot.startX;
      th.startY = slot.startY;
      th.input = input;
    }
    return out;
  }

  /** A jump is a quick upward flick of the thumb or a short tap. */
  private takeJump(slot: TouchSlot): boolean {
    const now = performance.now();
    if (slot.pointerId !== null) {
      const recent = slot.trail.filter((p) => now - p.t < 160);
      if (recent.length >= 2) {
        const rise = recent[0]!.y - slot.y;
        if (rise / this.cssToGame > 38 && now - slot.lastJumpAt > 450) {
          slot.jumpPending = true;
          slot.trail = [];
        }
      }
    }
    if (!slot.jumpPending) return false;
    slot.jumpPending = false;
    slot.lastJumpAt = now;
    return true;
  }

  private seatLock: 0 | 1 | null = null;

  /** Online play: a touch anywhere controls this seat. */
  lockSeat(seat: 0 | 1 | null): void {
    this.seatLock = seat;
    for (const slot of this.slots) {
      slot.pointerId = null;
      slot.latchedPush = 0;
    }
  }

  private slotFor(e: PointerEvent): number {
    if (this.seatLock !== null) return this.seatLock;
    const rect = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / Math.max(1, rect.width);
    return fx < 0.5 ? 0 : 1;
  }

  private toGame(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * this.cssToGame, (e.clientY - rect.top) * this.cssToGame];
  }

  private onDown = (e: PointerEvent): void => {
    if (this.cfg.source !== 'touch') return;
    e.preventDefault();
    const i = this.slotFor(e);
    const slot = this.slots[i]!;
    if (slot.pointerId !== null) return; // second finger on the same half is ignored
    const [x, y] = this.toGame(e);
    slot.pointerId = e.pointerId;
    slot.startX = slot.x = x;
    slot.startY = slot.y = y;
    slot.trail = [{ t: performance.now(), y }];
    slot.downAt = performance.now();
    slot.moved = 0;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not supported on some browsers */
    }
  };

  private onMove = (e: PointerEvent): void => {
    const slot = this.slots.find((s) => s.pointerId === e.pointerId);
    if (!slot) return;
    e.preventDefault();
    [slot.x, slot.y] = this.toGame(e);
    const now = performance.now();
    slot.trail.push({ t: now, y: slot.y });
    if (slot.trail.length > 12) slot.trail.shift();
    slot.moved = Math.max(slot.moved, Math.hypot(slot.x - slot.startX, slot.y - slot.startY) / this.cssToGame);
  };

  private onUp = (e: PointerEvent): void => {
    const slot = this.slots.find((s) => s.pointerId === e.pointerId);
    if (!slot) return;
    e.preventDefault?.();
    if (e.type === 'pointerup' && performance.now() - slot.downAt < 220 && slot.moved < 14) slot.jumpPending = true;
    slot.pointerId = null;
  };
}

function newSlot(): TouchSlot {
  return { pointerId: null, startX: 0, startY: 0, x: 0, y: 0, latchedPush: 0, trail: [], downAt: 0, moved: 0, jumpPending: false, lastJumpAt: -1e9 };
}

function newThumb(): ThumbState {
  return { active: false, x: 0, y: 0, startX: 0, startY: 0, input: { push: 0, hTarget: H_UP } };
}
