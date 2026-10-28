import Phaser from 'phaser';
import type { ThumbState } from '../input/types';
import { COLORS } from '../config';

/** Feedback under each thumb: ring filling with push, vertical posture bar with the neutral mark. */
export function drawThumb(g: Phaser.GameObjects.Graphics, th: ThumbState, color: number, analog: boolean): void {
  if (!th.active) return;
  const { startX, startY, x, y } = th;
  const push = th.input.push;
  const h = th.input.hTarget;

  // Ring at the touch-down point (digital only: analog control shows just the posture bar).
  if (!analog) {
    g.lineStyle(3, 0xffffff, 0.35);
    g.strokeCircle(startX, startY, 46);
    const frac = Phaser.Math.Clamp((push + 0.3) / 1.3, 0, 1);
    g.lineStyle(7, color, 0.9);
    g.beginPath();
    g.arc(startX, startY, 46, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    g.strokePath();
  }

  // Posture bar to the side of the ring.
  const bx = startX + 70;
  const top = startY - 70;
  const height = 140;
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(bx - 8, top, 16, height, 8);
  const fillTop = top + height * (1 - h);
  g.fillStyle(color, 0.9);
  g.fillRoundedRect(bx - 6, fillTop, 12, top + height - fillTop, 6);
  // neutral mark
  g.fillStyle(0xffffff, 0.9);
  const neutralY = top + height * (1 - 0.8);
  g.fillRect(bx - 12, neutralY - 1, 24, 2);
  if (!analog) {
    // digital: show the two positions
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(bx - 12, top + height * (1 - 0.2) - 1, 24, 2);
  }

  if (analog) return;
  // Current thumb position.
  g.fillStyle(color, 0.35);
  g.fillCircle(x, y, 26);
  g.lineStyle(2, COLORS.white, 0.6);
  g.strokeCircle(x, y, 26);
}
