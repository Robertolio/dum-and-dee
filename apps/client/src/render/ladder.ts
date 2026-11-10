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

const WHITE = 0xf4f4ee;
const BLUE = 0x2a6ebb;
const YELLOW = 0xf2a900;

/** Fixed damage marks along the hull: each appears once the hull drops below its threshold (percent of damage). */
const MARKS = (() => {
  let r = 7;
  const rnd = (): number => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: Array<{ at: number; level: number; kind: 'scratch' | 'crack' | 'hole' | 'chunk'; seed: number }> = [];
  const plan: Array<[number, 'scratch' | 'crack' | 'hole' | 'chunk']> = [
    [4, 'scratch'], [9, 'scratch'], [15, 'scratch'], [22, 'crack'], [28, 'scratch'], [34, 'crack'], [41, 'hole'],
    [48, 'crack'], [55, 'hole'], [62, 'chunk'], [70, 'hole'], [78, 'chunk'], [86, 'hole'], [93, 'chunk'],
  ];
  for (const [level, kind] of plan) out.push({ at: 0.12 + rnd() * 0.76, level, kind, seed: rnd() });
  return out;
})();

/** The skiff: a long narrow white hull with a blue stripe, carried at the two hands. Damage shows as scratches, cracks, holes and missing chunks. */
export function drawBoat(g: Phaser.GameObjects.Graphics, view: View, s: GameState, t: Tuning): void {
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
  const nx = uy;
  const ny = -ux;
  const ext = 26;
  drawSkiff(g, ax - ux * ext, ay - uy * ext, ux, uy, len + ext * 2, 100 - Math.max(0, Math.min(100, s.bucket.water)));
}

