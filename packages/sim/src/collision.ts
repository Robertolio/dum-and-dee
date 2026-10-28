export interface Vec2 {
  x: number;
  y: number;
}

export interface SegmentHit {
  /** Distance from the circle centre to the closest point on the segment. */
  dist: number;
  /** Closest point on the segment. */
  qx: number;
  qy: number;
  /** Parameter 0…1 along the segment. */
  u: number;
  /** Unit normal from the segment toward the circle centre (0,1 if coincident). */
  nx: number;
  ny: number;
}

/** Closest-point query between a segment (a→b) and a point. */
export function closestOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): SegmentHit {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const qx = ax + dx * u;
  const qy = ay + dy * u;
  let nx = px - qx;
  let ny = py - qy;
  const dist = Math.hypot(nx, ny);
  if (dist > 1e-9) {
    nx /= dist;
    ny /= dist;
  } else {
    nx = 0;
    ny = 1;
  }
  return { dist, qx, qy, u, nx, ny };
}

/** True when a circle of radius r intersects the segment thickened by `thickness`. */
export function segmentCircleOverlap(hit: SegmentHit, r: number, thickness: number): boolean {
  return hit.dist < r + thickness / 2;
}
