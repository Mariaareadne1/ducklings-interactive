import type { NavPoint } from './nav';

/**
 * Walking a planned route by arc length: the duck's position is always a
 * point on the route (so it goes exactly where pathing said, round every
 * obstacle), with a look-ahead point to face, and a speed that eases up,
 * eases down for the end, and never exceeds the pace of the ground or water
 * it's on.
 */
export class PathFollower {
  private pts: NavPoint[] = [];
  private cum: number[] = [];
  s = 0;
  v = 0;

  get active(): boolean {
    return this.pts.length > 1 && this.s < this.length - 1e-4;
  }

  get length(): number {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }

  get remaining(): number {
    return Math.max(0, this.length - this.s);
  }

  get goal(): NavPoint | null {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }

  set(points: NavPoint[], keepSpeed = true): void {
    this.pts = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    this.s = 0;
    if (!keepSpeed) this.v = 0;
  }

  clear(): void {
    this.pts = [];
    this.cum = [];
    this.s = 0;
  }

  at(s: number): NavPoint {
    const pts = this.pts;
    if (!pts.length) return { x: 0, z: 0, deck: false };
    if (s <= 0) return pts[0];
    const last = pts.length - 1;
    if (s >= this.cum[last]) return pts[last];
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    const a = pts[lo], b = pts[hi];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, deck: t < 0.5 ? a.deck : b.deck };
  }

  /**
   * Advance along the route at up to `pace` m/s (accelerating at `accel`,
   * slowing to arrive). Returns the new point and the heading to face.
   */
  step(dt: number, pace: number, accel = 1.8, arrive = true): { p: NavPoint; face: number | null } {
    const brake = arrive ? Math.sqrt(2 * accel * 0.7 * this.remaining) + 0.05 : Infinity;
    const want = Math.min(pace, brake);
    this.v += Math.max(-accel * 1.5 * dt, Math.min(accel * dt, want - this.v));
    this.v = Math.max(0, this.v);
    this.s = Math.min(this.length, this.s + this.v * dt);
    const p = this.at(this.s);
    const ahead = this.at(this.s + 0.3);
    const dx = ahead.x - p.x, dz = ahead.z - p.z;
    return { p, face: Math.hypot(dx, dz) > 0.02 ? Math.atan2(-dz, dx) : null };
  }
}
