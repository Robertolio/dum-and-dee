import Phaser from 'phaser';
import {
  cloneTuning,
  createState,
  DEFAULT_TUNING,
  lampCapCenter,
  ladderHeightAt,
  ENDLESS_LEVEL,
  advanceWalk,
  createWalkAnim,
  type WalkAnim,
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
import { sfx } from '../audio/sfx';
import { Speech } from '../render/speech';
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
  private stepSprites = new Map<number, Phaser.GameObjects.Image>();
  private lampSprites = new Map<number, Phaser.GameObjects.Image>();
  private gProps!: Phaser.GameObjects.Graphics;
  private walk: [WalkAnim, WalkAnim] = [createWalkAnim(0), createWalkAnim(0)];
  private walkAmp: [number, number] = [0, 0];
  private prevStepIdx: [number, number] = [0, 0];
  speech!: Speech;
  private seenAhead = new Set<string>();
  private waterWarned = false;
  private lastDt = 1 / 60;
  private prevAir: [boolean, boolean] = [false, false];
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
    this.load.svg('banana', 'art/banana.svg', { width: 90, height: 25 });
    this.load.svg('duck', 'art/duck.svg', { width: 80, height: 40 });
    this.load.svg('pail', 'art/pail.svg', { width: 80, height: 45 });
    this.load.svg('tyre', 'art/tyre.svg', { width: 100, height: 40 });
    this.load.svg('cheese', 'art/cheese.svg', { width: 100, height: 30 });
    this.load.svg('meat', 'art/meat.svg', { width: 100, height: 120 });
    this.load.svg('lamp-cap', 'art/lamp-cap.svg', { width: 80, height: 60 });
    this.load.svg('bucket', 'art/bucket.svg', { width: 48, height: 52 });
  }

  create(): void {
    const W = this.scale.width;
    this.view.width = W;
    this.state = createState(ENDLESS_LEVEL, this.tuning);
    this.resetWalk();

    // Background layers (parallax tile sprites).
    const wall = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'wall').setOrigin(0, 0).setDepth(0);
    const pipes = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'pipes').setOrigin(0, 0).setDepth(1);
    const floor = this.add.tileSprite(0, FLOOR_Y, W, GAME_H - FLOOR_Y, 'floor').setOrigin(0, 0).setDepth(5);
    const ceiling = this.add.tileSprite(0, 0, W, 48, 'ceiling').setOrigin(0, 0).setDepth(2);
    this.layers = { wall, pipes, floor, ceiling };

    this.gProps = this.add.graphics().setDepth(6);
    this.bucketSprite = this.add.image(0, 0, 'bucket').setOrigin(0.5, 0.04).setDepth(11);

    this.gWorld = this.add.graphics().setDepth(10);
    this.gFx = this.add.graphics().setDepth(11.5);
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
    this.speech = new Speech(this);
    this.speech.onSay = (p, text) => sfx.mumble(p, text.length);

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

  private resetWalk(): void {
    this.walk = [createWalkAnim(this.state.players[0].x), createWalkAnim(this.state.players[1].x)];
  }

  /** Reset the run; keeps the current tuning and control settings. */
  reset(): void {
    this.state = createState(ENDLESS_LEVEL, this.tuning);
    this.resetWalk();
    this.accumulator = 0;
    this.speech.reset();
    this.seenAhead.clear();
    this.waterWarned = false;
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
    this.lastDt = dt;
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
      for (let i = 0; i < 2; i++) {
        this.walkAmp[i] = advanceWalk(this.walk[i]!, this.state.players[i]!.x, h);
        this.playMovementSounds(i);
      }
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

    this.announce();
    this.render();
  }

  private nearestPlayer(x?: number): 0 | 1 {
    if (x === undefined) return 1;
    const [a, b] = this.state.players;
    return Math.abs(a.x - x) < Math.abs(b.x - x) ? 0 : 1;
  }

  /** Context-bound remarks: water trouble and the next hazard ahead of the ladder. */
  private announce(): void {
    const s = this.state;
    if (s.gameOver) return;
    const water = s.bucket.water;
    if (water < 25 && !this.waterWarned) {
      if (this.speech.say(null, 'Careful!', 'hint')) this.waterWarned = true;
    } else if (water > 60) this.waterWarned = false;
    if (s.bucket.lossRate > 9) this.speech.say(null, 'Watch out!', 'hint');

    const [a, b] = s.players;
    const front = Math.max(a.x, b.x) + this.tuning.ladderOverhang;
    const check = (key: string, x: number, text: string): void => {
      const d = x - front;
      if (d < 0.3 || d > 3.6 || this.seenAhead.has(key)) return;
      if (this.speech.say(null, text, 'hint')) this.seenAhead.add(key);
    };
    for (const l of s.lamps) check(`l${l.id}`, l.x - 0.4, 'Duck!');
    for (const m of s.beams) check(`b${m.id}`, m.x0, 'Duck!');
    for (const o of s.steps) {
      if (o.kind === 'stair') continue;
      if (o.kind === 'banana') check(`s${o.id}`, o.x0, 'Watch out!');
      else if (o.hObj > this.tuning.autoStepMax) check(`s${o.id}`, o.x0 - 1.0, 'Jump!');
    }
  }

  private playMovementSounds(i: number): void {
    const p = this.state.players[i]!;
    const air = p.jumpT > 0;
    if (air && !this.prevAir[i]!) sfx.jump();
    if (!air && this.prevAir[i]!) sfx.land();
    this.prevAir[i] = air;
    const idx = Math.floor(this.walk[i]!.phase / Math.PI);
    if (idx !== this.prevStepIdx[i] && !air && this.walkAmp[i]! > 0.25) sfx.footstep(this.walkAmp[i]!);
    this.prevStepIdx[i] = idx;
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      const sx = e.x !== undefined ? this.view.sx(e.x) : this.scale.width / 2;
      const sy = e.y !== undefined ? this.view.sy(e.y) : FLOOR_Y - 200;
      switch (e.type) {
        case 'bump':
          sfx.bump(e.value ?? 1);
          this.speech.say(this.nearestPlayer(e.x), 'Ouch!', 'hint');
          break;
        case 'push':
          sfx.push(e.value ?? 1);
          break;
        case 'lampHit':
        case 'lampTick': {
          const near = this.state.lamps.reduce((best, l) => (Math.abs(l.x - (e.x ?? 0)) < Math.abs(best.x - (e.x ?? 0)) ? l : best), this.state.lamps[0]!);
          sfx.thud(near?.kind === 'meat');
          if (e.type === 'lampHit') this.speech.say(this.nearestPlayer(e.x), 'Ouch!', 'hint');
          sfx.splash(e.value ?? 4);
          this.sparks.explode(e.type === 'lampHit' ? 18 : 8, sx, sy + 30);
          this.splashAt(e.type === 'lampHit' ? 20 : 10);
          this.oof = [0.6, 0.6];
          this.shake = 0.2;
          if (e.type === 'lampHit') this.floatText(sx, sy - 10, STRINGS.oof, '#ffd36b');
          break;
        }
        case 'lampClean':
          this.speech.say(null, 'Nice!', 'cheer');
          this.floatText(sx, sy, `+${e.value} ${STRINGS.cleanPass}`, '#9cf59c');
          break;
        case 'stepCaught':
          this.speech.say(null, 'Nice!', 'cheer');
          this.floatText(sx, this.view.sy((e.y ?? 0) + 0.9), `+${e.value} ${STRINGS.caught}`, '#9cf59c');
          break;
        case 'slip':
          sfx.slip();
          this.speech.say((e.player ?? null) as 0 | 1 | null, 'Whoa!', 'urgent');
          sfx.splash(10);
          this.floatText(sx, sy - 70, STRINGS.slip, '#ffd36b');
          this.splashAt(14);
          this.shake = 0.25;
          if (e.player !== undefined) this.oof[e.player] = 0.8;
          break;
        case 'beamHit':
          sfx.bonk();
          this.speech.say(this.nearestPlayer(e.x), 'Ouch!', 'urgent');
          sfx.splash(e.value ?? 8);
          this.floatText(sx, this.view.sy(e.y ?? 2) + 30, STRINGS.bonk, '#ffd36b');
          this.sparks.explode(12, sx, this.view.sy(e.y ?? 2));
          this.splashAt(10);
          this.oof = [0.6, 0.6];
          this.shake = 0.3;
          break;
        case 'stepMissed':
          this.splashAt(8);
          break;
        case 'bucketEmpty':
          sfx.lifeLost();
          this.speech.say(null, 'Oh no!', 'urgent');
          this.floatText(sx, sy - 60, STRINGS.newBucket, '#ffffff');
          this.shake = 0.3;
          break;
        case 'ladderSlipped':
          sfx.lifeLost();
          this.speech.say(null, 'Oh no!', 'urgent');
          this.floatText(this.scale.width / 2, 200, STRINGS.ladderSlipped, '#ff9f96');
          this.oof = [1, 1];
          this.shake = 0.4;
          break;
        case 'gameOver':
          sfx.gameOver();
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

  /** Floor props: sprites for objects, plain blocks for stair treads. Created and destroyed as the level scrolls. */
  private syncProps(): void {
    const view = this.view;
    const gp = this.gProps;
    gp.clear();
    const live = new Set<number>();
    for (const o of this.state.steps) {
      const x0 = view.sx(o.x0);
      const x1 = view.sx(o.x1);
      if (x1 < -120 || x0 > this.scale.width + 120) continue;
      if (o.kind === 'stair') {
        const top = FLOOR_Y + 2 - o.hObj * PX;
        gp.fillStyle(0x6f7c86);
        gp.fillRect(x0, top, x1 - x0, o.hObj * PX);
        gp.fillStyle(0xaab6bf);
        gp.fillRect(x0, top, x1 - x0, 6);
        gp.lineStyle(2, 0x3c474f);
        gp.strokeRect(x0, top, x1 - x0, o.hObj * PX);
        continue;
      }
      live.add(o.id);
      let img = this.stepSprites.get(o.id);
      if (!img) {
        img = this.add.image(0, 0, o.kind).setOrigin(0, 1).setDepth(6);
        img.setDisplaySize((o.x1 - o.x0) * PX, o.hObj * PX);
        this.stepSprites.set(o.id, img);
      }
      img.setPosition(x0, FLOOR_Y + 2).setAlpha(o.used ? 0.75 : 1);
    }
    for (const m of this.state.beams) {
      const x0 = view.sx(m.x0);
      const x1 = view.sx(m.x1);
      if (x1 < -40 || x0 > this.scale.width + 40) continue;
      const bottom = view.sy(m.yBottom);
      gp.fillStyle(0x4a545c);
      gp.fillRect(x0, 40, x1 - x0, bottom - 40);
      gp.fillStyle(0x6c7882);
      gp.fillRect(x0, 40, x1 - x0, 8);
      for (let sx = x0; sx < x1; sx += 28) {
        gp.fillStyle(0xf2c43d);
        gp.fillRect(sx, bottom - 12, Math.min(14, x1 - sx), 12);
      }
      gp.lineStyle(2, 0x222a30);
      gp.strokeRect(x0, 40, x1 - x0, bottom - 40);
    }
    for (const [id, img] of this.stepSprites) {
      if (!live.has(id)) {
        img.destroy();
        this.stepSprites.delete(id);
      }
    }
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

    this.syncProps();
    g.clear();

    // Hanging pendulums (lamps and meat): cord, body, light cone for lamps.
    const live = new Set<number>();
    for (const l of s.lamps) {
      live.add(l.id);
      const cap = lampCapCenter(l, t);
      const px = view.sx(l.x);
      const py = view.sy(l.pivotY);
      const cx = view.sx(cap.x);
      const cy = view.sy(cap.y);
      const topX = cx - Math.sin(l.psi) * l.radius * PX;
      const topY = cy - Math.cos(l.psi) * l.radius * PX;
      const meat = l.kind === 'meat';
      g.lineStyle(meat ? 5 : 4, COLORS.cord);
      g.lineBetween(px, 48, px, py);
      g.lineBetween(px, py, topX, topY);
      g.fillStyle(COLORS.cord);
      g.fillCircle(px, py, 6);
      let img = this.lampSprites.get(l.id);
      if (!img) {
        img = this.add.image(0, 0, meat ? 'meat' : 'lamp-cap').setOrigin(0.5, 0).setDepth(12);
        if (meat) img.setDisplaySize(l.radius * 2 * PX * 1.05, l.radius * 2 * PX * 1.2);
        this.lampSprites.set(l.id, img);
      }
      img.setPosition(topX, topY).setRotation(-l.psi);
      if (meat) continue;
      const clearance = ladderHeightAt(s, l.x) + t.ladderThickness / 2 < cap.y - l.radius;
      const near = Math.abs(l.x - (s.players[0].x + s.players[1].x) / 2) < 6;
      const color = !near ? 0xfff0b0 : clearance ? COLORS.balanceGreen : COLORS.balanceOrange;
      // Light cone and glow share the lamp's pivot rotation: the axis follows the cord direction.
      const dx = Math.sin(l.psi);
      const dy = Math.cos(l.psi);
      const nx = dy;
      const ny = -dx;
      const sxp = cx + dx * (l.radius * PX - 8);
      const syp = cy + dy * (l.radius * PX - 8);
      const reach = Math.max(40, (FLOOR_Y - syp) / Math.max(0.3, dy));
      const fx0 = sxp + dx * reach;
      const fy0 = syp + dy * reach;
      g.fillStyle(color, 0.16);
      g.beginPath();
      g.moveTo(sxp - nx * 18, syp - ny * 18);
      g.lineTo(sxp + nx * 18, syp + ny * 18);
      g.lineTo(fx0 + nx * 110, Math.min(FLOOR_Y, fy0 + ny * 110));
      g.lineTo(fx0 - nx * 110, Math.min(FLOOR_Y, fy0 - ny * 110));
      g.closePath();
      g.fillPath();
      g.fillStyle(0xfff3c0, 0.28);
      g.fillCircle(sxp, syp, 20);
      g.fillStyle(0xfff3c0, 0.5);
      g.fillCircle(sxp, syp, 10);
    }
    for (const [id, img] of this.lampSprites) {
      if (!live.has(id)) {
        img.destroy();
        this.lampSprites.delete(id);
      }
    }

    // Figures.
    const [a, b] = s.players;
    const headA = drawFigure(g, view, DUM_STYLE, a.x, a.yFloor + a.jumpY, a.y, this.oof[0]!, this.walk[0]!.phase, a.jumpY > 0 ? 0 : this.walkAmp[0]!, a.slipTimer / this.tuning.slipTime, this.speech.mouthOpen(0));
    const headB = drawFigure(g, view, DEE_STYLE, b.x, b.yFloor + b.jumpY, b.y, this.oof[1]!, this.walk[1]!.phase, b.jumpY > 0 ? 0 : this.walkAmp[1]!, b.slipTimer / this.tuning.slipTime, this.speech.mouthOpen(1));
    this.speech.update(this.lastDt, [
      { x: headA.headX, y: headA.headY },
      { x: headB.headX, y: headB.headY },
    ]);
    const bk = s.bucket;
    sfx.setSlosh(s.gameOver || bk.water < 3 ? 0 : Math.min(1, Math.abs(bk.phiDot) * 0.28 + Math.abs(bk.phi) * 0.8 + bk.lossRate * 0.04));

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
    // Water inside the bucket: drawn in the bucket's rotated frame with a level surface.
    const fill = B.water / 100;
    const fx = this.gFx;
    fx.clear();
    const bucketW = 30;
    const bucketTop = 10;
    const bucketH = 26;
    const theta = -B.phi;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const toScreen = (lx: number, ly: number): [number, number] => [bx + lx * cos - ly * sin, by + lx * sin + ly * cos];
    const surface = bucketTop + bucketH * (1 - fill);
    const up: [number, number] = [-sin, -cos];
    let poly: [number, number][] = [
      [-bucketW / 2 + 1, bucketTop],
      [bucketW / 2 - 1, bucketTop],
      [bucketW / 2 - 3, bucketTop + bucketH],
      [-bucketW / 2 + 3, bucketTop + bucketH],
    ];
    const side = (p: [number, number]): number => (p[0] * up[0] + (p[1] - surface) * up[1]);
    const clipped: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp <= 0) clipped.push(p);
      if (sp <= 0 !== sq <= 0) {
        const u = sp / (sp - sq);
        clipped.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
      }
    }
    poly = clipped;
    if (poly.length >= 3 && fill > 0.01) {
      fx.fillStyle(COLORS.water);
      fx.beginPath();
      poly.forEach((p, i) => {
        const [px, py] = toScreen(p[0], p[1]);
        if (i === 0) fx.moveTo(px, py);
        else fx.lineTo(px, py);
      });
      fx.closePath();
      fx.fillPath();
    }

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
