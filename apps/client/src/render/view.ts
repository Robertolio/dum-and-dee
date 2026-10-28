import { FLOOR_Y, PX } from '../config';

/** World (we, y up from the floor) → screen (px) mapping with a horizontal camera. */
export class View {
  camX = 0;
  width = 960;

  sx(x: number): number {
    return (x - this.camX) * PX;
  }

  sy(y: number): number {
    return FLOOR_Y - y * PX;
  }

  len(we: number): number {
    return we * PX;
  }
}
