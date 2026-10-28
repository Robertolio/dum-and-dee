import Phaser from 'phaser';
import {
  cloneTuning,
  createState,
  DEFAULT_TUNING,
  lampCapCenter,
  ladderHeightAt,
  PROTOTYPE_LEVEL,
  step,
  type GameEvent,
  type GameState,
  type PlayerInput,
  type Tuning,
} from '@dd/sim';
import { CAMERA_LEAD, COLORS, FLOOR_Y, GAME_H, LADDER_SCREEN_FRACTION, PX } from '../config';
import { Controller } from '../input/controller';
import { Hud } from '../render/hud';
import { View } from '../render/view';
import { DEE_STYLE, DUM_STYLE, drawFigure } from '../render/figures';
import { drawLadder } from '../render/ladder';
import { drawThumb } from '../render/thumbs';
import { STRINGS } from '../strings';
import { ReplayRecorder } from '../debug/replay';
import { isTouchDevice } from '../platform/fullscreen';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export class GameScene extends Phaser.Scene {
  state!: GameState;
  tuning: Tuning = cloneTuning(DEFAULT_TUNING);
  controller!: Controller;
  readonly replay = new ReplayRecorder();
  lastInputs: [PlayerInput, PlayerInput] = [
    { push: 0, hTarget: 0.8 },
    { push: 0, hTarget: 0.8 },
  ];

  private readonly view = new View();
  private accumulator = 0;
  private hud!: Hud;
  private gWorld!: Phaser.GameObjects.Graphics;
  private gFx!: Phaser.GameObjects.Graphics;
  private gThumbs!: Phaser.GameObjects.Graphics;
  private layers: { wall: Phaser.GameObjects.TileSprite; pipes: Phaser.GameObjects.TileSprite; floor: Phaser.GameObjects.TileSprite; ceiling: Phaser.GameObjects.TileSprite } | null = null;
  private stepSprites: Phaser.GameObjects.Image[] = [];
  private lampCaps: Phaser.GameObjects.Image[] = [];
  private bucketSprite!: Phaser.GameObjects.Image;
  private splash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hintText!: Phaser.GameObjects.Text;
  private zoneLabels: Phaser.GameObjects.Text[] = [];
  private overlay: Phaser.GameObjects.Container | null = null;
  private oof: [number, number] = [0, 0];
  private shake = 0;
  private fpsSmoothed = 60;

  constructor() {
    super('game');
  }

  preload(): void {
    this.load.svg('wall', 'art/wall.svg', { width: 512, height: 400 });
    this.load.svg('pipes', 'art/pipes.svg', { width: 512, height: 400 });
    this.load.svg('floor', 'art/floor.svg', { width: 256, height: 100 });
    this.load.svg('ceiling', 'art/ceiling.svg', { width: 256, height: 48 });
    this.load.svg('crate', 'art/crate.svg', { width: 100, height: 50 });
    this.load.svg('bracket', 'art/bracket.svg', { width: 80, height: 30 });
    this.load.svg('pallet', 'art/pallet.svg', { width: 120, height: 60 });
    this.load.svg('lamp-cap', 'art/lamp-cap.svg', { width: 80, height: 60 });
    this.load.svg('bucket', 'art/bucket.svg', { width: 48, height: 52 });
  }

  create(): void {
    const W = this.scale.width;
    this.view.width = W;
    this.state = createState(PROTOTYPE_LEVEL, this.tuning);

    // Background layers (parallax tile sprites).
    const wall = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'wall').setOrigin(0, 0).setDepth(0);
    const pipes = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'pipes').setOrigin(0, 0).setDepth(1);
    const floor = this.add.tileSprite(0, FLOOR_Y, W, GAME_H - FLOOR_Y, 'floor').setOrigin(0, 0).setDepth(5);
    const ceiling = this.add.tileSprite(0, 0, W, 48, 'ceiling').setOrigin(0, 0).setDepth(2);
    this.layers = { wall, pipes, floor, ceiling };

    // Props.
    for (const o of this.state.steps) {
      const img = this.add.image(0, 0, o.kind).setOrigin(0, 1).setDepth(6);
      img.setDisplaySize((o.x1 - o.x0) * PX, o.hObj * PX);
      this.stepSprites.push(img);
    }
    for (const _l of this.state.lamps) {
      const cap = this.add.image(0, 0, 'lamp-cap').setOrigin(0.5, 0).setDepth(12);
      this.lampCaps.push(cap);
    }
    this.bucketSprite = this.add.image(0, 0, 'bucket').setOrigin(0.5, 0.04).setDepth(11);

    this.gWorld = this.add.graphics().setDepth(10);
    this.gFx = this.add.graphics().setDepth(20);
    this.gThumbs = this.add.graphics().setDepth(60);

    // Particles.
    const dot = this.make.graphics({ x: 0, y: 0 }, false);
    dot.fillStyle(0xffffff);
    dot.fillCircle(4, 4, 4);
    dot.generateTexture('dot', 8, 8);
    dot.destroy();
    this.splash = this.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 220 },
      angle: { min: 200, max: 340 },
      gravityY: 600,
      lifespan: { min: 300, max: 700 },
      scale: { start: 1, end: 0.2 },
      tint: [COLORS.water, COLORS.waterLight],
      emitting: false,
    });
    this.splash.setDepth(15);
    this.sparks = this.add.particles(0, 0, 'dot', {
      speed: { min: 80, max: 260 },
      angle: { min: 0, max: 360 },
      gravityY: 300,
      lifespan: { min: 200, max: 500 },
      scale: { start: 0.8, end: 0 },
      tint: [0xfff2a8, 0xffc53d, 0xffffff],
      emitting: false,
    });
    this.sparks.setDepth(16);

    this.hud = new Hud(this, W);

    // Controls.
    this.controller = new Controller(this.game.canvas);
    this.controller.setSettings({ source: isTouchDevice() ? 'touch' : 'keyboard' });
    this.updateInputScale();
    this.scale.on('resize', () => this.onResize());

    this.hintText = this.add
      .text(W / 2, GAME_H - 14, '', { fontFamily: FONT, fontSize: '13px', color: '#dff3f5' })
      .setOrigin(0.5, 1)
      .setDepth(55)
      .setAlpha(0.9);
    for (let i = 0; i < 2; i++) {
      const label = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '15px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5, 0.5)
        .setDepth(55)
        .setAlpha(0.55);
      this.zoneLabels.push(label);
    }
    this.refreshHints();

    this.input.keyboard?.on('keydown-R', () => this.reset());
    this.input.on('pointerdown', () => {
      if (this.state.gameOver) this.reset();
    });

    this.view.camX = this.targetCamX();
    this.updateCameraLayers();
  }

  /** Reset the run; keeps the current tuning and control settings. */
  reset(): void {
    this.state = createState(PROTOTYPE_LEVEL, this.tuning);
    this.accumulator = 0;
    this.oof = [0, 0];
    this.overlay?.destroy();
    this.overlay = null;
    this.view.camX = this.targetCamX();
  }

  /** Restore the tuning defaults in place (the panel sliders read from the same object). */
  resetTuning(): void {
    Object.assign(this.tuning, cloneTuning(DEFAULT_TUNING));
  }

  refreshHints(): void {
    const cfg = this.controller.settings();
    const W = this.scale.width;
    if (cfg.source === 'keyboard') {
      this.hintText.setText(STRINGS.keyboardHint);
      for (const l of this.zoneLabels) l.setText('');
    } else {
      this.hintText.setText(cfg.posture === 'analog' ? `${STRINGS.analog}: drag ↓ to bend, ↑ to stretch, → to run` : `${STRINGS.digital}: ${STRINGS.touchHintDigital}`);
      this.zoneLabels[0]!.setText(`${STRINGS.dum} — ${STRINGS.hold}`).setPosition(W * 0.25, GAME_H - 44).setColor('#9bb9ff');
      this.zoneLabels[1]!.setText(`${STRINGS.dee} — ${STRINGS.hold}`).setPosition(W * 0.75, GAME_H - 44).setColor('#ff9f96');
    }
  }

  private updateInputScale(): void {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    this.controller.setScale(this.scale.width / Math.max(1, rect.width));
  }

  private onResize(): void {
    const W = this.scale.width;
    this.view.width = W;
    if (this.layers) {
      for (const l of Object.values(this.layers)) l.setSize(W, l.height);
    }
    this.hud.resize(W);
    this.hintText.setX(W / 2);
    this.refreshHints();
    this.updateInputScale();
  }

  private targetCamX(): number {
    const [a, b] = this.state.players;
    const xLadder = (a.x + b.x) / 2;
    return xLadder + CAMERA_LEAD - (this.scale.width * LADDER_SCREEN_FRACTION) / PX;
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.fpsSmoothed += (1000 / Math.max(1, deltaMs) - this.fpsSmoothed) * 0.05;
    this.updateInputScale();
    this.accumulator += dt;
    const h = this.tuning.dt;
    let steps = 0;
    while (this.accumulator >= h && steps < 6) {
      const live = this.controller.sample(h);
      const inputs = this.replay.process(live);
      this.lastInputs = inputs;
      step(this.state, inputs, this.tuning);
      this.handleEvents(this.state.events);
      this.accumulator -= h;
      steps++;
    }
    if (steps === 6) this.accumulator = 0;

    for (let i = 0; i < 2; i++) this.oof[i] = Math.max(0, this.oof[i]! - dt);
    this.shake = Math.max(0, this.shake - dt);

    // Camera follows with a little lag.
    const target = this.targetCamX();
    this.view.camX += (target - this.view.camX) * Math.min(1, dt * 6);

    this.render();
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      const sx = e.x !== undefined ? this.view.sx(e.x) : this.scale.width / 2;
      const sy = e.y !== undefined ? this.view.sy(e.y) : FLOOR_Y - 200;
      switch (e.type) {
        case 'lampHit':
        case 'lampTick':
          this.sparks.explode(e.type === 'lampHit' ? 18 : 8, sx, sy + 30);
          this.splashAt(e.type === 'lampHit' ? 20 : 10);
          this.oof = [0.6, 0.6];
          this.shake = 0.2;
          if (e.type === 'lampHit') this.floatText(sx, sy - 10, STRINGS.oof, '#ffd36b');
          break;
        case 'lampClean':
          this.floatText(sx, sy, `+${e.value} ${STRINGS.cleanPass}`, '#9cf59c');
          break;
        case 'stepCaught':
          this.floatText(sx, this.view.sy((e.y ?? 0) + 0.9), `+${e.value} ${STRINGS.caught}`, '#9cf59c');
          break;
        case 'stepMissed':
          this.splashAt(8);
          break;
        case 'bucketEmpty':
          this.floatText(sx, sy - 60, STRINGS.newBucket, '#ffffff');
          this.shake = 0.3;
          break;
        case 'ladderSlipped':
          this.floatText(this.scale.width / 2, 200, STRINGS.ladderSlipped, '#ff9f96');
          this.oof = [1, 1];
          this.shake = 0.4;
          break;
        case 'gameOver':
          this.showGameOver();
          break;
      }
    }
    if (this.state.bucket.lossRate > 3) this.splashAt(Math.min(6, Math.round(this.state.bucket.lossRate / 3)));
  }

  private splashAt(n: number): void {
    const B = this.state.bucket;
    const bx = this.view.sx(B.xP) + Math.sin(B.phi) * this.tuning.bucketL * PX;
    const by = this.view.sy(B.yP) + Math.cos(B.phi) * this.tuning.bucketL * PX;
    this.splash.explode(n, bx, by + 12);
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '20px', color, fontStyle: 'bold', stroke: '#102024', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private showGameOver(): void {
    const W = this.scale.width;
    const bg = this.add.rectangle(W / 2, GAME_H / 2, W, GAME_H, 0x071a1e, 0.75);
    const title = this.add.text(W / 2, GAME_H / 2 - 40, STRINGS.gameOver, { fontFamily: FONT, fontSize: '44px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const score = this.add.text(W / 2, GAME_H / 2 + 10, `${STRINGS.score}: ${Math.floor(this.state.score)}`, { fontFamily: FONT, fontSize: '24px', color: '#ffd36b' }).setOrigin(0.5);
    const hint = this.add.text(W / 2, GAME_H / 2 + 50, STRINGS.tapToRestart, { fontFamily: FONT, fontSize: '16px', color: '#dff3f5' }).setOrigin(0.5);
    this.overlay = this.add.container(0, 0, [bg, title, score, hint]).setDepth(80);
  }

  private updateCameraLayers(): void {
    if (!this.layers) return;
    const cam = this.view.camX * PX;
    this.layers.wall.tilePositionX = cam * 0.35;
    this.layers.pipes.tilePositionX = cam * 0.65;
    this.layers.floor.tilePositionX = cam;
    this.layers.ceiling.tilePositionX = cam;
  }

  private render(): void {
    const s = this.state;
    const t = this.tuning;
    const view = this.view;
    const g = this.gWorld;
    const shakeX = this.shake > 0 ? Math.sin(this.time.now * 0.08) * this.shake * 10 : 0;
    this.cameras.main.setScroll(shakeX, 0);

    this.updateCameraLayers();

    // Step-up props.
    s.steps.forEach((o, i) => {
      const img = this.stepSprites[i]!;
      img.setPosition(view.sx(o.x0), FLOOR_Y + 2);
    });

    g.clear();

    // Lamps: cord, cap, light cone coloured by ladder clearance.
    s.lamps.forEach((l, i) => {
      const cap = lampCapCenter(l, t);
      const px = view.sx(l.x);
      const py = view.sy(l.pivotY);
      const cx = view.sx(cap.x);
      const cy = view.sy(cap.y);
      // cord from the ceiling to the top of the cap
      const topX = cx - Math.sin(l.psi) * t.lampR * PX;
      const topY = cy - Math.cos(l.psi) * t.lampR * PX;
      g.lineStyle(4, COLORS.cord);
      g.lineBetween(px, py, topX, topY);
      g.fillStyle(COLORS.cord);
      g.fillCircle(px, py, 6);
      const capImg = this.lampCaps[i]!;
      capImg.setPosition(topX, topY).setRotation(-l.psi);
      // light cone on the floor: green when the ladder below is clear, orange when it will hit
      const clearance = ladderHeightAt(s, l.x) + t.ladderThickness / 2 < cap.y - t.lampR;
      const near = Math.abs(l.x - (s.players[0].x + s.players[1].x) / 2) < 6;
      const color = !near ? 0xfff0b0 : clearance ? COLORS.balanceGreen : COLORS.balanceOrange;
      g.fillStyle(color, 0.16);
      g.beginPath();
      g.moveTo(cx - 18, cy + t.lampR * PX - 8);
      g.lineTo(cx + 18, cy + t.lampR * PX - 8);
      g.lineTo(cx + 110, FLOOR_Y);
      g.lineTo(cx - 110, FLOOR_Y);
      g.closePath();
      g.fillPath();
    });

    // Figures.
    const [a, b] = s.players;
    drawFigure(g, view, DUM_STYLE, a.x, a.yFloor, a.y, this.oof[0]!);
    drawFigure(g, view, DEE_STYLE, b.x, b.yFloor, b.y, this.oof[1]!);

    // Ladder.
    drawLadder(g, view, s, t);

    // Bucket: hook at the middle, rope at angle phi, bucket hangs vertical at rest.
    const B = s.bucket;
    const hx = view.sx(B.xP);
    const hy = view.sy(B.yP);
    const ropeLen = t.bucketL * PX;
    const bx = hx + Math.sin(B.phi) * ropeLen;
    const by = hy + Math.cos(B.phi) * ropeLen;
    g.lineStyle(3, 0x3b4248);
    g.lineBetween(hx, hy, bx, by);
    g.fillStyle(COLORS.ladderDark);
    g.fillCircle(hx, hy, 5);
    this.bucketSprite.setPosition(bx, by).setRotation(-B.phi);
    // Water fill level inside the bucket, drawn over the sprite.
    const fill = B.water / 100;
    const fx = this.gFx;
    fx.clear();
    const bucketW = 30;
    const bucketH = 26;
    const level = by + 10 + bucketH * (1 - fill);
    fx.fillStyle(COLORS.water);
    fx.fillRect(bx - bucketW / 2 + 1, level, bucketW - 2, by + 10 + bucketH - level);
    fx.fillStyle(0xffffff, 0.35);
    fx.fillRect(bx - bucketW / 2 + 1, level, bucketW - 2, 3);

    // Thumb feedback.
    const thumbs = this.controller.thumbs();
    const cfg = this.controller.settings();
    this.gThumbs.clear();
    if (cfg.source === 'touch') {
      drawThumb(this.gThumbs, thumbs[0], COLORS.dum, cfg.posture === 'analog');
      drawThumb(this.gThumbs, thumbs[1], COLORS.dee, cfg.posture === 'analog');
    }

    this.hud.draw(s, t);
  }

  /** Debug readout for the panel. */
  readout(): Record<string, number> {
    const s = this.state;
    return {
      fps: this.fpsSmoothed,
      thetaDeg: (s.ladder.theta * 180) / Math.PI,
      balance: s.balance,
      tension: s.ladder.tension,
      over: s.ladder.over,
      aPy: s.bucket.aPyF,
      jerk: s.bucket.jerk,
      phiDeg: (s.bucket.phi * 180) / Math.PI,
      lossRate: s.bucket.lossRate,
      water: s.bucket.water,
      hA: s.players[0].h,
      hB: s.players[1].h,
      vA: s.players[0].v,
      vB: s.players[1].v,
    };
  }
}
