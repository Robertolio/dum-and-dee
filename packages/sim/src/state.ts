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
}

export type StepKind = 'bracket' | 'crate' | 'pallet' | 'banana' | 'duck' | 'pail' | 'tyre' | 'cheese' | 'stair';

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
  | 'stepCaught'
  | 'stepMissed'
  | 'bucketEmpty'
  | 'slip'
  | 'bump'
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
  patterns: number;
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
  /** Procedural level generator (null for fixed levels). */
  gen: GenState | null;
  balance: number;
  balanceTimer: number;
  score: number;
  lives: number;
  distance: number;
  gameOver: boolean;
  /** Events raised during the most recent step() call. */
  events: GameEvent[];
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