export interface Dol {
  /** Screen position of the oarlock (dol) on the visible side, and of its far-side twin. */
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** Riggers at these hull positions (0..1): the seats of Dum and Dee. */
export const RIGGER_AT = [0.36, 0.66] as const;

/**
 * The skiff hull from (x0, y0) along the unit vector (ux, uy), length L px, with damage 0..100.
 * Riggers (brackets with a dol and a dolpen) stand on the visible side; a fainter pair shows the far side.
 */
export function drawSkiff(g: Phaser.GameObjects.Graphics, x0: number, y0: number, ux: number, uy: number, L: number, damage: number): Dol[] {
  const nx = uy;
  const ny = -ux;
  const pt = (d: number, off: number): [number, number] => [x0 + ux * L * d + nx * off, y0 + uy * L * d + ny * off];
  const depth = (d: number): number => 24 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, d))), 0.75);
  const rise = (d: number): number => 10 + 8 * Math.pow(2 * Math.abs(d - 0.5), 2);
  const N = 28;
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const d = i / N;
    top.push(pt(d, rise(d)));
    bottom.push(pt(d, -depth(d) + 4));
  }
  const poly = (pts: Array<[number, number]>): void => {
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1])));
    g.closePath();
    g.fillPath();
  };
  const hull = [...top, ...bottom.slice().reverse()];
  const dols: Dol[] = RIGGER_AT.map((d) => {
    const [bx0, by0] = pt(d, rise(d));
    const far = [bx0 - ux * 5 + nx * 2, by0 - uy * 5 + ny * 2] as const;
    g.lineStyle(2, 0x9aa3ac, 0.55);
    g.lineBetween(far[0] - ux * 9, far[1] - uy * 9, far[0] + ux * 3 + nx * 18, far[1] + uy * 3 + ny * 18);
    g.lineBetween(far[0] + ux * 9, far[1] + uy * 9, far[0] + ux * 3 + nx * 18, far[1] + uy * 3 + ny * 18);
    g.fillStyle(0x9aa3ac, 0.55);
    g.fillCircle(far[0] + ux * 3 + nx * 19, far[1] + uy * 3 + ny * 19, 5);
    return { x: bx0 + nx * 21 + ux * 5, y: by0 + ny * 21 + uy * 5, fx: far[0] + ux * 3 + nx * 12, fy: far[1] + uy * 3 + ny * 12 };
  });
  g.fillStyle(0x8d96a0);
  poly(hull.map(([x, y]) => [x + nx * -2, y + ny * -2] as [number, number]));
  g.fillStyle(WHITE);
  poly(hull);
  g.fillStyle(0xdfe4e8);
  poly([...bottom.slice(), ...bottom.map((p, i) => pt(i / N, -depth(i / N) * 0.55 + 4)).reverse()]);
  const stripe = (off: number, w: number, color: number): void => {
    g.lineStyle(w, color, 1);
    g.beginPath();
    for (let i = 2; i <= N - 2; i++) {
      const d = i / N;
      const p = pt(d, off + (rise(d) - 10) * 0.9);
      if (i === 2) g.moveTo(p[0], p[1]);
      else g.lineTo(p[0], p[1]);
    }
    g.strokePath();
  };
  stripe(2, 6, BLUE);
  stripe(8, 2, YELLOW);
  g.lineStyle(2, 0x8d96a0, 1);
  g.beginPath();
  top.forEach((p, i) => (i === 0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1])));
  g.strokePath();
  g.fillStyle(YELLOW);
  g.fillCircle(pt(0.015, 2)[0], pt(0.015, 2)[1], 4);
  g.fillCircle(pt(0.985, 2)[0], pt(0.985, 2)[1], 4);

  for (const dl of dols) {
    const bx0 = dl.x - nx * 21 - ux * 5;
    const by0 = dl.y - ny * 21 - uy * 5;
    g.lineStyle(5, 0x4a525a, 1);
    g.lineBetween(bx0 - ux * 15, by0 - uy * 15, dl.x, dl.y);
    g.lineBetween(bx0 + ux * 9, by0 + uy * 9, dl.x, dl.y);
    g.lineStyle(3, 0x4a525a, 1);
    g.lineBetween(dl.x - nx * 3, dl.y - ny * 3, dl.x + nx * 11, dl.y + ny * 11);
    g.fillStyle(YELLOW, 1);
    g.fillCircle(dl.x + nx * 11, dl.y + ny * 11, 4);
    g.fillStyle(0x4a525a, 1);
    g.fillCircle(dl.x, dl.y, 7);
    g.fillStyle(YELLOW, 1);
    g.fillCircle(dl.x, dl.y, 3.2);
  }
  for (const m of MARKS) {
    if (damage < m.level) continue;
    const grow = Math.min(1, (damage - m.level) / 14 + 0.45);
    const [cx, cy] = pt(m.at, rise(m.at) * 0.2 - depth(m.at) * 0.3);
    if (m.kind === 'scratch') {
      g.lineStyle(2, 0x6b747d, 0.9);
      g.lineBetween(cx - ux * 9 * grow, cy - uy * 9 * grow + 3, cx + ux * 11 * grow, cy + uy * 11 * grow - 2);
      g.lineBetween(cx - ux * 4, cy - uy * 4 - 3, cx + ux * 6 * grow, cy + uy * 6 * grow - 6);
    } else if (m.kind === 'crack') {
      g.lineStyle(2, 0x3b4248, 1);
      g.beginPath();
      g.moveTo(cx + nx * 12, cy + ny * 12);
      for (let k = 1; k <= 4; k++) g.lineTo(cx + nx * (12 - k * 6 * grow) + ux * (k % 2 ? 5 : -4) * grow, cy + ny * (12 - k * 6 * grow) + uy * (k % 2 ? 5 : -4) * grow);
      g.strokePath();
    } else if (m.kind === 'hole') {
      const r = (4 + m.seed * 3) * grow;
      g.fillStyle(0x2a1a10, 1);
      g.fillEllipse(cx, cy, r * 2.4, r * 1.7);
      g.lineStyle(2, 0xcaa77a, 1);
      g.strokeEllipse(cx, cy, r * 2.6, r * 1.9);
    } else {
      const w = (0.035 + m.seed * 0.02) * grow;
      const pts: Array<[number, number]> = [pt(m.at - w, rise(m.at) + 1), pt(m.at, rise(m.at) - 11 * grow), pt(m.at + w, rise(m.at) + 1)];
      g.fillStyle(0x2a1a10, 1);
      g.fillTriangle(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
      g.lineStyle(2, 0xcaa77a, 1);
      g.lineBetween(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
      g.lineBetween(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    }
  }
  return dols;
}
