/**
 * All simulation tuning values in one JSON-serialisable object.
 *
 * Units: "we" = world units (1 we = 100 px at the 540 px reference height).
 * Start values follow the tuning table in the build plan (section 2.3).
 * Values that had to deviate from the plan for a playable first feel are
 * marked with "(deviates)" and explained in docs/tuning-log.md.
 */
export interface Tuning {
  /** Fixed simulation time step (s). */
  dt: number;

  // --- Walking and ladder coupling ---
  /** Max walking speed at push = 1 (we/s). */
  vMax: number;
  /** Max horizontal acceleration (we/s²). */
  aMax: number;
  /** Rest distance between the two pairs of hands (we). */
  L0: number;
  /** Ladder coupling spring stiffness. */
  k: number;
  /** Ladder coupling damping. */
  c: number;

  // --- Posture ---
  /** Time constant of the posture spring when rising (s). */
  hRise: number;
  /** Time constant of the posture spring when lowering (s). */
  hFall: number;
  /** Posture target is rate-limited to this (1/s) so acceleration stays finite (deviates: added). */
  hTargetRate: number;
  /** Hand height above the ground = yHandBase + yHandRange * h (we). */
  yHandBase: number;
  yHandRange: number;
  /** Neutral posture (standing upright, ladder on the shoulder). */
  hUpright: number;
  /** Bent posture used by the digital control scheme. */
  hBent: number;

  // --- Step-ups (floor obstacles) ---
  /** Time constant of the step-up spring (s). */
  tStep: number;
  /** Rate limit of the step-up target (we/s): how fast the foot lifts (deviates: added). */
  stepRate: number;
  /** Push multiplier while stepping. */
  stepPushFactor: number;
  /** Duration of the push dip after a step begins (s). */
  stepPushTime: number;
  /** Half width of a player's foot span used for step detection (we). */
  footHalf: number;
  /** A step counts as caught when the hand moved less than this fraction of the step height. */
  catchTolerance: number;

  // --- Obstacles, jumping, slipping ---
  /** Rise (we) a player walks up automatically (stair treads); anything higher blocks unless jumped. */
  autoStepMax: number;
  /** Jump duration (s), height of the body arc (we) and the share of it the hands follow (knees absorb the rest). */
  jumpTime: number;
  jumpHeight: number;
  jumpHand: number;
  /** Friction deceleration of a pushed obstacle (we/s²). */
  pushFriction: number;
  /** Banana slip: duration (s), water loss, ladder jolt. */
  slipTime: number;
  slipSplash: number;
  slipKick: number;
  /** Ceiling beam hit: water loss, rebound speed of both players (we/s), cooldown (s). */
  beamSplash: number;
  beamRebound: number;
  beamCooldown: number;

  // --- Arm reach ---
  /** Max height difference the two players can hold (we). Starts generous. */
  dyMax: number;

  // --- Balance meter (tension on the ladder) ---
  /** Tension that fills the tension term of the balance meter (we). */
  sMax: number;
  /** Arm-reach excess that fills the reach term of the balance meter (we). */
  overMax: number;
  /** Weight of the tension term. */
  wS: number;
  /** Weight of the tempo term (difference in push between the players). */
  wV: number;
  /** Weight of the arm-reach term. */
  wOver: number;
  balanceFail: number;
  balanceFailTime: number;
  balanceRest: number;

  // --- Ladder geometry ---
  ladderLength: number;
  ladderOverhang: number;
  ladderThickness: number;
  mLadder: number;

  // --- Ladder kick (damped disturbance after an impulse) ---
  kickOmega: number;
  kickZeta: number;

  // --- Bucket pendulum ---
  g: number;
  bucketL: number;
  bucketD: number;
  bucketCTheta: number;
  /** Height of the bucket body below its rope end (we), half its width, and how fast the ladder is lifted/lowered to keep it off the ground (we/s). */
  bucketBody: number;
  bucketHalfW: number;
  liftUp: number;
  liftDown: number;

  // --- Water loss ---
  phiSafeDeg: number;
  kPhi: number;
  aSafe: number;
  kV: number;
  jSafe: number;
  kJ: number;
  /** Low-pass time constant applied to the suspension-point acceleration before it drives water loss (s) (deviates: added). */
  accelFilter: number;

