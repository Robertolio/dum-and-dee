export type PlayerId = 0 | 1; // 0 = Dum (A, back, blue), 1 = Dee (B, front, red)

export interface PlayerState {
  x: number;
  v: number;
  /** Posture 0…1 and its velocity. */
  h: number;
  hVel: number;
  /** Rate-limited posture target actually driving the spring. */
  hTargetSmooth: number;
  hTarget: number;
  push: number;
  /** Height of the step-up object the player stands on (0 = floor). */
  yFloor: number;
  yFloorVel: number;
  yFloorTarget: number;
  yFloorTargetSmooth: number;
  stepSlowTimer: number;
  stepping: boolean;
  stepPeakAccel: number;
  stepTime: number;
  /** Height difference of the current step (we). */
  stepSize: number;
  /** Effective hand height when the step began and the largest deviation from it since. */
  stepHandStart: number;
  stepHandDev: number;
  slipTimer: number;
  /** Jump: time since take-off (0 = on the ground), body arc height (we), previous jump input. */
  jumpT: number;
  jumpY: number;
  jumpHeld: boolean;
  jumpReq: boolean;
  bumpCd: number;
  /** Requested hand height above the floor (before arm reach). */
  yHandRaw: number;
  /** Effective hand height (after arm reach and ladder kick). */
  y: number;
  /** Vertical velocity of the effective hand height. */
  yVel: number;
}

export interface LadderState {
  kickX: number;
  kickY: number;
  kickVX: number;
  kickVY: number;
  /** Extra lift (we) applied to both hands so the bucket never touches the floor or an obstacle. */
  lift: number;
  theta: number;
  thetaDot: number;
  /** Arm-reach excess (we), 0 when within reach. */
  over: number;
  /** +1 when B's hand is the higher one, −1 when A's. */
  highSide: number;
  /** Ladder tension s = (xB − xA) − L0. */
  tension: number;
}

export interface BucketState {
  phi: number;
  phiDot: number;
  xP: number;
  yP: number;
  vPx: number;
  vPy: number;
  aPx: number;
  aPy: number;
  /** Low-pass filtered accelerations used for water loss. */
  aPxF: number;
  aPyF: number;
  jerk: number;
  water: number;
  /** Current water loss rate (%/s), for visuals. */
  lossRate: number;
  /** Peak |aPy| in the last second-ish, for the HUD/debug. */
  splash: number;
}

export type LampKind = 'lamp' | 'meat';

export interface LampState {
  id: number;
  kind: LampKind;
  /** Cord length, cap radius, damping and mass of this pendulum. */
  len: number;
  radius: number;
  damp: number;
  mass: number;
  x: number;
  pivotY: number;
  psi: number;
  psiDot: number;
  cooldown: number;
  hits: number;
  passed: boolean;
  broken: boolean;
}

export type StepKind = 'bracket' | 'crate' | 'pallet' | 'banana' | 'duck' | 'pail' | 'tyre' | 'cheese' | 'knife' | 'stair';

export interface StepObstacle {
  id: number;
  x0: number;
  x1: number;
  hObj: number;
  kind: StepKind;
  /** Pushable props: mass, sliding velocity and total distance slid. Bananas: `used` once slipped on. */
  mass: number;
  vx: number;
  slid: number;
  used: boolean;
  passed: boolean;
  dirty: boolean;
}

/** Things the ladder simply passes through: balloons are popped, cobwebs are swept away. */
export interface SoftObstacle {
  id: number;
  kind: 'balloon' | 'web';
  x: number;
  y: number;
  r: number;
  /** Colour index for balloons. */
  color: number;
  done: boolean;
}

export interface BeamObstacle {
  id: number;
  x0: number;
  x1: number;
  /** Height of the underside of the beam (we). */
  yBottom: number;
  cooldown: number;
}

export type GameEventType =
  | 'lampHit'
  | 'lampTick'
  | 'lampClean'
  | 'lampBreak'
  | 'lightsOn'
  | 'stepCaught'
  | 'stepMissed'
  | 'bucketEmpty'
  | 'pop'
  | 'sweep'
  | 'slip'
  | 'bump'
  | 'comboUp'
  | 'comboLost'
  | 'checkpoint'
  | 'respawn'
  | 'extraLife'
  | 'levelDone'
  | 'passStep'
  | 'bucketBonk'
  | 'push'
  | 'beamHit'
  | 'ladderSlipped'
  | 'gameOver';

export interface GameEvent {
  tick: number;
  type: GameEventType;
  player?: PlayerId;
  value?: number;
  x?: number;
  y?: number;
}

export interface GenState {
  rng: number;
  nextX: number;
  nextLampId: number;
  nextStepId: number;
  nextBeamId: number;
  nextSoftId: number;
  patterns: number;
  /** Index of the previous pattern kind (no immediate repeats) and the one before it. */
  last: number;
  last2: number;
  /** Extra/less spacing after the pattern just emitted (quiet stretches, busy combos). */
  gapScale: number;
}

export interface LevelResult {
  score: number;
  stars: number;
  water: number;
  waterBonus: number;
  lifeBonus: number;
  timeBonus: number;
  bestCombo: number;
  time: number;
}

export interface GameState {
  tick: number;
  time: number;
  players: [PlayerState, PlayerState];
  ladder: LadderState;
  bucket: BucketState;
  lamps: LampState[];
  steps: StepObstacle[];
  beams: BeamObstacle[];
  softs: SoftObstacle[];
  /** Darkness after a lamp broke: lights return near the next intact lamp. */
  dark: boolean;
  bucketCd: number;
  darkFromX: number;
  /** Procedural level generator (null for fixed levels). */
  gen: GenState | null;
  balance: number;
  balanceTimer: number;
  score: number;
  lives: number;
  distance: number;
  gameOver: boolean;
  combo: number;
  comboMult: number;
  bestCombo: number;
  checkpointX: number;
  nextLifeScore: number;
  livesLost: number;
  /** Scripted levels end at levelLength; par is the time (s) for the full time bonus. */
  levelLength: number;
  par: number;
  finished: boolean;
  result: LevelResult | null;
  /** Events raised during the most recent step() call. */
  events: GameEvent[];
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
