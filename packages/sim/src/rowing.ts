import type { BridgeKind, GameState, RowRower, RowState } from './state';
import type { PlayerInput } from './input';
import { clampInput } from './input';
import type { LevelData } from './level';
import type { Tuning } from './tuning';
import { approach, clamp } from './math';

/** Rowing race constants (kept out of Tuning: they are not part of the carry-the-ladder feel). */
export const ROW = {
  /** Shot after this many seconds, so the starter has time to raise the pistol. */
  gunDelay: 2.5,
  /** How fast a rower's stroke position follows the input (stroke units per second). */
  strokeRate: 3.6,
  /** Blade lift speed (per second). */
  liftRate: 4,
  /** Lift below which the blade is in the water. */
  waterLift: 0.2,
  /** Thrust per stroke unit pulled through the water. */
  thrust: 1.1,
  drag: 0.35,
  dragQuad: 0.06,
  /** Stroke positions further apart than this make the oars clash. */
  clashGap: 0.8,
  /** Gap at which synchrony reaches zero. */
  syncGap: 0.55,
  /** Half-length of the hull around its middle. */
  bow: 2.5,
  /** Minimum speed to pop a buoy. */
  popSpeed: 2.3,
  /** Duck: half-width of the hit zone, minimum jump height that clears it, and jump duration (s). */
  duckZone: 0.45,
  duckClear: 0.12,
  jumpTime: 0.85,
  /** Bridge glide: drag is multiplied by this from `glideBefore` we ahead of a bridge until its end. */
  glide: 0.25,
  glideBefore: 3,
  hullClash: 3,
  hullDuck: 8,
  hullBridge: 8,
  hullBuoy: 3,
  scoreBuoy: 100,
  scoreDuck: 50,
  scoreBridge: 150,
  /** Distance between the two rowers (centre to centre), also the "ladder" length for respawn. */
  seat: 1.8,
  /** Skiff speed to metres per second, for the HUD. */
  metres: 1.35,
} as const;

export const rowSpeedMs = (v: number): number => Math.max(0, v) * ROW.metres;

/** Highest blade lift that still clears a bridge, at position u (0..1) along it. */
export function bridgeCeiling(kind: BridgeKind, u: number): number {
  switch (kind) {
    case 'low':
      return 0.74;
    case 'wood':
      return 0.82;
    case 'arch':
      return 0.72 + 0.28 * Math.sin(Math.PI * clamp(u, 0, 1));
    case 'stone':
      return 0.92;
  }
}

const newRower = (): RowRower => ({ a: 0.3 / 1.3, lift: 0, drive: false });

export function createRow(level: LevelData): RowState | null {
  const r = level.rowing;
  if (!r) return null;
  return {
    x: 2 + ROW.seat / 2,
    v: 0,
    roll: 0,
    rollVel: 0,
    jumpT: 0,
    jumpY: 0,
    jumpHeld: false,
    gunTick: Math.round(ROW.gunDelay * 60),
    started: false,
    raceTime: 0,
    sync: 1,
    rowers: [newRower(), newRower()],
    clashCd: 0,
    bridgeCd: 0,
    ducks: r.ducks.map((x) => ({ x, done: false })),
    buoys: r.buoys.map((x) => ({ x, done: false, cd: 0, tries: 0 })),
    bridges: r.bridges.map((b) => ({ ...b, done: false, hit: false })),
    strokes: [0, 0],
  };
}

/** Raw hTarget (posture) to blade lift: upright = in the water, bent = as high as possible. */
export function liftFromInput(h: number, t: Tuning): number {
  return 1 - clamp((h - t.hBent) / (t.hUpright - t.hBent), 0, 1);
}

