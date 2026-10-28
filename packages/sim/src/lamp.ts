import type { GameState, LampState } from './state';
import type { Tuning } from './tuning';
import { closestOnSegment, segmentCircleOverlap } from './collision';
import { applyLadderImpulse, ladderSegment } from './ladder';
import { loseWater } from './bucket';
import { clamp, sign } from './math';

export function lampCapCenter(l: LampState, t: Tuning): { x: number; y: number } {
  return { x: l.x + l.len * Math.sin(l.psi), y: l.pivotY - l.len * Math.cos(l.psi) };
}

/** Pendulum lamps: swing after a hit, keep ticking against the ladder while they cross it. */
export function integrateLamps(s: GameState, t: Tuning): void {
  const dt = t.dt;
  const seg = ladderSegment(s, t);
  const [a, b] = s.players;

  for (const l of s.lamps) {
    const psiDDot = -(t.g / l.len) * Math.sin(l.psi) - l.damp * l.psiDot;
    l.psiDot += psiDDot * dt;
    l.psi += l.psiDot * dt;
    l.psi = clamp(l.psi, -1.3, 1.3);
    if (l.cooldown > 0) l.cooldown = Math.max(0, l.cooldown - dt);

    // Skip lamps far away from the ladder.
    if (l.x < seg.ax - 2 || l.x > seg.bx + 2) {
      maybeScorePass(s, l, seg.ax, t);
      continue;
    }

    let cap = lampCapCenter(l, t);
    let hit = closestOnSegment(seg.ax, seg.ay, seg.bx, seg.by, cap.x, cap.y);
    const rEff = l.radius + t.ladderThickness / 2;
    if (segmentCircleOverlap(hit, l.radius, t.ladderThickness)) {
      // Ladder velocity at the contact point (vertical interpolated between the hands).
      const vLx = (a.v + b.v) / 2 + s.ladder.kickVX;
      const vLy = a.yVel + (b.yVel - a.yVel) * hit.u + s.ladder.kickVY;
      // Cap velocity, tangential to the cord.
      const tx = Math.cos(l.psi);
      const ty = Math.sin(l.psi);
      const vCx = l.len * l.psiDot * tx;
      const vCy = l.len * l.psiDot * ty;
      const relX = vLx - vCx;
      const relY = vLy - vCy;
      const vRelRaw = relX * hit.nx + relY * hit.ny;
      const first = l.hits === 0;
      const dir = sign(relX) || sign(hit.nx) || 1;

      if (l.cooldown <= 0 && (first || vRelRaw > t.lampTickMinVel)) {
        // A proper knock: impulse on lamp and ladder, splash.
        const vRel = Math.max(vRelRaw, t.lampMinRelVel);
        const J = l.mass * (1 + t.lampE) * vRel;
        // Swing: tangential projection of the impulse, biased in the direction the ladder moves
        // relative to the cap so a straight-up hit still sets the lamp swinging.
        let tangential = hit.nx * tx + hit.ny * ty;
        tangential = clamp(tangential + t.lampSwingBias * dir * (1 - Math.abs(tangential)), -1, 1);
        l.psiDot += (J * tangential) / (l.mass * l.len);
        applyLadderImpulse(s, -J * hit.nx, -J * hit.ny, t);

        l.hits += 1;
        l.cooldown = t.lampTickCooldown;
        const splash = first ? t.lampFirstSplash : t.lampTickSplash;
        loseWater(s, splash);
        s.events.push({ tick: s.tick, type: first ? 'lampHit' : 'lampTick', value: splash, x: cap.x, y: cap.y });
      } else {
        // Resting/sliding contact: the cap rides on the ladder, no new splash.
        const tn = tx * hit.nx + ty * hit.ny;
        if (Math.abs(tn) > 0.05) {
          const capNormalVel = l.len * l.psiDot * tn;
          const ladderNormalVel = vLx * hit.nx + vLy * hit.ny;
          if (capNormalVel < ladderNormalVel) l.psiDot = ladderNormalVel / (l.len * tn);
        }
      }

      // Positional correction: push the cap out of the ladder along the normal (with a lateral bias
      // when the cap is pushed straight up, so it slides off to the side the ladder moves to).
      for (let iter = 0; iter < 3; iter++) {
        const pen = rEff - hit.dist;
        if (pen <= 0) break;
        const lateral = Math.abs(hit.nx) < 0.3 ? dir * pen * 0.8 : 0;
        const cx = cap.x + hit.nx * pen + lateral;
        const cy = cap.y + hit.ny * pen;
        l.psi = Math.atan2(cx - l.x, l.pivotY - cy);
        cap = lampCapCenter(l, t);
        hit = closestOnSegment(seg.ax, seg.ay, seg.bx, seg.by, cap.x, cap.y);
      }
    }
    maybeScorePass(s, l, seg.ax, t);
  }
}

function maybeScorePass(s: GameState, l: LampState, ladderTailX: number, t: Tuning): void {
  if (l.passed) return;
  if (ladderTailX > l.x + l.radius + 0.2) {
    l.passed = true;
    if (l.hits === 0) {
      s.score += t.scoreLampClean;
      s.events.push({ tick: s.tick, type: 'lampClean', value: t.scoreLampClean, x: l.x, y: l.pivotY - l.len });
    }
  }
}
