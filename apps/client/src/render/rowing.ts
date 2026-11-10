import Phaser from 'phaser';
import { bridgeCeiling, ROW, rowSpeedMs, type GameEvent, type GameState, type RowBridge } from '@dd/sim';
import { GAME_H, PX } from '../config';
import { RIGGER_AT, drawSkiff, type Dol } from './ladder';
import type { View } from './view';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Screen y of the water line where the skiff floats, and of the far bank. */
export const WATER_Y = 420;
const BANK_Y = 326;
const HULL_PX = 520;
const DOL_TO_TIP = 76;
const OAR_OUT = 112;
const OAR_IN = 52;
const LIFT_PX = 170;
/** Screen y of the visible-side dol while the hull floats at rest. */
const DOL_Y = WATER_Y - 40;
const BOAT_CX = 0;

const BLUE = 0x2a6ebb;
const YELLOW = 0xf2a900;
const WHITE = 0xf4f4ee;

export const raceClock = (sec: number): string => {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
};

const hash = (n: number): number => {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Cyclist {
  x: number;
  text: string;
  said: boolean;
  sayAt: number;
  talk: number;
  phase: number;
}

type Pt = [number, number];

/** The whole rowing race scene: canal, far bank, bridges, the skiff with two rowers, and the people on the towpath. */
export class RowingView {
  private readonly gBack: Phaser.GameObjects.Graphics;
  private readonly gMid: Phaser.GameObjects.Graphics;
  private readonly gFront: Phaser.GameObjects.Graphics;
  private readonly gHud: Phaser.GameObjects.Graphics;
  private readonly startText: Phaser.GameObjects.Text;
  private readonly finishText: Phaser.GameObjects.Text;
  private readonly cycleText: Phaser.GameObjects.Text;
  private readonly speedText: Phaser.GameObjects.Text;
  private readonly syncText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly bridgeText: Phaser.GameObjects.Text;
  private clock = 0;
  private cyclist: Cyclist | null = null;
  private nextCyclist = 4;
  private hinted = new Set<string>();
  private lastSyncHint = -20;
  private lastFastHint = -20;
  private lowSyncFor = 0;
  private gone = new Set<number>();
  private goneBuoy = new Set<number>();
  private flung: Array<{ x: number; t: number; kind: 'duck' | 'buoy' }> = [];
  private wobble = new Map<number, number>();
  private foam: Array<{ x: number; t: number; r: number }> = [];
  private rings: Array<{ x: number; y: number; t: number }> = [];
  private smoke: Array<{ x: number; y: number; t: number }> = [];
  private blades: [Pt, Pt] = [
    [0, 0],
    [0, 0],
  ];
  private heads: [Pt, Pt] = [
    [0, 0],
    [0, 0],
  ];
  private lastX = 0;
  private lastTick = 0;
  /** Set when the cyclist shouts; the scene plays the megaphone sound. */
  onShout: ((text: string) => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.gBack = scene.add.graphics().setDepth(1);
    this.gMid = scene.add.graphics().setDepth(10);
    this.gFront = scene.add.graphics().setDepth(10.9);
    this.gHud = scene.add.graphics().setDepth(51);
    const txt = (size: number, color: string, depth: number, stroke = 0): Phaser.GameObjects.Text =>
      scene.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold', stroke: '#102024', strokeThickness: stroke })
        .setOrigin(0.5)
        .setDepth(depth)
        .setVisible(false);
    this.startText = txt(11, '#ffffff', 9.5);
    this.finishText = txt(15, '#ffffff', 10.8, 4);
    this.cycleText = txt(17, '#1b2a30', 59);
    this.speedText = txt(18, '#ffffff', 52, 3);
    this.syncText = txt(12, '#ffffff', 52, 3);
    this.timeText = txt(18, '#ffd36b', 52, 3);
    this.bridgeText = txt(12, '#ffffff', 52, 3);
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    for (const g of [this.gBack, this.gMid, this.gFront, this.gHud]) {
      g.setVisible(on);
      if (!on) g.clear();
    }
    if (!on) for (const t of [this.startText, this.finishText, this.cycleText, this.speedText, this.syncText, this.timeText, this.bridgeText]) t.setVisible(false);
  }

  reset(): void {
    this.clock = 0;
    this.cyclist = null;
    this.nextCyclist = 4;
    this.hinted.clear();
    this.gone.clear();
    this.goneBuoy.clear();
    this.flung = [];
    this.wobble.clear();
    this.foam = [];
    this.rings = [];
    this.smoke = [];
    this.lowSyncFor = 0;
    this.lastSyncHint = this.lastFastHint = -20;
    this.lastTick = 0;
  }

  bladePos(i: 0 | 1): Pt {
    return this.blades[i];
  }

  headPos(): [Pt, Pt] {
    return this.heads;
  }

  /** Client-side bookkeeping for things that vanish or fly off. */
  onEvent(e: GameEvent): void {
    const key = Math.round((e.x ?? 0) * 100);
    if (e.type === 'duckHit') {
      this.gone.add(key);
      this.flung.push({ x: e.x ?? 0, t: 0, kind: 'duck' });
    } else if (e.type === 'buoyPop') {
      this.goneBuoy.add(key);
      this.flung.push({ x: e.x ?? 0, t: 0, kind: 'buoy' });
    } else if (e.type === 'buoyBounce') {
      this.wobble.set(key, 0);
    } else if (e.type === 'respawn') {
      const cp = e.x ?? 0;
      for (const k of [...this.gone]) if (k / 100 >= cp - 3) this.gone.delete(k);
      for (const k of [...this.goneBuoy]) if (k / 100 >= cp - 3) this.goneBuoy.delete(k);
      this.flung = [];
    } else if (e.type === 'gun') {
      this.smoke.push({ x: 0, y: 0, t: 0 });
    }
  }

  draw(s: GameState, view: View, dt: number, W: number, mouth: (i: 0 | 1) => boolean): void {
    const r = s.row!;
    this.clock += dt;
    const now = this.clock;
    const gb = this.gBack;
    const gm = this.gMid;
    const gf = this.gFront;
    gb.clear();
    gm.clear();
    gf.clear();
    for (const t of [this.startText, this.finishText, this.cycleText]) t.setVisible(false);

    const cam = view.camX * PX;
    this.drawBackdrop(gb, cam, W, now);
    this.drawBank(gb, s, view, W, now);
    for (const br of r.bridges) this.drawBridge(gb, br, view, W);

    // Finish line across the water.
    const fx = view.sx(s.levelLength - 2);
    if (fx > -30 && fx < W + 30) {
      for (let y = BANK_Y + 6, k = 0; y < GAME_H; y += 12, k++) {
        gb.fillStyle(k % 2 ? 0x1b2a30 : 0xffffff, 0.9);
        gb.fillRect(fx - 6, y, 6, 12);
        gb.fillStyle(k % 2 ? 0xffffff : 0x1b2a30, 0.9);
        gb.fillRect(fx, y, 6, 12);
      }
    }

    // Floating obstacles.
    for (const d of r.ducks) {
      const sx = view.sx(d.x);
      if (sx < -60 || sx > W + 60 || this.gone.has(Math.round(d.x * 100))) continue;
      this.drawDuck(gm, sx, WATER_Y + 6 + Math.sin(now * 2.2 + d.x) * 2, 1);
    }
    for (const b of r.buoys) {
      const sx = view.sx(b.x);
      if (sx < -60 || sx > W + 60 || b.done || this.goneBuoy.has(Math.round(b.x * 100))) continue;
      const wob = this.wobble.get(Math.round(b.x * 100));
      const w = wob === undefined ? 0 : Math.max(0, 1 - wob * 1.6) * Math.sin(wob * 26) * 0.5;
      this.drawBuoy(gm, sx, WATER_Y + 8 + Math.sin(now * 1.8 + b.x) * 2, w + Math.sin(now * 1.4 + b.x) * 0.05);
    }
    for (const f of this.flung) {
      f.t += dt;
      const sx = view.sx(f.x) + f.t * (f.kind === 'duck' ? 170 : 40);
      const sy = WATER_Y - 20 - 260 * f.t + 520 * f.t * f.t;
      if (f.kind === 'duck') this.drawDuck(gm, sx, sy, 1, f.t * 9);
      else this.drawBuoy(gm, sx, sy, f.t * 7);
    }
    this.flung = this.flung.filter((f) => f.t < 1.1);
    for (const k of this.wobble.keys()) {
      const t = (this.wobble.get(k) ?? 0) + dt;
      if (t > 0.7) this.wobble.delete(k);
      else this.wobble.set(k, t);
    }

    // Skiff.
    const sx0 = view.sx(r.x) + BOAT_CX;
    const lift = r.jumpY * 95;
    const bob = Math.sin(now * 2.1) * 1.5;
    const ang = Math.max(-0.35, Math.min(0.35, r.roll * 0.7));
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const cy = WATER_Y - 8 + bob - lift;
    const x0 = sx0 - ux * (HULL_PX / 2);
    const y0 = cy - uy * (HULL_PX / 2);
    const dols = drawSkiff(gm, x0, y0, ux, uy, HULL_PX, 100 - Math.max(0, Math.min(100, s.bucket.water)));
    const nx = uy;
    const ny = -ux;
    for (let i = 0; i < 2; i++) this.drawRower(gm, i as 0 | 1, dols[i]!, ux, uy, nx, ny, r.rowers[i]!, r.started, mouth(i as 0 | 1), now);

    // Water in front of the skiff, wake, ripples.
    gf.fillStyle(0x2f86cf, 0.5);
    gf.fillRect(0, WATER_Y + 8, W, GAME_H - WATER_Y - 8);
    gf.fillStyle(0xffffff, 0.35);
    for (let i = 0; i < 9; i++) {
      const wx = (((i * 173 - cam * 1.0) % (W + 200)) + W + 200) % (W + 200) - 100;
      const wy = WATER_Y + 22 + hash(i + 3) * 90;
      gf.fillRect(wx, wy, 30 + hash(i) * 40, 2);
    }
    const bowX = sx0 + HULL_PX / 2;
    const tailX = sx0 - HULL_PX / 2;
    const speedFx = Math.min(1, Math.max(0, r.v) / 3.5);
    gf.lineStyle(3, 0xffffff, 0.35 + speedFx * 0.45);
    gf.lineBetween(tailX + 10, WATER_Y + 9, bowX - 24, WATER_Y + 9);
    for (let i = 0; i < 4; i++) {
      const wx = bowX - 24 + i * 8 * speedFx;
      gf.lineStyle(2, 0xffffff, (0.5 - i * 0.1) * speedFx);
      gf.lineBetween(wx, WATER_Y + 9, wx + 22 + i * 6, WATER_Y + 16 + i * 4);
    }
    if (s.tick !== this.lastTick && r.v > 0.8 && s.tick % 6 === 0) this.foam.push({ x: r.x - 2.5, t: 0, r: 6 });
    this.lastTick = s.tick;
    this.lastX = r.x;
    for (const f of this.foam) {
      f.t += dt;
      const a = Math.max(0, 0.55 - f.t * 0.45);
      gf.lineStyle(2, 0xffffff, a);
      gf.strokeEllipse(view.sx(f.x), WATER_Y + 10, f.r + f.t * 40, 5 + f.t * 6);
    }
    this.foam = this.foam.filter((f) => f.t < 1.2);
    for (const rg of this.rings) {
      rg.t += dt;
      gf.lineStyle(2, 0xffffff, Math.max(0, 0.7 - rg.t * 1.3));
      gf.strokeEllipse(rg.x, rg.y, 10 + rg.t * 60, 4 + rg.t * 14);
    }
    this.rings = this.rings.filter((q) => q.t < 0.55);

    this.drawStarter(gb, s, view, W, now, dt);
    this.drawFinisher(gb, s, view, W, now);
    this.updateCyclist(gb, gf, s, view, W, dt, now);
    this.drawHud(s, W);
  }

  private drawBackdrop(g: Phaser.GameObjects.Graphics, cam: number, W: number, now: number): void {
    const bands = ['#7ec8ee', '#8fd0f2', '#a3d9f5', '#b8e2f7', '#cdebf9', '#dff3fb'];
    const h = 300 / bands.length;
    bands.forEach((c, i) => {
      g.fillStyle(Phaser.Display.Color.HexStringToColor(c).color, 1);
      g.fillRect(0, i * h, W, h + 1);
    });
    g.fillStyle(0xffffff, 0.8);
    for (let i = 0; i < 7; i++) {
      const cx = ((((i * 330 + now * 6 - cam * 0.08) % (W + 400)) + W + 400) % (W + 400)) - 200;
      const cyy = 70 + hash(i + 11) * 110;
      g.fillEllipse(cx, cyy, 110, 26);
      g.fillEllipse(cx + 28, cyy - 12, 70, 26);
      g.fillEllipse(cx - 30, cyy - 8, 60, 22);
    }
    g.fillStyle(0xf8e08a, 0.9);
    g.fillCircle(W - 150, 78, 30);
    g.fillStyle(0x9ccaa0, 1);
    g.beginPath();
    g.moveTo(0, BANK_Y);
    for (let x = 0; x <= W + 20; x += 20) {
      const wx = x + cam * 0.15;
      g.lineTo(x, 262 - 28 * Math.sin(wx * 0.006) - 14 * Math.sin(wx * 0.017 + 1));
    }
    g.lineTo(W + 20, BANK_Y);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x6fb26a, 1);
    g.fillRect(0, 290, W, BANK_Y - 290);
    g.fillStyle(0xcdb98c, 1);
    g.fillRect(0, 314, W, 16);
    g.fillStyle(0x4f9a52, 1);
    g.fillRect(0, 306, W, 8);
    const water = [0x3f9ad8, 0x3a92d2, 0x348acb, 0x2f82c3, 0x2a79ba, 0x2672b2];
    const wh = (GAME_H - 330) / water.length;
    water.forEach((c, i) => {
      g.fillStyle(c, 1);
      g.fillRect(0, 330 + i * wh, W, wh + 1);
    });
    g.fillStyle(0xffffff, 0.25);
    for (let i = 0; i < 16; i++) {
      const wx = ((((i * 131 - cam * 0.9 + Math.sin(now + i) * 6) % (W + 200)) + W + 200) % (W + 200)) - 100;
      g.fillRect(wx, 340 + hash(i + 40) * 180, 18 + hash(i) * 30, 2);
    }
  }

  /** Trees, reeds and lamp posts on the far bank, with parallax slightly slower than the water. */
  private drawBank(g: Phaser.GameObjects.Graphics, s: GameState, view: View, W: number, _now: number): void {
    const cam = view.camX * PX;
    const par = 0.8;
    const first = Math.floor((cam * par) / 150) - 1;
    const last = Math.ceil((cam * par + W) / 150) + 1;
    for (let k = first; k <= last; k++) {
      const x = k * 150 - cam * par + hash(k) * 60;
      const kind = hash(k + 77);
      if (kind < 0.55) {
        const hgt = 42 + hash(k + 5) * 36;
        g.fillStyle(0x6b4a2b, 1);
        g.fillRect(x - 3, BANK_Y - 22 - hgt * 0.4, 6, hgt * 0.5);
        g.fillStyle(kind < 0.3 ? 0x3d8f4a : 0x4fa65a, 1);
        g.fillCircle(x, BANK_Y - 30 - hgt * 0.7, 18 + hash(k + 9) * 8);
        g.fillCircle(x + 14, BANK_Y - 22 - hgt * 0.6, 14);
        g.fillCircle(x - 13, BANK_Y - 22 - hgt * 0.55, 13);
      } else if (kind < 0.8) {
        g.fillStyle(0x3f7a3c, 1);
        for (let i = 0; i < 5; i++) g.fillRect(x + i * 5 - 12, BANK_Y - 6 - (i % 2) * 8 - hash(k + i) * 8, 2, 14);
      } else {
        g.fillStyle(0x3b3f45, 1);
        g.fillRect(x - 2, BANK_Y - 52, 4, 44);
        g.fillStyle(0xfff0b0, 1);
        g.fillCircle(x, BANK_Y - 54, 6);
      }
    }
    void s;
  }

  private bridgeTop(br: RowBridge, u: number): number {
    return DOL_Y + DOL_TO_TIP - LIFT_PX * bridgeCeiling(br.kind, u) - 5;
  }

  private drawBridge(g: Phaser.GameObjects.Graphics, br: RowBridge, view: View, W: number): void {
    const xa = view.sx(br.x0);
    const xb = view.sx(br.x1);
    if (xb < -20 || xa > W + 20) return;
    const wpx = xb - xa;
    const cols: Array<{ top: number; x: number }> = [];
    for (let x = 0; x <= wpx + 0.1; x += 8) cols.push({ x: xa + x, top: this.bridgeTop(br, x / wpx) });
    const thick = br.kind === 'low' ? 46 : br.kind === 'wood' ? 22 : br.kind === 'arch' ? 70 : 90;
    const face = br.kind === 'low' ? 0x9aa3ac : br.kind === 'wood' ? 0x8a5a2e : br.kind === 'arch' ? 0xb4553f : 0x8f98a0;
    const dark = br.kind === 'low' ? 0x6b747d : br.kind === 'wood' ? 0x5e3a1c : br.kind === 'arch' ? 0x7d3626 : 0x5f676e;
    g.fillStyle(face, 1);
    g.beginPath();
    g.moveTo(cols[0]!.x, cols[0]!.top - thick);
    for (const c of cols) g.lineTo(c.x, c.top - thick);
    g.lineTo(xb, cols[cols.length - 1]!.top - thick);
    for (let i = cols.length - 1; i >= 0; i--) g.lineTo(cols[i]!.x, cols[i]!.top);
    g.closePath();
    g.fillPath();
    // Shadow under the deck.
    g.fillStyle(0x000000, 0.28);
    g.beginPath();
    g.moveTo(cols[0]!.x, cols[0]!.top);
    for (const c of cols) g.lineTo(c.x, c.top);
    for (let i = cols.length - 1; i >= 0; i--) g.lineTo(cols[i]!.x, cols[i]!.top + 12);
    g.closePath();
    g.fillPath();
    const topY = Math.min(...cols.map((c) => c.top)) - thick;
    g.lineStyle(3, dark, 1);
    g.beginPath();
    cols.forEach((c, i) => (i === 0 ? g.moveTo(c.x, c.top) : g.lineTo(c.x, c.top)));
    g.strokePath();
    if (br.kind === 'low') {
      g.fillStyle(0x6b747d, 1);
      g.fillRect(xa - 6, topY - 6, wpx + 12, 8);
      g.fillStyle(0xf2a900, 1);
      for (let x = xa; x < xb; x += 24) g.fillRect(x, topY - 14, 4, 8);
      g.fillStyle(0xf2a900, 1);
      g.fillRect(xa, topY - 16, wpx, 3);
    } else if (br.kind === 'wood') {
      g.lineStyle(3, dark, 1);
      for (let x = xa + 10; x < xb; x += 22) g.lineBetween(x, topY, x, cols[Math.floor(((x - xa) / wpx) * (cols.length - 1))]!.top);
      g.fillStyle(0x6b4426, 1);
      g.fillRect(xa - 8, topY - 30, 6, 32);
      g.fillRect(xb + 2, topY - 30, 6, 32);
      g.fillRect(xa - 8, topY - 28, wpx + 16, 4);
      g.fillRect(xa - 8, topY - 14, wpx + 16, 4);
    } else if (br.kind === 'arch') {
      g.lineStyle(2, dark, 1);
      for (let y = topY + 12; y < cols[0]!.top + 10; y += 14) g.lineBetween(xa, y, xb, y);
      for (let x = xa + 8; x < xb; x += 24) g.lineBetween(x, topY, x, topY + 14);
      g.fillStyle(0xe6d3a8, 1);
      g.fillRect(xa + wpx / 2 - 9, topY + 4, 18, 22);
      g.fillStyle(dark, 1);
      g.fillRect(xa - 4, topY - 8, wpx + 8, 10);
    } else {
      g.lineStyle(2, dark, 1);
      for (let y = topY + 14; y < topY + thick; y += 18) g.lineBetween(xa, y, xb, y);
      g.fillStyle(0x5f676e, 1);
      g.fillRect(xa - 6, topY - 12, wpx + 12, 14);
      for (let x = xa - 6; x < xb + 6; x += 22) g.fillRect(x, topY - 24, 12, 12);
    }
  }

  private drawDuck(g: Phaser.GameObjects.Graphics, x: number, y: number, k: number, spin = 0): void {
    const c = Math.cos(spin);
    const sn = Math.sin(spin);
    const p = (dx: number, dy: number): Pt => [x + (dx * c - dy * sn) * k, y + (dx * sn + dy * c) * k];
    const b = p(0, -12);
    g.fillStyle(0xf7d23e, 1);
    g.fillEllipse(b[0], b[1], 44 * k, 26 * k);
    const hd = p(-16, -28);
    g.fillCircle(hd[0], hd[1], 10 * k);
    g.fillStyle(0xe8b92b, 1);
    const w = p(4, -14);
    g.fillEllipse(w[0], w[1], 24 * k, 13 * k);
    g.fillStyle(0xf28c28, 1);
    const b0 = p(-24, -30);
    const b1 = p(-34, -26);
    const b2 = p(-24, -23);
    g.fillTriangle(b0[0], b0[1], b1[0], b1[1], b2[0], b2[1]);
    g.fillStyle(0x1b2a30, 1);
    const e = p(-19, -31);
    g.fillCircle(e[0], e[1], 1.8 * k);
    g.fillStyle(0xffffff, 0.35);
    g.fillEllipse(x, y + 2, 52 * k, 6 * k);
  }

  private drawBuoy(g: Phaser.GameObjects.Graphics, x: number, y: number, tilt: number): void {
    const c = Math.cos(tilt);
    const sn = Math.sin(tilt);
    const p = (dx: number, dy: number): Pt => [x + dx * c - dy * sn, y + dx * sn + dy * c];
    const poly = (pts: Pt[], color: number): void => {
      g.fillStyle(color, 1);
      g.beginPath();
      pts.forEach((q, i) => (i === 0 ? g.moveTo(q[0], q[1]) : g.lineTo(q[0], q[1])));
      g.closePath();
      g.fillPath();
    };
    poly([p(-15, 0), p(15, 0), p(10, -17), p(-10, -17)], 0xe53935);
    poly([p(-10, -17), p(10, -17), p(6, -32), p(-6, -32)], 0xffffff);
    poly([p(-6, -32), p(6, -32), p(3, -42), p(-3, -42)], 0xe53935);
    const t = p(0, -46);
    g.fillStyle(YELLOW, 1);
    g.fillCircle(t[0], t[1], 5);
    g.fillStyle(0xffffff, 0.4);
    g.fillEllipse(x, y + 3, 40, 6);
  }

  /** Two-bone IK knee: hip to foot, knee bent toward the boat's "up" direction. */
  private knee(hip: Pt, foot: Pt, a: number, b: number, nx: number, ny: number): Pt {
    const dx = foot[0] - hip[0];
    const dy = foot[1] - hip[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.min(a + b - 0.5, Math.max(Math.abs(a - b) + 0.5, len));
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    const ex = dx / len;
    const ey = dy / len;
    const sgn = -ey * nx + ex * ny >= 0 ? 1 : -1;
    return [hip[0] + ex * along - ey * h * sgn, hip[1] + ey * along + ex * h * sgn];
  }

  private drawRower(
    g: Phaser.GameObjects.Graphics,
    i: 0 | 1,
    dol: Dol,
    ux: number,
    uy: number,
    nx: number,
    ny: number,
    w: { a: number; lift: number; drive: boolean },
    started: boolean,
    talking: boolean,
    now: number,
  ): void {
    const shirt = i === 0 ? 0x2d63d8 : 0xcf3a2f;
    const shirtDark = i === 0 ? 0x1f448f : 0x8d251d;
    const at = (du: number, dn: number): Pt => [dol.x + ux * du + nx * dn, dol.y + uy * du + ny * dn];
    const phi = (0.5 - w.a) * 1.7;
    const dropN = -DOL_TO_TIP + LIFT_PX * w.lift;
    const outLen = Math.hypot(OAR_OUT * Math.sin(phi), dropN);
    const tipU = OAR_OUT * Math.sin(phi);
    const dirU = tipU / outLen;
    const dirN = dropN / outLen;
    const tip = at(tipU, dropN);
    const handle = at(-dirU * OAR_IN, Math.max(-dirN * OAR_IN, -24));
    this.blades[i] = tip;

    // Far legs and oar shaft first, then the body.
    const hipBase = -(DOL_TO_TIP * 0.0) + 30;
    const hip = at(hipBase + (w.a - 0.5) * 34, -22);
    const foot = at(hipBase - 50, -30);
    const knee = this.knee(hip, foot, 30, 30, nx, ny);
    g.lineStyle(9, shirtDark, 1);
    g.lineBetween(hip[0], hip[1], knee[0], knee[1]);
    g.lineBetween(knee[0], knee[1], foot[0], foot[1]);
    g.fillStyle(0x2a2a2e, 1);
    g.fillEllipse(foot[0] - ux * 5, foot[1] - uy * 5, 14, 8);

    // Oar: shaft from the handle through the dol to the blade.
    g.lineStyle(5, 0x3b3f45, 1);
    g.lineBetween(handle[0], handle[1], tip[0], tip[1]);
    g.lineBetween(dol.x, dol.y, tip[0], tip[1]);
    g.lineStyle(7, 0xf2a900, 1);
    g.lineBetween(handle[0], handle[1], handle[0] - (tip[0] - dol.x) / outLen * 14, handle[1] - (tip[1] - dol.y) / outLen * 14);
    const bx = tip[0];
    const by = tip[1];
    const dX = (tip[0] - dol.x) / outLen;
    const dY = (tip[1] - dol.y) / outLen;
    const pX = -dY;
    const pY = dX;
    const blade = (a0: number, a1: number, half: number, color: number): void => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(bx - dX * a0 + pX * half, by - dY * a0 + pY * half);
      g.lineTo(bx - dX * a1 + pX * half, by - dY * a1 + pY * half);
      g.lineTo(bx - dX * a1 - pX * half, by - dY * a1 - pY * half);
      g.lineTo(bx - dX * a0 - pX * half, by - dY * a0 - pY * half);
      g.closePath();
      g.fillPath();
    };
    blade(-4, 40, 7, 0xe9eceb);
    blade(10, 16, 7, BLUE);
    blade(18, 22, 7, YELLOW);
    blade(24, 30, 7, BLUE);
    g.fillStyle(0x3b3f45, 1);
    g.fillCircle(dol.x, dol.y, 3);

    // Torso, head, arms.
    const lean = (w.a - 0.5) * 0.95 + 0.05;
    const sh: Pt = [hip[0] + 46 * Math.sin(lean) * ux + (46 * Math.cos(lean)) * nx, hip[1] + 46 * Math.sin(lean) * uy + 46 * Math.cos(lean) * ny];
    g.lineStyle(17, shirt, 1);
    g.lineBetween(hip[0], hip[1], sh[0], sh[1]);
    g.fillStyle(0x1b2a30, 1);
    g.fillRoundedRect(hip[0] - 9, hip[1] - 5, 18, 9, 3);
    const head: Pt = [sh[0] + 15 * Math.sin(lean * 0.7) * ux + 15 * nx - 4 * ux, sh[1] + 15 * Math.sin(lean * 0.7) * uy + 15 * ny - 4 * uy];
    this.heads[i] = [head[0], head[1]];
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(head[0], head[1], 10);
    g.fillStyle(i === 0 ? 0x1f448f : 0x8d251d, 1);
    g.fillCircle(head[0] + ux * 1, head[1] + uy * 1 - 3, 10.5);
    g.fillStyle(0xe9b58c, 1);
    g.fillRect(head[0] - 11, head[1] - 1, 22, 11);
    g.fillCircle(head[0], head[1] + 4, 9);
    g.fillStyle(i === 0 ? 0x1f448f : 0x8d251d, 1);
    g.fillRect(head[0] - 18, head[1] - 4, 11, 4);
    g.fillStyle(0x1b2a30, 1);
    g.fillCircle(head[0] - 5, head[1] + 1, 1.8);
    if (talking) g.fillEllipse(head[0] - 8, head[1] + 7, 5, 4);
    const el: Pt = [(sh[0] + handle[0]) / 2 + nx * -7 * (1 - Math.min(1, Math.hypot(handle[0] - sh[0], handle[1] - sh[1]) / 50)) * 2, (sh[1] + handle[1]) / 2 + ny * -7 * (1 - Math.min(1, Math.hypot(handle[0] - sh[0], handle[1] - sh[1]) / 50)) * 2 + 4];
    g.lineStyle(7, shirt, 1);
    g.lineBetween(sh[0], sh[1], el[0], el[1]);
    g.lineBetween(el[0], el[1], handle[0], handle[1]);
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(handle[0], handle[1], 4.5);
    void started;
    void now;
  }

  private drawPerson(g: Phaser.GameObjects.Graphics, x: number, feet: number, k: number, shirt: number, cap: number, trousers: number, face: -1 | 1): { head: Pt; hand: Pt } {
    g.fillStyle(0x1b2a30, 1);
    g.fillEllipse(x, feet, 22 * k, 6 * k);
    g.lineStyle(7 * k, trousers, 1);
    g.lineBetween(x - 4 * k, feet - 4 * k, x - 4 * k, feet - 24 * k);
    g.lineBetween(x + 4 * k, feet - 4 * k, x + 4 * k, feet - 24 * k);
    g.fillStyle(shirt, 1);
    g.fillRoundedRect(x - 9 * k, feet - 50 * k, 18 * k, 28 * k, 5 * k);
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(x, feet - 58 * k, 8.5 * k);
    g.fillStyle(cap, 1);
    g.fillRect(x - 9 * k, feet - 67 * k, 18 * k, 6 * k);
    g.fillRect(x + (face > 0 ? 4 : -13) * k, feet - 62 * k, 9 * k, 3 * k);
    g.fillStyle(0x1b2a30, 1);
    g.fillCircle(x + face * 3.5 * k, feet - 58 * k, 1.4 * k);
    return { head: [x, feet - 66 * k], hand: [x + face * 14 * k, feet - 44 * k] };
  }

  private drawStarter(g: Phaser.GameObjects.Graphics, s: GameState, view: View, W: number, now: number, dt: number): void {
    const r = s.row!;
    const x = view.sx(7.4);
    if (x < -80 || x > W + 80) return;
    const k = 0.95;
    const feet = BANK_Y + 2;
    const sinceGun = (s.tick - r.gunTick) / 60;
    const ready = Math.min(1, Math.max(0, (s.tick - (r.gunTick - 90)) / 40));
    const p = this.drawPerson(g, x, feet, k, 0xf2f2f2, 0x1b2a30, 0x2a2e36, -1);
    g.fillStyle(0xc0392b, 1);
    g.fillRect(x - 9 * k, feet - 46 * k, 18 * k, 6 * k);
    const sh: Pt = [x - 6 * k, feet - 46 * k];
    const hand: Pt = [x - (14 + 10 * ready) * k, feet - (34 + 36 * ready) * k];
    g.lineStyle(6 * k, 0xf2f2f2, 1);
    g.lineBetween(sh[0], sh[1], hand[0], hand[1]);
    g.lineStyle(5 * k, 0xf2f2f2, 1);
    g.lineBetween(x + 6 * k, feet - 46 * k, x + 10 * k, feet - 30 * k);
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(hand[0], hand[1], 3.5 * k);
    g.fillStyle(0x2a2e36, 1);
    g.fillRect(hand[0] - 14 * k, hand[1] - 6 * k, 14 * k, 5 * k);
    g.fillRect(hand[0] - 4 * k, hand[1] - 2 * k, 4 * k, 8 * k);
    const muzzle: Pt = [hand[0] - 14 * k, hand[1] - 3.5 * k];
    if (sinceGun >= 0 && sinceGun < 0.15) {
      g.fillStyle(0xffe07a, 1);
      g.fillCircle(muzzle[0] - 6, muzzle[1], 11);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(muzzle[0] - 5, muzzle[1], 5);
    }
    for (const sm of this.smoke) {
      sm.t += dt;
      g.fillStyle(0xffffff, Math.max(0, 0.6 - sm.t * 0.35));
      g.fillCircle(muzzle[0] - 12 - sm.t * 10, muzzle[1] - sm.t * 26, 6 + sm.t * 9);
    }
    this.smoke = this.smoke.filter((q) => q.t < 1.7);
    if (sinceGun >= 0 && sinceGun < 3) {
      const out = Math.min(1, sinceGun / 0.18);
      const fade = sinceGun > 2.4 ? 1 - (sinceGun - 2.4) / 0.6 : 1;
      const fx = muzzle[0] - 4 - 26 * out;
      g.lineStyle(2, 0x6b4426, fade);
      g.lineBetween(muzzle[0], muzzle[1], fx, muzzle[1] - 4);
      const flap = Math.sin(now * 12) * 2;
      g.fillStyle(0xe53935, fade);
      g.beginPath();
      g.moveTo(fx, muzzle[1] - 4);
      g.lineTo(fx - 50 * out, muzzle[1] - 6 + flap);
      g.lineTo(fx - 50 * out, muzzle[1] - 28 + flap);
      g.lineTo(fx, muzzle[1] - 24);
      g.closePath();
      g.fillPath();
      this.startText.setText('START').setPosition(fx - 25 * out, muzzle[1] - 16 + flap / 2).setScale(out).setAlpha(fade).setVisible(true);
    }
    void p;
  }

  private drawFinisher(g: Phaser.GameObjects.Graphics, s: GameState, view: View, W: number, now: number): void {
    const line = view.sx(s.levelLength - 2);
    if (line < -100 || line > W + 100) return;
    g.fillStyle(0x3b3f45, 1);
    g.fillRect(line - 5, BANK_Y - 74, 5, 76);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle((i + j) % 2 ? 0x1b2a30 : 0xffffff, 1);
        g.fillRect(line + i * 9, BANK_Y - 74 + j * 9, 9, 9);
      }
    }
    const x = line + 56;
    const k = 0.95;
    const feet = BANK_Y + 2;
    this.drawPerson(g, x, feet, k, 0x3d8f4a, 0xf2a900, 0x2a2e36, -1);
    const done = s.finished;
    const hand: Pt = [x - 12 * k, feet - (done ? 80 : 56) * k];
    g.lineStyle(6 * k, 0x3d8f4a, 1);
    g.lineBetween(x - 6 * k, feet - 46 * k, hand[0], hand[1]);
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(hand[0], hand[1], 3.5 * k);
    g.fillStyle(0xeceff1, 1);
    g.fillCircle(hand[0] - 2, hand[1] - 9, 8);
    g.lineStyle(2, 0x1b2a30, 1);
    g.strokeCircle(hand[0] - 2, hand[1] - 9, 8);
    const a = done ? 0.4 : now * 3;
    g.lineBetween(hand[0] - 2, hand[1] - 9, hand[0] - 2 + Math.sin(a) * 5, hand[1] - 9 - Math.cos(a) * 5);
    g.fillStyle(0xe53935, 1);
    g.fillRect(hand[0] - 4, hand[1] - 20, 4, 3);
    g.lineStyle(5 * k, 0x3d8f4a, 1);
    g.lineBetween(x + 6 * k, feet - 46 * k, x + 8 * k, feet - 30 * k);
    if (done && s.result) this.finishText.setText(raceClock(s.result.time)).setPosition(x - 6, feet - 112).setVisible(true);
  }

  /** Cyclist on the towpath: appears now and then and shouts a hint through a megaphone. */
  private updateCyclist(g: Phaser.GameObjects.Graphics, gf: Phaser.GameObjects.Graphics, s: GameState, view: View, W: number, dt: number, now: number): void {
    const r = s.row!;
    if (!this.cyclist && r.started && !s.finished && now > this.nextCyclist) {
      const text = this.pickHint(s, now);
      if (text) this.cyclist = { x: -80, text, said: false, sayAt: W * (0.18 + Math.random() * 0.2), talk: 0, phase: 0 };
    }
    const c = this.cyclist;
    if (!c) return;
    c.x += (200 + Math.max(0, r.v) * 30) * dt;
    c.phase += dt * 9;
    if (!c.said && c.x >= c.sayAt) {
      c.said = true;
      c.talk = 2.6;
      this.onShout?.(c.text);
    }
    c.talk = Math.max(0, c.talk - dt);
    const feet = BANK_Y + 4;
    const k = 0.8;
    const x = c.x;
    const wheel = (wx: number): void => {
      g.lineStyle(2, 0x1b2a30, 1);
      g.strokeCircle(wx, feet - 11 * k, 11 * k);
      for (let i = 0; i < 4; i++) {
        const a = c.phase + (i * Math.PI) / 2;
        g.lineBetween(wx, feet - 11 * k, wx + Math.cos(a) * 11 * k, feet - 11 * k + Math.sin(a) * 11 * k);
      }
    };
    wheel(x - 16 * k);
    wheel(x + 16 * k);
    g.lineStyle(3, 0xc0392b, 1);
    g.lineBetween(x - 16 * k, feet - 11 * k, x - 2 * k, feet - 26 * k);
    g.lineBetween(x - 2 * k, feet - 26 * k, x + 12 * k, feet - 26 * k);
    g.lineBetween(x + 12 * k, feet - 26 * k, x + 16 * k, feet - 11 * k);
    g.lineBetween(x - 2 * k, feet - 26 * k, x + 2 * k, feet - 11 * k);
    g.lineBetween(x + 12 * k, feet - 26 * k, x + 10 * k, feet - 34 * k);
    g.lineStyle(7 * k, 0x2a2e36, 1);
    const pa = c.phase;
    g.lineBetween(x - 2 * k, feet - 36 * k, x + 2 * k + Math.cos(pa) * 7 * k, feet - 11 * k + Math.sin(pa) * 7 * k);
    g.lineBetween(x - 2 * k, feet - 36 * k, x + 2 * k - Math.cos(pa) * 7 * k, feet - 11 * k - Math.sin(pa) * 7 * k);
    g.fillStyle(0x3d8f4a, 1);
    g.fillRoundedRect(x - 8 * k, feet - 62 * k, 18 * k, 28 * k, 5 * k);
    g.fillStyle(0xe9b58c, 1);
    g.fillCircle(x + 7 * k, feet - 68 * k, 8 * k);
    g.fillStyle(0xf2a900, 1);
    g.fillRect(x - 1 * k, feet - 77 * k, 17 * k, 6 * k);
    g.lineStyle(6 * k, 0x3d8f4a, 1);
    g.lineBetween(x + 6 * k, feet - 56 * k, x + 18 * k, feet - 60 * k);
    g.fillStyle(0xdddddd, 1);
    g.beginPath();
    g.moveTo(x + 16 * k, feet - 66 * k);
    g.lineTo(x + 38 * k, feet - 76 * k);
    g.lineTo(x + 38 * k, feet - 50 * k);
    g.lineTo(x + 16 * k, feet - 61 * k);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0x1b2a30, 1);
    g.strokePath();
    g.fillStyle(0xe53935, 1);
    g.fillRect(x + 35 * k, feet - 77 * k, 4, 28 * k);
    if (c.talk > 0) {
      const cx = x + 20;
      const cy = feet - 118;
      this.cycleText.setText(c.text);
      const w = this.cycleText.width + 22;
      const alpha = Math.min(1, c.talk / 0.3);
      gf.fillStyle(0xffffff, 0.96 * alpha);
      gf.lineStyle(2, 0x1b2a30, alpha);
      gf.fillRoundedRect(cx - w / 2, cy - 17, w, 34, 12);
      gf.strokeRoundedRect(cx - w / 2, cy - 17, w, 34, 12);
      gf.fillTriangle(cx - 12, cy + 16, cx + 2, cy + 16, cx + 8, cy + 33);
      this.cycleText.setPosition(cx, cy).setAlpha(alpha).setVisible(true);
    }
    if (c.x > W + 140 || (c.said && c.talk <= 0 && c.x > W + 60)) {
      this.cyclist = null;
      this.nextCyclist = now + 8 + Math.random() * 5;
    }
    void view;
  }

  private pickHint(s: GameState, now: number): string | null {
    const r = s.row!;
    for (const d of r.ducks) {
      const ahead = d.x - r.x;
      if (!d.done && ahead > 5 && ahead < 18 && !this.hinted.has(`d${d.x}`)) {
        this.hinted.add(`d${d.x}`);
        return 'Duck!';
      }
    }
    for (const b of r.bridges) {
      const ahead = b.x0 - r.x;
      if (!b.done && ahead > 6 && ahead < 22 && !this.hinted.has(`b${b.x0}`)) {
        this.hinted.add(`b${b.x0}`);
        return b.kind === 'low' || b.kind === 'wood' ? 'Bridge! Not too high!' : 'Bridge!';
      }
    }
    if (r.sync < 0.45 && now - this.lastSyncHint > 14) {
      this.lastSyncHint = now;
      return 'Together!';
    }
    if (r.v < 2 && r.sync >= 0.45 && now - this.lastFastHint > 16) {
      this.lastFastHint = now;
      return 'Faster!';
    }
    for (const bu of r.buoys) {
      const ahead = bu.x - r.x;
      if (!bu.done && ahead > 6 && ahead < 18 && !this.hinted.has(`u${bu.x}`)) {
        this.hinted.add(`u${bu.x}`);
        return 'Hit the buoy hard!';
      }
    }
    return null;
  }

  /** Speed, synchrony meter and race clock under the top bar. */
  private drawHud(s: GameState, W: number): void {
    const r = s.row!;
    const g = this.gHud;
    g.clear();
    const bw = 240;
    const bx = W / 2 - bw / 2;
    const y = 52;
    g.fillStyle(0x152a30, 0.92);
    g.fillRoundedRect(bx - 74, y, bw + 148, 30, 8);
    g.lineStyle(2, 0x8fb5bb, 0.9);
    g.strokeRoundedRect(bx - 74, y, bw + 148, 30, 8);
    g.fillStyle(0x0d1c20, 1);
    g.fillRoundedRect(bx + 16, y + 8, bw - 32, 14, 5);
    const col = r.sync > 0.7 ? 0x4cd964 : r.sync > 0.4 ? 0xf5a623 : 0xe8473c;
    g.fillStyle(col, 1);
    g.fillRoundedRect(bx + 17, y + 9, Math.max(3, (bw - 34) * r.sync), 12, 4);
    this.speedText.setText(`${rowSpeedMs(r.v).toFixed(1)} m/s`).setPosition(bx - 28, y + 15).setVisible(true);
    this.syncText.setText(`SYNC ${Math.round(r.sync * 100)}%`).setPosition(bx + bw / 2, y + 15).setVisible(true);
    this.timeText.setText(r.started ? raceClock(r.raceTime) : 'READY').setPosition(bx + bw + 38, y + 15).setVisible(true);
    this.bridgeText.setVisible(false);
  }
}

export { RIGGER_AT, ROW };
