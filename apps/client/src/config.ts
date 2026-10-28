/** Screen layout constants (reference height 540 px, 1 we = 100 px). */
export const GAME_H = 540;
export const MIN_W = 960;
export const MAX_W = 1280;
export const PX = 100;
/** Screen y of the floor surface. */
export const FLOOR_Y = 440;
/** Fraction of the width where the ladder centre sits. */
export const LADDER_SCREEN_FRACTION = 0.47;
/** Camera lead ahead of the ladder (we). */
export const CAMERA_LEAD = 0.6;

export const COLORS = {
  dum: 0x2d63d8,
  dumDark: 0x1f448f,
  dee: 0xcf3a2f,
  deeDark: 0x8d251d,
  skin: 0xe9b58c,
  glove: 0xf2c43d,
  shoe: 0x2a2a2e,
  ladder: 0xc8ced6,
  ladderDark: 0x8e97a3,
  bucket: 0xb9c1c9,
  water: 0x3aa7ef,
  waterLight: 0x9fdcff,
  lamp: 0x2d3238,
  lampLight: 0xffe08a,
  cord: 0x1a1d21,
  hudPanel: 0x152a30,
  hudBorder: 0x8fb5bb,
  balanceGreen: 0x7ed957,
  balanceOrange: 0xf0a030,
  balanceRed: 0xe0453a,
  heart: 0xffffff,
  white: 0xffffff,
};

export function computeGameWidth(viewportW: number, viewportH: number): number {
  const aspect = viewportW / Math.max(1, viewportH);
  return Math.round(Math.min(MAX_W, Math.max(MIN_W, GAME_H * aspect)));
}
