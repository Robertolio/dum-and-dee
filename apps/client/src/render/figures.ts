import Phaser from 'phaser';
import { COLORS } from '../config';
import { footPose } from '@dd/sim';
import type { View } from './view';

export interface FigureStyle {
  suit: number;
  suitDark: number;
}

export const DUM_STYLE: FigureStyle = { suit: COLORS.dum, suitDark: COLORS.dumDark };
export const DEE_STYLE: FigureStyle = { suit: COLORS.dee, suitDark: COLORS.deeDark };

/**
 * Flat mannequin-style window cleaner. Fully procedural so the knees bend with the posture.
 * @param x world x of the player (hands grip the ladder at this x)
 * @param yFloor height of the surface the player stands on
 * @param handY effective hand height (world) — the ladder is here
 * @param oof > 0 while the "oof" face is shown
 */
export function drawFigure(
  g: Phaser.GameObjects.Graphics,
  view: View,
  style: FigureStyle,
  x: number,
  yFloor: number,
  handY: number,
  oof: number,
  walkPhase = 0,
  walkAmp = 0,
): void {
  const sx = view.sx(x);
  const footY = view.sy(yFloor);
  const handPy = view.sy(handY);

  // Body proportions in we: arms raised above the head hold the ladder (as in the concept art).
  const handRel = (footY - handPy) / 100; // hand height above the feet
  const shoulder = Math.max(0.45, handRel - 0.55);
  const hip = shoulder * 0.56;
  const lean = Math.max(0, 1.25 - shoulder) * 0.25; // lean forward when bent
  const shoulderX = sx + lean * 100;
  const shoulderY = footY - shoulder * 100;
  const hipX = sx + lean * 40;
  const hipY = footY - hip * 100;

  // Legs: hip → knee → foot; straight when standing upright, knees forward when squatting.
  const thigh = 0.36;
  const legDrop = hip / 2;
  const kneeFwd = Math.sqrt(Math.max(0, thigh * thigh - legDrop * legDrop)) * 100;
  const kneeY0 = footY - legDrop * 100;
  for (const side of [-1, 1]) {
    const pose = footPose(walkPhase, walkAmp, side === -1 ? 0 : 1);
    const footX = sx + side * 5 + pose.dx * 100;
    const footLift = pose.lift * 100;
    const kneeY = kneeY0 - footLift * 0.5;
    const kneeX = hipX + kneeFwd * 0.9 + side * 3 + pose.dx * 50 + (footLift > 0 ? footLift * 0.5 : 0);
    g.lineStyle(14, style.suitDark);
    g.beginPath();
    g.moveTo(hipX + side * 5, hipY);
    g.lineTo(kneeX, kneeY);
    g.lineTo(footX, footY - 8 - footLift);
    g.strokePath();
    g.fillStyle(style.suitDark);
    g.fillCircle(kneeX, kneeY, 7);
    // shoe
    g.fillStyle(COLORS.shoe);
    g.fillRoundedRect(footX - 10, footY - 10 - footLift, 26, 10, 4);
  }

  // Torso.
  g.lineStyle(26, style.suit);
  g.beginPath();
  g.moveTo(hipX, hipY);
  g.lineTo(shoulderX, shoulderY);
  g.strokePath();
  g.fillStyle(style.suit);
  g.fillCircle(hipX, hipY, 13);
  g.fillCircle(shoulderX, shoulderY, 13);
  // belt
  g.fillStyle(COLORS.shoe);
  g.fillRect(hipX - 13, hipY - 3, 26, 6);

  // Arms up to the ladder, two hands slightly apart.
  g.lineStyle(10, style.suit);
  for (const side of [-1, 1]) {
    const hx = sx + side * 16;
    g.beginPath();
    g.moveTo(shoulderX + side * 8, shoulderY);
    g.lineTo(hx, handPy + 6);
    g.strokePath();
    g.fillStyle(COLORS.glove);
    g.fillCircle(hx, handPy + 4, 7);
  }

  // Head with cap.
  const headR = 15;
  const headX = shoulderX + 4;
  const headY = shoulderY - 24;
  g.fillStyle(COLORS.skin);
  g.fillCircle(headX, headY, headR);
  g.fillStyle(style.suitDark);
  g.beginPath();
  g.arc(headX, headY - 2, headR + 1, Math.PI, 0, false);
  g.fillPath();
  g.fillRoundedRect(headX - 2, headY - 6, headR + 10, 6, 2); // cap peak
  // Face: eye + mouth ("oof" = open mouth).
  g.fillStyle(0x222222);
  g.fillCircle(headX + 7, headY + 1, 2);
  if (oof > 0) {
    g.fillStyle(0x7a2a2a);
    g.fillCircle(headX + 7, headY + 8, 4);
  } else {
    g.fillRect(headX + 4, headY + 8, 7, 2);
  }
}