  // --- Lamp pendulum ---
  lampL: number;
  lampD: number;
  lampE: number;
  lampR: number;
  lampM: number;
  lampCapBottomRest: number;
  lampTickCooldown: number;
  lampFirstSplash: number;
  lampTickSplash: number;
  /** Relative speed assumed for a first contact at least (so a graze counts). */
  lampMinRelVel: number;
  /** Minimum approach speed for a follow-up tick; slower contact is sliding and costs nothing. */
  lampTickMinVel: number;
  /** Fraction of the normal impulse converted to lamp swing even for a straight-up hit. */
  lampSwingBias: number;

  // --- Hanging meat (big swinging pendulum, same collision as the lamp) ---
  meatL: number;
  meatR: number;
  meatM: number;
  meatD: number;
  /** Swing amplitude range (rad) of a freshly generated piece. */
  meatAmpMin: number;
  meatAmpMax: number;

  // --- Scoring ---
  scoreDistance: number;
  scoreLampClean: number;
  scoreStepCaught: number;
  startLives: number;
}

export const DEFAULT_TUNING: Tuning = {
  dt: 1 / 60,

  vMax: 3.5,
  aMax: 8,
  L0: 4.2,
  k: 60,
  c: 10,

  hRise: 0.12,
  hFall: 0.1,
  hTargetRate: 4,
  yHandBase: 0.6,
  yHandRange: 1.5,
  hUpright: 0.8,
  hBent: 0.2,

  tStep: 0.22,
  stepRate: 6,
  stepPushFactor: 0.7,
  stepPushTime: 0.3,
  footHalf: 0.25,
  catchTolerance: 0.5,

  autoStepMax: 0.22,
  jumpTime: 0.7,
  jumpHeight: 0.9,
  jumpHand: 0.3,
  pushFriction: 5,
  slipTime: 0.9,
  slipSplash: 10,
  slipKick: 1.2,
  beamSplash: 12,
  beamRebound: 1.5,
  beamCooldown: 0.7,

  dyMax: 1.3,

  sMax: 0.15, // deviates from plan (0.5): with aMax = 8 the steady-state tension never exceeds aMax/k ≈ 0.13
  overMax: 0.3,
  wS: 0.45,
  wV: 0.5, // deviates from plan (0.25): applied to the push difference, see step.ts
  wOver: 0.3,
  balanceFail: 0.9,
  balanceFailTime: 0.6,
  balanceRest: 0.35,

  ladderLength: 7.24, // L0 + 2 × overhang
  ladderOverhang: 1.52, // 1.2 + one rung spacing (0.32 we) // playtest: ladder sticks out much further over the shoulders
  ladderThickness: 0.15,
  mLadder: 1,

  kickOmega: 20,
  kickZeta: 0.5,

  g: 9.81,
  bucketL: 0.5,
  bucketD: 1.5,
  bucketCTheta: 0.15,
  bucketBody: 0.48,
  bucketHalfW: 0.25,
  liftUp: 8,
  liftDown: 2,

  phiSafeDeg: 15,
  kPhi: 0.12,
  aSafe: 6,
  kV: 0.8,
  jSafe: 150, // deviates from plan (25): vertical jerk only; a calm bend peaks at ~380, so this term only bites on real stutter
  kJ: 0.01,
  accelFilter: 0.05,

  lampL: 1.2,
  lampD: 0.5,
  lampE: 0.4,
  lampR: 0.35,
  lampM: 0.5,
  lampCapBottomRest: 1.5,
  lampTickCooldown: 0.15,
  lampFirstSplash: 8,
  lampTickSplash: 4,
  lampMinRelVel: 1.0,
  lampTickMinVel: 0.6,
  lampSwingBias: 0.6,

  meatL: 1.0,
  meatR: 0.5,
  meatM: 1.2,
  meatD: 0.03,
  meatAmpMin: 0.35,
  meatAmpMax: 0.65,

  scoreDistance: 1,
  scoreLampClean: 100,
  scoreStepCaught: 50,
  startLives: 3,
};

export function cloneTuning(t: Tuning = DEFAULT_TUNING): Tuning {
  return { ...t };
}
