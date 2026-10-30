import Phaser from 'phaser';
import type { GameState, Tuning } from '@dd/sim';
import { COLORS } from '../config';
import { STRINGS } from '../strings';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Heads-up display: score, posture portraits, balance level, hearts, water meter. */
export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly waterText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly nameDum: Phaser.GameObjects.Text;
  private readonly nameDee: Phaser.GameObjects.Text;
  private width: number;

  constructor(
    private readonly scene: Phaser.Scene,
    width: number,
  ) {
    this.width = width;
    this.g = scene.add.graphics().setDepth(50);
    const style = { fontFamily: FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold' };
    this.scoreText = scene.add.text(62, 16, '00000', style).setDepth(51);
    this.waterText = scene.add
      .text(width - 26, 76, '100%', { ...style, fontSize: '20px' })
      .setOrigin(1, 0)
      .setDepth(51);
    this.comboText = scene.add.text(176, 18, '', { ...style, fontSize: '20px', color: '#ffd36b', stroke: '#102024', strokeThickness: 4 }).setDepth(51);
    const nameStyle = { fontFamily: FONT, fontSize: '11px', color: '#ffffff', fontStyle: 'bold' };
    this.nameDum = scene.add.text(26, 59, STRINGS.dum, nameStyle).setOrigin(0.5, 0).setDepth(52);
    this.nameDee = scene.add.text(26, 101, STRINGS.dee, nameStyle).setOrigin(0.5, 0).setDepth(52);
  }

  resize(width: number): void {
    this.width = width;
    this.waterText.setX(width - 26);
  }

  draw(s: GameState, _t: Tuning): void {
    const g = this.g;
    const W = this.width;
    g.clear();

    // Score panel
    panel(g, 14, 12, 150, 38);
    star(g, 36, 31, 12);
    this.scoreText.setText(String(Math.floor(s.score)).padStart(5, '0'));

    this.comboText.setText(s.combo >= 3 ? `x${s.comboMult} · ${s.combo}` : '');

    // Portraits with posture bars
    for (let i = 0; i < 2; i++) {
      const p = s.players[i]!;
      const y = 60 + i * 42;
      const col = i === 0 ? COLORS.dum : COLORS.dee;
      const dark = i === 0 ? COLORS.dumDark : COLORS.deeDark;
      g.fillStyle(dark);
      g.fillRoundedRect(12, y - 4, 30, 30, 5);
      g.fillStyle(col);
      g.fillRoundedRect(14, y - 2, 26, 26, 4);
      g.fillStyle(COLORS.skin);
      g.fillCircle(27, y + 6, 7);
      g.fillStyle(dark);
      g.fillRect(20, y - 2, 14, 5);
      // bar
      panelDark(g, 48, y + 4, 90, 14);
      g.fillStyle(col);
      g.fillRoundedRect(50, y + 6, 86 * Phaser.Math.Clamp(p.h, 0, 1), 10, 3);
      // neutral mark (upright) on the bar
      g.fillStyle(0xffffff, 0.6);
      g.fillRect(50 + 86 * 0.8 - 1, y + 4, 2, 14);
    }
    this.nameDum.setPosition(27, 75);
    this.nameDee.setPosition(27, 117);

    // Balance level (tension), centre top
    const bw = 240;
    const bx = W / 2 - bw / 2;
    panel(g, bx, 14, bw, 30);
    g.fillStyle(0xf4f7f8);
    g.fillRoundedRect(bx + 28, 21, bw - 36, 16, 6);
    g.lineStyle(2, 0x9aa7ad);
    for (let i = -3; i <= 3; i++) {
      const tx = bx + 28 + (bw - 36) / 2 + (i * (bw - 36)) / 8;
      g.lineBetween(tx, 23, tx, i === 0 ? 35 : 29);
    }
    const bal = Phaser.Math.Clamp(s.balance, -1, 1);
    const abs = Math.abs(bal);
    const bubbleColor = abs < 0.35 ? COLORS.balanceGreen : abs < 0.7 ? COLORS.balanceOrange : COLORS.balanceRed;
    const bubbleX = bx + 28 + (bw - 36) / 2 + bal * ((bw - 36) / 2 - 22);
    g.fillStyle(bubbleColor);
    g.fillRoundedRect(bubbleX - 20, 23, 40, 12, 5);
    // bucket icon left of the level
    g.fillStyle(COLORS.water);
    g.fillCircle(bx + 16, 29, 7);
    g.fillStyle(0xffffff);
    g.fillCircle(bx + 14, 27, 2);

    // Hearts
    const slots = Math.max(3, s.lives);
    for (let i = 0; i < slots; i++) {
      const hx = W - 40 - (slots - 1 - i) * 34;
      heart(g, hx, 30, 12, i < s.lives ? COLORS.heart : 0x3c5a60);
    }

    // Water meter
    panel(g, W - 150, 70, 136, 34);
    bucketIcon(g, W - 128, 87);
    const w = s.bucket.water;
    g.fillStyle(w > 30 ? COLORS.water : COLORS.balanceRed);
    drop(g, W - 100, 87, 8);
    this.waterText.setText(`${Math.round(w)}%`);
  }
}

function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(COLORS.hudPanel, 0.92);
  g.fillRoundedRect(x, y, w, h, 8);
  g.lineStyle(2, COLORS.hudBorder, 0.9);
  g.strokeRoundedRect(x, y, w, h, 8);
}

function panelDark(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(COLORS.hudPanel, 0.92);
  g.fillRoundedRect(x, y, w, h, 5);
}

function star(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
  g.fillStyle(0xf2c43d);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillPath();
}

function heart(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number): void {
  g.fillStyle(color);
  g.fillCircle(cx - r / 2, cy - r / 4, r / 1.7);
  g.fillCircle(cx + r / 2, cy - r / 4, r / 1.7);
  g.beginPath();
  g.moveTo(cx - r * 1.05, cy - r / 8);
  g.lineTo(cx, cy + r);
  g.lineTo(cx + r * 1.05, cy - r / 8);
  g.closePath();
  g.fillPath();
}

function bucketIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.bucket);
  g.beginPath();
  g.moveTo(cx - 10, cy - 8);
  g.lineTo(cx + 10, cy - 8);
  g.lineTo(cx + 7, cy + 10);
  g.lineTo(cx - 7, cy + 10);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.8);
  g.beginPath();
  g.arc(cx, cy - 8, 9, Math.PI, 0, false);
  g.strokePath();
}

function drop(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx, cy - r * 1.4);
  g.lineTo(cx + r * 0.9, cy);
  g.arc(cx, cy + r * 0.2, r * 0.9, 0, Math.PI, false);
  g.lineTo(cx, cy - r * 1.4);
  g.closePath();
  g.fillPath();
}
