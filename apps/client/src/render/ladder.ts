import Phaser from 'phaser';
import type { GameState, Tuning } from '@dd/sim';
import { ladderSegment } from '@dd/sim';
import { COLORS } from '../config';
import type { View } from './view';

/** Draw the ladder as two rails and rungs along the segment between the (extended) ends. */
export function drawLadder(g: Phaser.GameObjects.Graphics, view: View, s: GameState, t: Tuning): void {
  const seg = ladderSegment(s, t);
  const ax = view.sx(seg.ax);
  const ay = view.sy(seg.ay);
  const bx = view.sx(seg.bx);
  const by = view.sy(seg.by);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // perpendicular (screen) — rails above/below the centre line
  const nx = -uy;
  const ny = ux;
  const half = 14;

  g.lineStyle(7, COLORS.ladderDark);
  rail(g, ax, ay, bx, by, nx, ny, half);
  rail(g, ax, ay, bx, by, nx, ny, -half);
  g.lineStyle(5, COLORS.ladder);
  rail(g, ax, ay, bx, by, nx, ny, half);
  rail(g, ax, ay, bx, by, nx, ny, -half);

  const rungSpacing = 32;
  const count = Math.floor(len / rungSpacing);
  const start = (len - count * rungSpacing) / 2 + rungSpacing / 2;
  for (let i = 0; i < count; i++) {
    const d = start + i * rungSpacing;
    const cx = ax + ux * d;
    const cy = ay + uy * d;
    g.lineStyle(6, COLORS.ladderDark);
    g.lineBetween(cx + nx * half, cy + ny * half, cx - nx * half, cy - ny * half);
    g.lineStyle(3, COLORS.ladder);
    g.lineBetween(cx + nx * half, cy + ny * half, cx - nx * half, cy - ny * half);
  }
}

function rail(
  g: Phaser.GameObjects.Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
  off: number,
): void {
  g.lineBetween(ax + nx * off, ay + ny * off, bx + nx * off, by + ny * off);
}