export function integrateRowing(s: GameState, inputs: readonly [PlayerInput, PlayerInput], t: Tuning): void {
  const r = s.row!;
  const dt = t.dt;
  const ev = s.events;
  const at = (type: Parameters<typeof ev.push>[0]['type'], extra: { player?: 0 | 1; value?: number; x?: number } = {}): void => {
    ev.push({ tick: s.tick, type, ...extra });
  };

  if (!r.started && s.tick >= r.gunTick) {
    r.started = true;
    at('gun', { x: r.x });
  }

  const da: [number, number] = [0, 0];
  for (let i = 0; i < 2; i++) {
    const inp = clampInput(inputs[i]!);
    const w = r.rowers[i]!;
    const target = clamp((inp.push + 0.3) / 1.3, 0, 1);
    const before = w.a;
    w.a = approach(w.a, target, ROW.strokeRate * dt);
    da[i] = w.a - before;
    w.lift = approach(w.lift, liftFromInput(inp.hTarget, t), ROW.liftRate * dt);
    const wasIn = w.drive;
    const inWater = w.lift < ROW.waterLift;
    w.drive = r.started && inWater && da[i]! > 1e-4;
    if (inWater && da[i]! > 1e-4 && !wasIn && r.started) {
      r.strokes[i as 0 | 1] += 1;
      at('oarDip', { player: i as 0 | 1, x: r.x });
    }
  }
  const jumpNow = !!inputs[0].jump || !!inputs[1].jump;
  const jumpReq = jumpNow && !r.jumpHeld;
  r.jumpHeld = jumpNow;

  const gap = Math.abs(r.rowers[0].a - r.rowers[1].a);
  const inst = 1 - clamp(gap / ROW.syncGap, 0, 1);
  r.sync += (inst - r.sync) * (1 - Math.exp(-dt / 0.25));

  const q = 0.3 + 0.7 * r.sync;
  let thrust = 0;
  const drive = [0, 0];
  for (let i = 0; i < 2; i++) {
    const w = r.rowers[i]!;
    if (w.drive) {
      drive[i] = da[i]! * (0.6 + 0.8 * Math.sin(Math.PI * w.a));
      thrust += drive[i]! * ROW.thrust * q;
    }
  }
  r.v += thrust;
  const gliding = r.bridges.some((b) => r.x > b.x0 - ROW.glideBefore && r.x < b.x1);
  r.v -= (ROW.drag * r.v + ROW.dragQuad * r.v * Math.abs(r.v)) * dt * (gliding ? ROW.glide : 1);
  r.v = Math.max(-2.5, r.v);

  r.rollVel += (drive[0]! - drive[1]!) * 7 + (r.rowers[1].a - r.rowers[0].a) * 0.2 * dt;
  r.rollVel += (-26 * r.roll - 4 * r.rollVel) * dt;
  r.roll += r.rollVel * dt;
  if (Math.abs(r.roll) > 0.3) r.v -= r.v * 0.6 * dt;

  r.clashCd = Math.max(0, r.clashCd - dt);
  r.bridgeCd = Math.max(0, r.bridgeCd - dt);
  if (r.started && gap > ROW.clashGap && r.clashCd <= 0 && Math.abs(da[0]! - da[1]!) > 1e-4) {
    r.clashCd = 0.9;
    r.v *= 0.6;
    r.rollVel += (r.rowers[0].a > r.rowers[1].a ? -1 : 1) * 2.5;
    s.bucket.water -= ROW.hullClash;
    at('oarClash', { x: r.x });
  }

  if (jumpReq && r.jumpT <= 0) r.jumpT = dt;
  if (r.jumpT > 0) {
    r.jumpT += dt;
    if (r.jumpT >= ROW.jumpTime) {
      r.jumpT = 0;
      r.jumpY = 0;
    } else {
      const u = r.jumpT / ROW.jumpTime;
      r.jumpY = t.jumpHeight * 4 * u * (1 - u);
    }
  }

  r.x += r.v * dt;
  if (r.started) r.raceTime += dt;

  for (const d of r.ducks) {
    if (d.done) continue;
    const rel = d.x - r.x;
    if (Math.abs(rel) < ROW.duckZone && r.jumpY < ROW.duckClear) {
      d.done = true;
      r.v *= 0.5;
      s.bucket.water -= ROW.hullDuck;
      at('duckHit', { x: d.x, value: 0 });
    } else if (rel < -ROW.duckZone) {
      d.done = true;
      s.score += ROW.scoreDuck * s.comboMult;
      at('duckJump', { x: d.x, value: ROW.scoreDuck * s.comboMult });
    }
  }

  for (const b of r.buoys) {
    b.cd = Math.max(0, b.cd - dt);
    if (b.done || b.cd > 0) continue;
    const rel = b.x - (r.x + ROW.bow);
    if (rel <= 0 && rel > -1.2) {
      if (r.v >= ROW.popSpeed - 0.4 * b.tries) {
        b.done = true;
        r.v *= 0.88;
        s.score += ROW.scoreBuoy * s.comboMult;
        at('buoyPop', { x: b.x, value: ROW.scoreBuoy * s.comboMult });
      } else {
        b.cd = 0.7;
        b.tries += 1;
        r.x = b.x - ROW.bow - 0.15;
        r.v = -(1 + 0.4 * Math.max(0, r.v));
        s.bucket.water -= ROW.hullBuoy;
        at('buoyBounce', { x: b.x });
      }
    } else if (rel < -1.2) b.done = true;
  }

  for (const br of r.bridges) {
    const under = r.x > br.x0 && r.x < br.x1;
    if (under) {
      const u = (r.x - br.x0) / (br.x1 - br.x0);
      const ceil = bridgeCeiling(br.kind, u);
      for (const w of r.rowers) {
        const bad = w.lift > ceil ? 1 : w.lift < ROW.waterLift ? 2 : 0;
        if (bad && r.bridgeCd <= 0) {
          r.bridgeCd = 1.2;
          br.hit = true;
          r.v *= 0.5;
          r.rollVel += 1.5;
          s.bucket.water -= ROW.hullBridge;
          at('bridgeHit', { x: r.x, value: bad });
        }
      }
    } else if (!br.done && r.x >= br.x1) {
      br.done = true;
      if (!br.hit) {
        s.score += ROW.scoreBridge * s.comboMult;
        at('bridgePass', { x: br.x1, value: ROW.scoreBridge * s.comboMult });
      }
    }
  }

  s.balance = clamp((r.rowers[1].a - r.rowers[0].a) / ROW.syncGap, -1, 1);
}

/** Put both rowers around the skiff, or the skiff around the rowers after a respawn. */
export function placeRowers(s: GameState, respawned: boolean): void {
  const r = s.row!;
  const [a, b] = s.players;
  if (respawned) {
    const cp = (a.x + b.x) / 2;
    r.x = cp;
    r.v = 0;
    r.roll = r.rollVel = 0;
    r.jumpT = r.jumpY = 0;
    r.rowers = [newRower(), newRower()];
    r.sync = 1;
    r.clashCd = r.bridgeCd = 0;
    for (const d of r.ducks) d.done = d.x < cp - 3;
    for (const o of r.buoys) {
      o.done = o.x < cp - 3;
      o.cd = 0;
    }
    for (const br of r.bridges) {
      br.done = br.x1 < cp;
      br.hit = false;
    }
  }
  a.x = r.x - ROW.seat / 2;
  b.x = r.x + ROW.seat / 2;
  a.v = b.v = r.v;
  a.h = r.rowers[0].a;
  b.h = r.rowers[1].a;
  a.jumpY = b.jumpY = r.jumpY;
}
