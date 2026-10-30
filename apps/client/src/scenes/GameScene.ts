import Phaser from 'phaser';
import {
  cloneTuning,
  createState,
  DEFAULT_TUNING,
  lampCapCenter,
  ladderHeightAt,
  levelById,
  MIXED_ZONE,
  nextLevel,
  themeAtX,
  type LevelDef,
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
  levelDef: LevelDef = levelById('endless');
  paused = false;
  onEnd: ((kind: 'gameover' | 'complete') => void) | null = null;
  private hintsShown = new Set<number>();
  private curTheme: 'factory' | 'studio' = 'factory';
  private gateText: Phaser.GameObjects.Text | null = null;
  private bannerText: Phaser.GameObjects.Text | null = null;
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
  private softSprites = new Map<number, Phaser.GameObjects.Image>();
  private softAnim = new Map<number, { spin: number; angle: number }>();
  private decor = new Map<string, Phaser.GameObjects.Image>();
  private papers!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;
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
  quality = 0;
  private lowFpsT = 0;
  private highFpsT = 0;
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
    this.load.svg('knife', 'art/knife.svg', { width: 100, height: 30 });
    this.load.svg('meat', 'art/meat.svg', { width: 100, height: 120 });
    this.load.svg('balloon', 'art/balloon.svg', { width: 60, height: 80 });
    this.load.svg('web', 'art/web.svg', { width: 100, height: 100 });
    const art: Array<[string, number, number]> = [
      ['studio-wall', 512, 400],
      ['studio-top', 512, 400],
      ['studio-floor', 256, 100],
      ['studio-ceiling', 256, 48],
      ['speaker', 90, 45],
      ['studioprop', 110, 50],
      ['clothes', 100, 40],
      ['film', 80, 26],
      ['clapper', 90, 30],
      ['director', 90, 60],
      ['cart', 130, 70],
      ['cable', 140, 14],
      ['carpet', 320, 10],
      ['dummy', 70, 55],
      ['soundboard', 120, 45],
      ['onair', 100, 60],
      ['applause', 110, 60],
      ['buzzer', 80, 80],
      ['setwall', 140, 140],
      ['teleprompter', 70, 120],
      ['boom', 100, 120],
      ['studio-cap', 80, 60],
      ['wheel', 150, 150],
      ['fan', 100, 120],
      ['weather-bad', 120, 120],
      ['weather-good', 120, 120],
      ['paper', 16, 20],
      ['news-desk', 320, 220],
      ['quiz-set', 320, 220],
      ['talk-set', 320, 220],
      ['camera', 110, 150],
      ['cameraman', 110, 150],
    ];
    for (const [k, w, h] of art) this.load.svg(k, `art/${k}.svg`, { width: w, height: h });
    this.load.svg('lamp-cap', 'art/lamp-cap.svg', { width: 80, height: 60 });
    this.load.svg('bucket', 'art/bucket.svg', { width: 48, height: 52 });
  }

  create(): void {
    const W = this.scale.width;
    this.view.width = W;
    this.state = createState(this.levelDef.data, this.tuning);
    this.resetWalk();

    // Background layers (parallax tile sprites).
    const wall = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'wall').setOrigin(0, 0).setDepth(0);
    const pipes = this.add.tileSprite(0, FLOOR_Y - 400, W, 400, 'pipes').setOrigin(0, 0).setDepth(1);
    const floor = this.add.tileSprite(0, FLOOR_Y, W, GAME_H - FLOOR_Y, 'floor').setOrigin(0, 0).setDepth(5);
    const ceiling = this.add.tileSprite(0, 0, W, 48, 'ceiling').setOrigin(0, 0).setDepth(2);
    this.layers = { wall, pipes, floor, ceiling };
    this.applyTheme();

    this.gProps = this.add.graphics().setDepth(6);
    this.bucketSprite = this.add.image(0, 0, 'bucket').setOrigin(0.5, 0.04).setDepth(11);

    this.gWorld = this.add.graphics().setDepth(10);
    this.gFx = this.add.graphics().setDepth(10.9);
    this.gThumbs = this.add.graphics().setDepth(60);
    const gt = this.textures.createCanvas('glow', 256, 256)!;
    const gc = gt.getContext();
    const grad = gc.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gc.fillStyle = grad;
    gc.fillRect(0, 0, 256, 256);
    gt.refresh();
    this.darkGlow = this.make.image({ key: 'glow', add: false });
    this.darkRT = this.add.renderTexture(0, 0, W, GAME_H).setOrigin(0, 0).setDepth(14).setVisible(false);

    // Particles.
    const dot = this.make.graphics({ x: 0, y: 0 }, false);
    dot.fillStyle(0xffffff);
    dot.fillCircle(4, 4, 4);
    dot.generateTexture('dot', 8, 8);
    dot.destroy();
    this.splash = this.add.particles(0, 0, 'dot', {
      maxAliveParticles: 90,
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
      maxAliveParticles: 120,
      speed: { min: 80, max: 260 },
      angle: { min: 0, max: 360 },
      gravityY: 300,
      lifespan: { min: 200, max: 500 },
      scale: { start: 0.8, end: 0 },
      tint: [0xfff2a8, 0xffc53d, 0xffffff],
      emitting: false,
    });
    this.sparks.setDepth(16);
    this.confetti = this.add.particles(0, 0, 'dot', {
      maxAliveParticles: 160,
      speed: { min: 80, max: 300 },
      angle: { min: 0, max: 360 },
      gravityY: 500,
      lifespan: { min: 700, max: 1300 },
      scale: { start: 1.1, end: 0.5 },
      tint: [0xff5a5f, 0xffd23f, 0x3bceac, 0x4ea8de, 0xb084f5, 0xff9f1c],
      emitting: false,
    });
    this.confetti.setDepth(17);
    this.papers = this.add.particles(0, 0, 'paper', { lifespan: 2400, speed: { min: 70, max: 240 }, angle: { min: -120, max: -10 }, gravityY: 55, rotate: { start: 0, end: 540 }, scale: { start: 1.2, end: 0.9 }, alpha: { start: 1, end: 0 }, emitting: false, maxAliveParticles: 80 });
    this.papers.setDepth(18);

    this.hud = new Hud(this, W);
    this.hud.resize(W, ...this.measureInsets());
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


    this.view.camX = this.targetCamX();
    this.updateCameraLayers();
  }

  private updateDark(s: GameState): void {
    const target = s.dark && !s.gameOver ? 1 : 0;
    this.darkA += (target - this.darkA) * Math.min(1, this.lastDt * (target > this.darkA ? 6 : 3));
    if (!this.darkRT) return;
    if (this.darkA < 0.01) {
      this.darkRT.setVisible(false);
      return;
    }
    const W = this.scale.width;
    if (this.darkRT.width !== W) this.darkRT.resize(W, GAME_H);
    this.darkRT.setVisible(true);
    this.darkRT.clear();
    this.darkRT.fill(0x04060c, this.darkA * 0.9);
    const glow = this.darkGlow!;
    const pulse = 1 + Math.sin(performance.now() / 180) * 0.03;
    const [a, b] = s.players;
    const view = this.view;
    const spots: Array<[number, number, number]> = [
      [view.sx(a.x), view.sy(a.y + 0.9), 2.3],
      [view.sx(b.x), view.sy(b.y + 0.9), 2.3],
      [view.sx((a.x + b.x) / 2), view.sy(Math.max(a.y, b.y) + 1.4), 2.6],
      [view.sx(s.bucket.xP), FLOOR_Y - 120, 1.4],
    ];
    for (const [x, y, k] of spots) {
      glow.setScale((k * pulse * this.darkA + k * (1 - this.darkA)) * 0.5);
      this.darkRT.erase(glow, x, y);
    }
  }

  private darkA = 0;
  private darkRT?: Phaser.GameObjects.RenderTexture;
  private darkGlow?: Phaser.GameObjects.Image;

  private resetWalk(): void {
    this.walk = [createWalkAnim(this.state.players[0].x), createWalkAnim(this.state.players[1].x)];
  }

  /** Reset the run; keeps the current tuning and control settings. */
  reset(): void {
    this.state = createState(this.levelDef.data, this.tuning);
    this.hintsShown.clear();
    this.resetWalk();
    this.accumulator = 0;
    this.speech.reset();
    this.seenAhead.clear();
    this.darkA = 0;
    this.waterWarned = false;
    this.oof = [0, 0];
    this.overlay?.destroy();
    this.overlay = null;
    this.view.camX = this.targetCamX();
  }

  startLevel(def: LevelDef): void {
    this.levelDef = def;
    this.paused = false;
    this.curTheme = themeAtX(!!def.data.mixed, def.theme, 0);
    this.commercial.clear();
    this.applyTheme();
    this.reset();
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

  private measureInsets(): [number, number] {
    const probe = document.getElementById('inset-probe');
    if (!probe) return [0, 0];
    const cs = getComputedStyle(probe);
    const k = this.scale.width / Math.max(1, window.innerWidth);
    return [(parseFloat(cs.paddingLeft) || 0) * k, (parseFloat(cs.paddingRight) || 0) * k];
  }

  private onResize(): void {
    const W = this.scale.width;
    this.view.width = W;
    if (this.layers) {
      for (const l of Object.values(this.layers)) l.setSize(W, l.height);
    }
    this.hud.resize(W, ...this.measureInsets());
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
    if (this.paused) {
      this.render();
      return;
    }
    this.fpsSmoothed += (1000 / Math.max(1, deltaMs) - this.fpsSmoothed) * 0.05;
    this.updateInputScale();
    this.adaptQuality(dt);
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
    this.showHints();
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
      if (o.kind === 'banana' || o.kind === 'cable') check(`s${o.id}`, o.x0, 'Watch out!');
      else if (o.kind === 'carpet') continue;
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
          sfx.thud(near?.kind !== 'lamp');
          if (e.type === 'lampHit') this.speech.say(this.nearestPlayer(e.x), 'Ouch!', 'hint');
          sfx.splash(e.value ?? 4);
          this.burst(this.sparks, e.type === 'lampHit' ? 18 : 8, sx, sy + 30);
          this.splashAt(e.type === 'lampHit' ? 20 : 10);
          this.oof = [0.6, 0.6];
          this.shake = 0.2;
          if (e.type === 'lampHit') this.floatText(sx, sy - 10, STRINGS.oof, '#ffd36b');
          break;
        }
        case 'bucketBonk':
          sfx.bonk();
          sfx.splash(4);
          this.splashAt(14);
          this.shake = 0.2;
          this.speech.say(this.nearestPlayer(e.x), 'Careful!', 'hint');
          break;
        case 'lampBreak':
          sfx.glassBreak();
          sfx.splash(e.value ?? 8);
          this.burst(this.sparks, 40, sx, sy + 20);
          this.splashAt(16);
          this.shake = 0.35;
          this.oof = [0.6, 0.6];
          this.speech.say(this.nearestPlayer(e.x), Math.random() < 0.5 ? 'Whoa!' : 'Oops!', 'hint');
          break;
        case 'lightsOn':
          sfx.lightsOn();
          this.speech.say(null, 'Nice!', 'cheer');
          break;
        case 'pop':
          sfx.pop();
          this.burst(this.confetti, 34, sx, sy);
          this.floatText(sx, sy - 24, `+${e.value}`, '#ffd36b');
          break;
        case 'spin': {
          const w = this.state.softs.find((o) => o.kind === 'wheel' && Math.abs(o.x - (e.x ?? 0)) < 0.01);
          if (w) this.softAnim.set(w.id, { spin: 16 + Math.random() * 6, angle: this.softAnim.get(w.id)?.angle ?? 0 });
          sfx.tick();
          this.floatText(sx, sy - 70, `+${e.value}`, '#ffd36b');
          this.speech.say(null, 'Spin it!', 'cheer');
          break;
        }
        case 'gust': {
          const f = this.state.softs.find((o) => o.kind === 'fan' && Math.abs(o.x - (e.x ?? 0)) < 0.01);
          if (f) this.softAnim.set(f.id, { spin: 40, angle: this.softAnim.get(f.id)?.angle ?? 0 });
          sfx.whoosh();
          this.burst(this.papers, 26, sx + 30, sy - 10);
          this.floatText(sx, sy - 60, `+${e.value}`, '#dff3f5');
          this.speech.say(null, 'My notes!', 'urgent');
          break;
        }
        case 'flip':
          sfx.cheer();
          this.floatText(sx, sy - 60, `+${e.value}`, '#ffd36b');
          this.burst(this.confetti, 16, sx, sy);
          this.speech.say(null, 'Sunshine!', 'cheer');
          break;
        case 'onAir':
          sfx.pop();
          this.cameras.main.flash(120, 255, 60, 70);
          this.floatText(sx, sy - 40, `+${e.value}`, '#ff8a92');
          this.speech.say(null, "We're live!", 'cheer');
          break;
        case 'applause':
          sfx.applause();
          this.burst(this.confetti, 22, sx, sy);
          this.floatText(sx, sy - 40, `+${e.value}`, '#ffd36b');
          this.speech.say(null, 'Applause!', 'cheer');
          break;
        case 'buzz':
          sfx.buzz();
          this.floatText(sx, sy - 40, `+${e.value}`, '#ffd36b');
          this.speech.say(null, 'Bzzzt!', 'cheer');
          break;
        case 'glam':
          sfx.cheer();
          this.burst(this.confetti, 14, sx, FLOOR_Y - 20);
          this.floatText(sx, FLOOR_Y - 80, `+${e.value} glam`, '#ffd36b');
          break;
        case 'crash': {
          sfx.thud(true);
          this.shake = 0.3;
          this.burst(this.papers, 24, sx, sy);
          this.floatText(sx, sy - 40, `+${e.value}`, '#ffd36b');
          const w = this.add.image(sx, sy, 'setwall').setDisplaySize(212, 212).setDepth(13).setOrigin(0.5, 1);
          this.tweens.add({ targets: w, angle: 80, y: FLOOR_Y, alpha: 0, duration: 650, onComplete: () => w.destroy() });
          this.speech.say(null, 'Oops, the set!', 'urgent');
          break;
        }
        case 'sweep':
          sfx.fwip();
          this.floatText(sx, sy - 24, `+${e.value}`, '#dff3f5');
          break;
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
          this.burst(this.sparks, 12, sx, this.view.sy(e.y ?? 2));
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
          this.time.delayedCall(900, () => this.onEnd?.('gameover'));
          break;
        case 'levelDone':
          sfx.cheer();
          this.burst(this.confetti, 60, this.scale.width / 2, 120);
          this.time.delayedCall(1200, () => this.onEnd?.('complete'));
          break;
        case 'comboUp':
          sfx.pop();
          this.banner(`Combo x${e.value}!`, '#ffd36b', 900);
          break;
        case 'comboLost':
          this.floatText(this.scale.width / 2, 120, 'Combo lost', '#ff9f96');
          break;
        case 'passStep':
          this.floatText(sx, sy - 30, `+${e.value}`, '#bff0c8');
          break;
        case 'extraLife':
          sfx.cheer();
          this.banner('Extra life!', '#ff8da1', 1300);
          this.burst(this.confetti, 30, this.scale.width - 80, 40);
          break;
        case 'checkpoint':
          this.floatText(this.scale.width / 2, 150, 'Checkpoint', '#9fd9df');
          break;
        case 'respawn':
          this.resetWalk();
          this.view.camX = this.targetCamX();
          this.floatText(this.scale.width / 2, 170, STRINGS.newBucket, '#ffffff');
          break;
      }
    }
    if (this.state.bucket.lossRate > 3 && !this.state.finished) this.splashAt(Math.min(6, Math.round(this.state.bucket.lossRate / 3)));
  }

  private splashAt(n: number): void {
    const B = this.state.bucket;
    const bx = this.view.sx(B.xP) + Math.sin(B.phi) * this.tuning.bucketL * PX;
    const by = this.view.sy(B.yP) + Math.cos(B.phi) * this.tuning.bucketL * PX;
    this.burst(this.splash, n, bx, by + 12);
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '20px', color, fontStyle: 'bold', stroke: '#102024', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private burst(e: Phaser.GameObjects.Particles.ParticleEmitter, n: number, x: number, y: number): void {
    const f = [1, 0.5, 0.25][this.quality] ?? 0.25;
    e.explode(Math.max(1, Math.round(n * f)), x, y);
  }

  /** Adaptive quality: drop particles and light cones when the frame rate stays low, recover when it is healthy again. */
  private adaptQuality(dt: number): void {
    if (this.fpsSmoothed < 48) {
      this.lowFpsT += dt;
      this.highFpsT = 0;
    } else if (this.fpsSmoothed > 58) {
      this.highFpsT += dt;
      this.lowFpsT = 0;
    } else {
      this.lowFpsT = this.highFpsT = 0;
    }
    if (this.lowFpsT > 3 && this.quality < 2) {
      this.quality += 1;
      this.lowFpsT = 0;
    } else if (this.highFpsT > 12 && this.quality > 0) {
      this.quality -= 1;
      this.highFpsT = 0;
    }
  }

  private banner(text: string, color: string, ms: number): void {
    this.bannerText?.destroy();
    const t = this.add
      .text(this.scale.width / 2, 92, text, { fontFamily: FONT, fontSize: '24px', color, fontStyle: 'bold', stroke: '#102024', strokeThickness: 5, align: 'center', wordWrap: { width: this.scale.width - 120 } })
      .setOrigin(0.5)
      .setDepth(45);
    this.bannerText = t;
    this.tweens.add({ targets: t, alpha: 0, delay: ms, duration: 400, onComplete: () => { t.destroy(); if (this.bannerText === t) this.bannerText = null; } });
  }

  private showHints(): void {
    const hints = this.levelDef.data.hints;
    if (!hints) return;
    const [a, b] = this.state.players;
    const front = Math.max(a.x, b.x);
    hints.forEach((h, i) => {
      if (!this.hintsShown.has(i) && front >= h.x) {
        this.hintsShown.add(i);
        this.banner(h.text, '#ffffff', 3200);
      }
    });
  }

  private syncSofts(): void {
    const view = this.view;
    const gs = this.gProps;
    const live = new Set<number>();
    const now = this.time.now / 1000;
    const dt = this.lastDt;
    for (const o of this.state.softs) {
      const setPiece = o.kind === 'wheel' || o.kind === 'fan' || o.kind === 'weather';
      if (o.done && !setPiece) continue;
      const px = view.sx(o.x);
      if (px < -120 || px > this.scale.width + 120) continue;
      live.add(o.id);
      let img = this.softSprites.get(o.id);
      if (!img) {
        const key = o.kind === 'weather' ? 'weather-bad' : o.kind === 'wall' ? 'setwall' : o.kind;
        img = this.add.image(0, 0, key).setDepth(o.kind === 'balloon' ? 13 : setPiece ? 4 : 12);
        if (o.kind === 'balloon') {
          const palette = [0xff5a5f, 0xffd23f, 0x3bceac, 0x4ea8de, 0xb084f5, 0xff9f1c];
          img.setTint(palette[o.color % palette.length]!);
          img.setDisplaySize(o.r * 2 * PX * 1.15, o.r * 2 * PX * 1.5);
        } else if (o.kind === 'fan') {
          img.setOrigin(0.5, 0.35).setDisplaySize(o.r * 2 * PX * 1.3, o.r * 2 * PX * 1.56);
        } else if (o.kind === 'weather') {
          img.setOrigin(0.5, 0.37).setDisplaySize(o.r * 2 * PX * 1.3, o.r * 2 * PX * 1.3);
        } else {
          img.setDisplaySize(o.r * 2 * PX * 1.25, o.r * 2 * PX * 1.25);
        }
        this.softSprites.set(o.id, img);
      }
      const py0 = view.sy(o.y);
      if (setPiece) {
        const anim = this.softAnim.get(o.id) ?? { spin: 0, angle: 0 };
        this.softAnim.set(o.id, anim);
        gs.lineStyle(6, 0x4a545d, 1);
        gs.lineBetween(px, py0 + o.r * PX * (o.kind === 'wheel' ? 0.8 : 0.9), px, FLOOR_Y);
        gs.fillStyle(0x4a545d, 1);
        gs.fillRoundedRect(px - 24, FLOOR_Y - 6, 48, 8, 3);
        if (o.kind === 'wheel') {
          const prev = Math.floor(anim.angle / (Math.PI / 4));
          anim.angle += anim.spin * dt;
          anim.spin *= Math.pow(0.45, dt);
          if (anim.spin < 0.2) anim.spin = 0;
          if (Math.floor(anim.angle / (Math.PI / 4)) !== prev && anim.spin > 0.6) sfx.tick();
          img.setRotation(anim.angle);
          img.setPosition(px, py0);
        } else if (o.kind === 'fan') {
          anim.angle += (6 + anim.spin) * dt;
          anim.spin *= Math.pow(0.4, dt);
          img.setPosition(px, py0);
          const cx = px;
          const cy = py0;
          const rr = o.r * PX * 0.9;
          gs.fillStyle(0xaab6bf, 0.85);
          for (let k = 0; k < 3; k++) {
            const a = anim.angle + (k * Math.PI * 2) / 3;
            gs.fillTriangle(cx, cy, cx + Math.cos(a - 0.35) * rr, cy + Math.sin(a - 0.35) * rr, cx + Math.cos(a + 0.35) * rr, cy + Math.sin(a + 0.35) * rr);
          }
        } else {
          img.setTexture(o.done ? 'weather-good' : 'weather-bad');
          img.setPosition(px, py0);
        }
        continue;
      }
      const bob = Math.sin(now * 1.6 + o.id) * (o.kind === 'balloon' ? 4 : 1.5);
      const py = py0 + bob;
      const sway = Math.sin(now * 1.1 + o.id * 2) * (o.kind === 'balloon' ? 3 : 2);
      img.setPosition(px + sway, py);
      img.setRotation(sway * 0.01);
      gs.lineStyle(2, o.kind === 'balloon' ? 0x8f99a3 : 0xe8edf1, o.kind === 'balloon' ? 0.9 : 0.8);
      if (o.kind === 'balloon') gs.lineBetween(px + sway, py + o.r * PX * 0.75, px + sway * 0.3, 48);
      else gs.lineBetween(px + sway, py - o.r * PX * 0.6, px, 48);
    }
    for (const [id, img] of this.softSprites) {
      if (!live.has(id)) {
        img.destroy();
        this.softSprites.delete(id);
        this.softAnim.delete(id);
      }
    }
    this.syncDecor();
  }

  /** Studio set dressing: news desk, quiz set and talk-show couch in turn, with cameras and cameramen around them. */
  private syncDecor(): void {
    const view = this.view;
    const mixed = !!this.levelDef.data.mixed;
    if (!mixed && this.curTheme !== 'studio') return;
    const zoneLen = 70;
    const first = Math.floor((view.camX - 6) / zoneLen);
    const last = Math.floor((view.camX + this.scale.width / PX + 6) / zoneLen);
    const live = new Set<string>();
    const sets = ['news-desk', 'quiz-set', 'talk-set'];
    const put = (key: string, tex: string, x: number, w: number, h: number, flip = false): void => {
      const sx = view.sx(x);
      if (sx < -200 || sx > this.scale.width + 200) return;
      live.add(key);
      let img = this.decor.get(key);
      if (!img) {
        img = this.add.image(0, 0, tex).setOrigin(0.5, 1).setDepth(3).setDisplaySize(w, h);
        if (flip) img.setFlipX(true);
        this.decor.set(key, img);
      }
      img.setPosition(sx, FLOOR_Y + 2);
    };
    for (let z = Math.max(0, first); z <= last; z++) {
      const cx = z * zoneLen + 38;
      if (mixed && themeAtX(true, 'factory', cx) !== 'studio') continue;
      put(`set${z}`, sets[z % 3]!, cx, 320, 220);
      put(`cam${z}a`, 'camera', cx - 9, 80, 110);
      if (this.quality === 0) put(`man${z}a`, 'cameraman', cx - 11.2, 80, 110);
      if (z % 3 === 0) put(`tp${z}`, 'teleprompter', cx - 14.5, 56, 96);
      put(`cam${z}b`, 'camera', cx + 10, 80, 110, true);
      if (this.quality === 0) put(`man${z}b`, 'cameraman', cx + 12.2, 80, 110, true);
    }
    for (const [k, img] of this.decor) {
      if (!live.has(k)) {
        img.destroy();
        this.decor.delete(k);
      }
    }
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

  private ticker: Phaser.GameObjects.Text | null = null;
  private tickerBg: Phaser.GameObjects.Rectangle | null = null;

  private updateTicker(): void {
    const studio = this.curTheme === 'studio';
    if (studio && !this.ticker) {
      this.tickerBg = this.add.rectangle(0, FLOOR_Y + 26, this.scale.width, 20, 0x7a1a22, 0.9).setOrigin(0, 0).setDepth(8);
      this.ticker = this.add
        .text(0, FLOOR_Y + 28, 'LIVE  \u25B6  BREAKING: two men carry a ladder through the studio  \u25B6  Weather: sunny, if you flip the map  \u25B6  Sports: bucket still not empty  \u25B6  LIVE  \u25B6  BREAKING: two men carry a ladder through the studio  \u25B6  Weather: sunny, if you flip the map  \u25B6  Sports: bucket still not empty  \u25B6  ', { fontFamily: 'sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffe27a' })
        .setDepth(9);
    }
    this.ticker?.setVisible(studio);
    this.tickerBg?.setVisible(studio);
    if (studio && this.ticker) this.ticker.x = -((this.time.now * 0.06) % Math.max(300, this.ticker.width / 2));
  }

  private commercial = new Set<number>();

  private syncMarks(): void {
    const g = this.state.gen;
    if (!g) return;
    const front = Math.max(this.state.players[0].x, this.state.players[1].x);
    for (const m of g.marks) {
      if (!m.text.startsWith('COMMERCIAL') || this.commercial.has(m.x) || front < m.x - 6) continue;
      this.commercial.add(m.x);
      this.banner('COMMERCIAL BREAK!', '#ff6a74', 1600);
      sfx.tick();
    }
  }

  private syncTheme(): void {
    this.updateTicker();
    this.syncMarks();
    const d = this.levelDef.data;
    if (!d.mixed) return;
    const front = Math.max(this.state.players[0].x, this.state.players[1].x);
    const th = themeAtX(true, 'factory', front + 1);
    if (th === this.curTheme) return;
    this.curTheme = th;
    this.applyTheme(false);
    this.cameras.main.flash(260, 255, 255, 255);
    this.banner(th === 'studio' ? 'Now entering: TV Studio' : 'Back to the Factory', '#ffd36b', 1800);
  }

  private gates(): Array<{ x: number; to: 'factory' | 'studio' }> {
    const d = this.levelDef.data;
    const out: Array<{ x: number; to: 'factory' | 'studio' }> = [];
    if (d.mixed) {
      const z0 = Math.max(1, Math.floor(this.view.camX / MIXED_ZONE));
      for (let z = z0; z <= z0 + 1; z++) out.push({ x: z * MIXED_ZONE, to: z % 2 === 1 ? 'studio' : 'factory' });
    } else {
      const nx = nextLevel(this.levelDef.id);
      if (nx && nx.theme !== this.levelDef.theme && d.length < 1e8) out.push({ x: d.length - 1, to: nx.theme });
    }
    return out;
  }

  private drawGates(): void {
    const g = this.gProps;
    let label: { sx: number; text: string } | null = null;
    for (const gate of this.gates()) {
      const sx = this.view.sx(gate.x);
      if (sx < -200 || sx > this.scale.width + 200) continue;
      const studio = gate.to === 'studio';
      const col = studio ? 0xb03a5c : 0xd8a62a;
      g.fillStyle(0x2b2f36);
      g.fillRect(sx - 90, FLOOR_Y - 250, 22, 250);
      g.fillRect(sx + 68, FLOOR_Y - 250, 22, 250);
      g.fillStyle(col);
      g.fillRect(sx - 100, FLOOR_Y - 290, 200, 46);
      g.fillStyle(0xffffff, 0.12);
      g.fillRect(sx - 68, FLOOR_Y - 244, 136, 244);
      label = { sx, text: studio ? 'TV STUDIO' : 'FACTORY' };
    }
    if (!this.gateText) this.gateText = this.add.text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(7);
    this.gateText.setVisible(!!label);
    if (label) this.gateText.setText(label.text).setPosition(label.sx, FLOOR_Y - 267);
  }

  private applyTheme(clear = true): void {
    if (!this.layers) return;
    const studio = this.curTheme === 'studio';
    this.layers.wall.setTexture(studio ? 'studio-wall' : 'wall');
    this.layers.pipes.setTexture(studio ? 'studio-top' : 'pipes');
    this.layers.floor.setTexture(studio ? 'studio-floor' : 'floor');
    this.layers.ceiling.setTexture(studio ? 'studio-ceiling' : 'ceiling');
    if (!clear) return;
    for (const img of this.lampSprites.values()) img.destroy();
    this.lampSprites.clear();
    for (const img of this.stepSprites.values()) img.destroy();
    this.stepSprites.clear();
    for (const img of this.softSprites.values()) img.destroy();
    this.softSprites.clear();
    this.softAnim.clear();
    for (const img of this.decor.values()) img.destroy();
    this.decor.clear();
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

    this.syncTheme();
    this.syncProps();
    this.drawGates();
    this.syncSofts();
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
      const meat = l.kind !== 'lamp';
      g.lineStyle(meat ? 5 : 4, COLORS.cord);
      g.lineBetween(px, 48, px, py);
      g.lineBetween(px, py, topX, topY);
      g.fillStyle(COLORS.cord);
      g.fillCircle(px, py, 6);
      let img = this.lampSprites.get(l.id);
      if (!img) {
        img = this.add.image(0, 0, meat ? l.kind : this.curTheme === 'studio' ? 'studio-cap' : 'lamp-cap').setOrigin(0.5, 0).setDepth(12);
        if (meat) img.setDisplaySize(l.radius * 2 * PX * 1.05, l.radius * 2 * PX * 1.2);
        this.lampSprites.set(l.id, img);
      }
      img.setPosition(topX, topY).setRotation(-l.psi);
      if (!meat && l.broken) {
        img.setTint(0x555a60);
        if (Math.random() < 0.08) this.burst(this.sparks, 2, cx, cy + 14);
        continue;
      }
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
      if (this.quality === 0) {
      g.fillStyle(color, 0.16);
      g.beginPath();
      g.moveTo(sxp - nx * 18, syp - ny * 18);
      g.lineTo(sxp + nx * 18, syp + ny * 18);
      g.lineTo(fx0 + nx * 110, Math.min(FLOOR_Y, fy0 + ny * 110));
      g.lineTo(fx0 - nx * 110, Math.min(FLOOR_Y, fy0 - ny * 110));
      g.closePath();
      g.fillPath();
      }
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

    this.updateDark(s);

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
    const topHalf = 16;
    const botHalf = 12;
    const bucketTop = 19;
    const bucketH = 25;
    const theta = -B.phi;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const toScreen = (lx: number, ly: number): [number, number] => [bx + lx * cos - ly * sin, by + lx * sin + ly * cos];
    const surface = bucketTop + bucketH * (1 - fill);
    const up: [number, number] = [-sin, -cos];
    let poly: [number, number][] = [
      [-topHalf, bucketTop],
      [topHalf, bucketTop],
      [botHalf, bucketTop + bucketH],
      [-botHalf, bucketTop + bucketH],
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
