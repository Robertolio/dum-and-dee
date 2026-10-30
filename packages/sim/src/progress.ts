import type { GameState } from './state';
import type { Tuning } from './tuning';
import { resetPlayerRow } from './ladder';
import { primeBucket } from './bucket';

const BREAKERS = new Set(['bump', 'slip', 'bucketBonk', 'lampHit', 'lampBreak', 'beamHit', 'lampTick']);
const CLEANERS = new Set(['lampClean', 'pop', 'sweep', 'stepCaught']);

export function multFor(combo: number): number {
  return combo >= 10 ? 3 : combo >= 6 ? 2 : combo >= 3 ? 1.5 : 1;
}

function addScore(s: GameState, pts: number, t: Tuning): void {
  s.score += pts;
  while (s.score >= s.nextLifeScore) {
    s.nextLifeScore += t.extraLifeEvery;
    if (s.lives < t.maxLives) {
      s.lives += 1;
      s.events.push({ tick: s.tick, type: 'extraLife', value: s.lives });
    }
  }
}

function clean(s: GameState, t: Tuning): void {
  s.combo += 1;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  const m = multFor(s.combo);
  if (m !== s.comboMult) {
    s.comboMult = m;
    s.events.push({ tick: s.tick, type: 'comboUp', value: m });
  }
  void t;
}

function breakCombo(s: GameState): void {
  if (s.combo >= 3) s.events.push({ tick: s.tick, type: 'comboLost', value: s.combo });
  s.combo = 0;
  s.comboMult = 1;
}

/** An x position is clear when no obstacle lies in the ladder's span around it. */
function isClear(s: GameState, x: number): boolean {
  const lo = x - 6;
  const hi = x + 7;
  return (
    !s.steps.some((o) => o.x1 > lo && o.x0 < hi) &&
    !s.lamps.some((l) => l.x > lo && l.x < hi) &&
    !s.beams.some((b) => b.x1 > lo && b.x0 < hi) &&
    !s.softs.some((o) => o.x > lo && o.x < hi && !o.done)
  );
}

/** After a lost life: back to the last checkpoint with a fresh bucket. */
export function respawn(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const mid = (a.x + b.x) / 2;
  const cp = Math.min(s.checkpointX, mid);
  a.x = cp - t.L0 / 2;
  b.x = cp + t.L0 / 2;
  for (const p of s.players) {
    p.v = 0;
    p.jumpT = 0;
    p.jumpY = 0;
    p.slipTimer = 0;
    p.yFloor = p.yFloorTarget = p.yFloorTargetSmooth = p.yFloorVel = 0;
    p.stepping = false;
  }
  resetPlayerRow(a, b, t);
  const L = s.ladder;
  L.kickX = L.kickY = L.kickVX = L.kickVY = L.lift = 0;
  L.theta = L.thetaDot = 0;
  s.bucket.water = 100;
  s.bucket.phi = 0;
  s.bucket.phiDot = 0;
  s.dark = false;
  s.balanceTimer = 0;
  primeBucket(s);
  breakCombo(s);
  s.events.push({ tick: s.tick, type: 'respawn', x: cp });
}

export function updateProgress(s: GameState, t: Tuning): void {
  const [a, b] = s.players;
  const mid = (a.x + b.x) / 2;

  for (const e of s.events) {
    if (BREAKERS.has(e.type)) {
      breakCombo(s);
      if (e.x !== undefined) {
        for (const o of s.steps) if (e.x > o.x0 - 1.2 && e.x < o.x1 + 1.2) o.dirty = true;
      }
    } else if (CLEANERS.has(e.type)) {
      if (s.comboMult > 1 && e.value) s.score += Math.round(e.value * (s.comboMult - 1));
      clean(s, t);
    }
  }
  // Extra life check after bonus points.
  addScore(s, 0, t);

  const tail = Math.min(a.x, b.x) - 0.3;
  for (const o of s.steps) {
    if (o.passed || o.kind === 'stair' || o.x1 > tail) continue;
    o.passed = true;
    if (o.dirty) continue;
    const pts = Math.round(t.scorePassStep * s.comboMult);
    addScore(s, pts, t);
    s.events.push({ tick: s.tick, type: 'passStep', value: pts, x: o.x1, y: o.hObj });
    clean(s, t);
  }

  if (mid - s.checkpointX > t.checkpointSpacing && isClear(s, mid)) {
    s.checkpointX = mid;
    s.events.push({ tick: s.tick, type: 'checkpoint', x: mid });
  }

  if (!s.finished && mid >= s.levelLength - 2) {
    s.finished = true;
    const water = Math.round(s.bucket.water);
    const waterBonus = Math.min(500, t.scoreWaterBonus * water);
    const lifeBonus = t.scoreLifeBonus * s.lives;
    const timeBonus = Math.round(Math.max(0, s.par - s.time) * t.scoreTimeBonus);
    s.score += waterBonus + lifeBonus + timeBonus;
    const stars = 1 + (water >= 50 ? 1 : 0) + (s.livesLost === 0 ? 1 : 0);
    s.result = { score: Math.round(s.score), stars, water, waterBonus, lifeBonus, timeBonus, bestCombo: s.bestCombo, time: s.time };
    s.events.push({ tick: s.tick, type: 'levelDone', value: stars });
  }
}
