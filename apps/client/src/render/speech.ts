import Phaser from 'phaser';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

interface Bubble {
  text: string;
  left: number;
  total: number;
}

/** Small comic speech balloons above the two figures, with cooldowns so they never spam. */
export class Speech {
  private readonly bubbles: [Bubble | null, Bubble | null] = [null, null];
  private readonly labels: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly g: Phaser.GameObjects.Graphics;
  private clock = 0;
  private lastAny = -10;
  private lastBy: [number, number] = [-10, -10];
  private lastHint = -10;
  private next: 0 | 1 = 0;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(57);
    const mk = (): Phaser.GameObjects.Text =>
      scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#1b2a30', fontStyle: 'bold' }).setOrigin(0.5).setDepth(58).setVisible(false);
    this.labels = [mk(), mk()];
  }

  reset(): void {
    this.bubbles[0] = this.bubbles[1] = null;
    this.clock = 0;
    this.lastAny = this.lastHint = -10;
    this.lastBy = [-10, -10];
  }

  /** True while player i is "talking" (for the mouth animation). */
  talking(i: number): boolean {
    return this.bubbles[i] !== null;
  }

  mouthOpen(i: number): boolean {
    return this.bubbles[i] !== null && Math.sin(this.clock * 24 + i) > 0;
  }

  /** urgent lines (pain, slips, lost lives) interrupt; hints respect the global cooldown and sometimes stay silent. */
  say(player: 0 | 1 | null, text: string, kind: 'urgent' | 'hint' | 'cheer'): boolean {
    const now = this.clock;
    if (kind === 'urgent') {
      if (now - this.lastAny < 0.6) return false;
    } else if (kind === 'cheer') {
      if (now - this.lastAny < 2.5 || Math.random() < 0.5) return false;
    } else if (now - this.lastAny < 2.2 || now - this.lastHint < 3.5 || Math.random() < 0.25) return false;
    let p: 0 | 1 = player ?? this.next;
    if (player === null && now - this.lastBy[p] < 5) p = p === 0 ? 1 : 0;
    this.next = p === 0 ? 1 : 0;
    const total = 0.9 + text.length * 0.07;
    this.bubbles[p] = { text, left: total, total };
    this.lastAny = now;
    this.lastBy[p] = now;
    if (kind === 'hint') this.lastHint = now;
    this.onSay?.(p, text);
    return true;
  }

  onSay: ((player: 0 | 1, text: string) => void) | null = null;

  update(dt: number, heads: [{ x: number; y: number }, { x: number; y: number }]): void {
    this.clock += dt;
    const g = this.g;
    g.clear();
    for (let i = 0; i < 2; i++) {
      const b = this.bubbles[i];
      const label = this.labels[i]!;
      if (!b) {
        label.setVisible(false);
        continue;
      }
      b.left -= dt;
      if (b.left <= 0) {
        this.bubbles[i] = null;
        label.setVisible(false);
        continue;
      }
      const alpha = Math.min(1, b.left / 0.25);
      const pop = Math.min(1, (b.total - b.left) / 0.12);
      const h = heads[i]!;
      label.setText(b.text);
      const w = label.width + 18;
      const bh = 28;
      const cx = h.x + 6;
      const cy = h.y - 92 - (1 - pop) * 8;
      g.fillStyle(0xffffff, 0.95 * alpha);
      g.lineStyle(2, 0x1b2a30, alpha);
      g.fillRoundedRect(cx - w / 2, cy - bh / 2, w, bh, 10);
      g.strokeRoundedRect(cx - w / 2, cy - bh / 2, w, bh, 10);
      g.fillTriangle(cx - 6, cy + bh / 2 - 1, cx + 6, cy + bh / 2 - 1, cx - 2, cy + bh / 2 + 14);
      g.lineBetween(cx - 6, cy + bh / 2, cx - 2, cy + bh / 2 + 14);
      g.lineBetween(cx + 6, cy + bh / 2, cx - 2, cy + bh / 2 + 14);
      label.setPosition(cx, cy).setAlpha(alpha).setScale(0.6 + 0.4 * pop).setVisible(true);
    }
  }
}
