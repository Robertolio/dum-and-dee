import type { GameState, PlayerState } from './state';
import type { PlayerInput } from './input';
import { clampInput } from './input';
import type { Tuning } from './tuning';
import { DEFAULT_TUNING } from './tuning';
import { approach, clamp, springStep } from './math';
import { integrateHorizontal, integrateVertical, resetPlayerRow, yHand } from './ladder';
import { evaluateStepCatch, integrateStepUps, updateStepTargets } from './stepup';
import { integrateBucket, primeBucket } from './bucket';
import { integrateLamps } from './lamp';
import { integrateBeams, integrateJump, resolveObstacles } from './obstacles';
import { buildBeams, buildLamps, buildSteps, createGen, ENDLESS_LEVEL, extendLevel, type LevelData } from './level';

export function createPlayer(x: number, t: Tuning): PlayerState {
  const h = t.hUpright;
  return {
    x,
    v: 0,
    h,
    hVel: 0,
    hTargetSmooth: h,
    hTarget: h,
    push: 0,
    yFloor: 0,
    yFloorVel: 0,
    yFloorTarget: 0,
    yFloorTargetSmooth: 0,
    stepSlowTimer: 0,
    stepping: false,
    stepPeakAccel: 0,
    stepTime: 0,
    stepSize: 0,
    stepHandStart: yHand(h, t),
    stepHandDev: 0,
    slipTimer: 0,
    jumpT: 0,
    jumpY: 0,
    jumpHeld: false,
    jumpReq: false,
    bumpCd: 0,
    yHandRaw: yHand(h, t),
    y: yHand(h, t),
    yVel: 0,
  };
}

export function createState(level: LevelData = ENDLESS_LEVEL, t: Tuning = DEFAULT_TUNING, startX = 2): GameState {
  const a = createPlayer(startX, t);
  const b = createPlayer(startX + t.L0, t);
  const s: GameState = {
    tick: 0,
    time: 0,
    players: [a, b],
    ladder: {
      kickX: 0,
      kickY: 0,
      kickVX: 0,
      kickVY: 0,
      lift: 0,
      theta: 0,
      thetaDot: 0,
      over: 0,
      highSide: 0,
      tension: 0,
    },
    bucket: {
      phi: 0,
      phiDot: 0,
      xP: 0,
      yP: 0,
      vPx: 0,
      vPy: 0,
      aPx: 0,
      aPy: 0,
      aPxF: 0,
      aPyF: 0,
      jerk: 0,
      water: 100,
      lossRate: 0,
      splash: 0,
    },
    lamps: buildLamps(level, t),
    steps: buildSteps(level),
    beams: buildBeams(level),
    gen: null,
    balance: 0,
    balanceTimer: 0,
    score: 0,
    lives: t.startLives,
    distance: 0,
    gameOver: false,
    events: [],
  };
  s.gen = createGen(level, s.lamps.length, s.steps.length, s.beams.length);
  extendLevel(s, startX, t);
  primeBucket(s);
  return s;
}

function integratePosture(p: PlayerState, t: Tuning): void {
  const dt = t.dt;
  p.hTargetSmooth = approach(p.hTargetSmooth, p.hTarget, t.hTargetRate * dt);
  const tau = p.hTargetSmooth > p.h ? t.hRise : t.hFall;
  const omega = 2 / tau;
  [p.h, p.hVel] = springStep(p.h, p.hVel, p.hTargetSmooth, omega, dt);
  p.h = clamp(p.h, 0, 1);
}

function updateBalance(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const L = s.ladder;
  // Tempo term uses the *wanted* speed difference (push), because the coupling
  // equalises the actual speeds almost immediately.
  const bal =
    t.wS * (L.tension / t.sMax) +
    t.wV * (b.push - a.push) +
    t.wOver * (L.over / t.overMax) * L.highSide;
  s.balance = clamp(bal, -1, 1);

  if (Math.abs(s.balance) > t.balanceFail) {
    s.balanceTimer += t.dt;
    if (s.balanceTimer >= t.balanceFailTime) {
      s.balanceTimer = 0;
      loseLife(s, 'ladderSlipped', t);
      resetPlayerRow(a, b, t);
      L.kickX = L.kickY = L.kickVX = L.kickVY = 0;
      s.bucket.phi = 0;
      s.bucket.phiDot = 0;
    }
  } else if (Math.abs(s.balance) < t.balanceRest) {
    s.balanceTimer = 0;
  }
}

function loseLife(s: GameState, type: 'ladderSlipped' | 'bucketEmpty', _t: Tuning): void {
  s.lives = Math.max(0, s.lives - 1);
  s.events.push({ tick: s.tick, type, value: s.lives, x: s.bucket.xP, y: s.bucket.yP });
  if (s.lives === 0) {
    s.gameOver = true;
    s.events.push({ tick: s.tick, type: 'gameOver' });
  }
}

function updateWaterAndLives(s: GameState, t: Tuning): void {
  if (s.bucket.water <= 0 && !s.gameOver) {
    loseLife(s, 'bucketEmpty', t);
    s.bucket.water = 100;
    s.bucket.phi = 0;
    s.bucket.phiDot = 0;
  }
}

function updateScore(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const xLadder = (a.x + b.x) / 2;
  const travelled = Math.floor(xLadder - (2 + t.L0 / 2));
  if (travelled > s.distance) {
    s.score += (travelled - s.distance) * t.scoreDistance;
    s.distance = travelled;
  }
}

/**
 * Advance the simulation by exactly one fixed tick.
 * Pure with respect to the inputs: no Date.now(), no Math.random().
 */
export function step(s: GameState, inputs: readonly [PlayerInput, PlayerInput], t: Tuning = DEFAULT_TUNING): GameState {
  s.events = [];
  if (s.gameOver) return s;

  for (let i = 0; i < 2; i++) {
    const inp = clampInput(inputs[i]!);
    const p = s.players[i]!;
    p.hTarget = inp.hTarget;
    p.push = inp.push;
    p.jumpReq = !!inp.jump && !p.jumpHeld;
    p.jumpHeld = !!inp.jump;
  }

  extendLevel(s, (s.players[0].x + s.players[1].x) / 2, t);
  updateStepTargets(s, t);
  integrateStepUps(s, t);
  for (const p of s.players) integrateJump(p, t);
  for (const p of s.players) integratePosture(p, t);
  integrateHorizontal(s, t);
  resolveObstacles(s, t);
  integrateVertical(s, t);
  integrateLamps(s, t);
  integrateBeams(s, t);
  integrateBucket(s, t);
  evaluateStepCatch(s, t);
  updateBalance(s, t);
  updateWaterAndLives(s, t);
  updateScore(s, t);

  s.tick += 1;
  s.time = s.tick * t.dt;
  return s;
}

/** Convenience: run `n` ticks with constant inputs. */
export function run(s: GameState, inputs: readonly [PlayerInput, PlayerInput], n: number, t: Tuning = DEFAULT_TUNING): GameState {
  for (let i = 0; i < n; i++) step(s, inputs, t);
  return s;
}
