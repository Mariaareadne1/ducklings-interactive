/**
 * The follow line. Mother duck's path is recorded as a breadcrumb polyline
 * with cumulative arc length; every duckling sits a fixed arc length behind
 * the one in front *on that polyline*, so the line snakes through exactly
 * the curves she took instead of cutting corners. Spacing stretches a little
 * when the line speeds up and bunches when it stops.
 *
 * Everything here is pure or plain data, so the steady-state line is a
 * function of the trail and each follower's index — testable on its own.
 */

export interface TrailSample {
  x: number;
  z: number;
  heading: number;
  deck: boolean;
}

/** Gap from mum's tail to the first duckling, and between ducklings (m, at rest). */
export const FIRST_GAP = 0.98;
export const SPACING = 0.56;
/** Breadcrumbs closer than this are skipped. */
const MIN_STEP = 0.03;

export class Trail {
  private xs: number[] = [];
  private zs: number[] = [];
  private ss: number[] = [];
  private decks: boolean[] = [];

  constructor(x = 0, z = 0, deck = false) {
    this.reset(x, z, deck);
  }

  /** Start afresh from one point (keeps arc length running, so followers' s stay comparable). */
  reset(x: number, z: number, deck = false): void {
    const s = this.ss.length ? this.end : 0;
    this.xs = [x];
    this.zs = [z];
    this.ss = [s];
    this.decks = [deck];
  }

  get start(): number {
    return this.ss[0];
  }

  get end(): number {
    return this.ss[this.ss.length - 1];
  }

  get length(): number {
    return this.ss.length;
  }

  /** Drop a breadcrumb where the leader is now. Returns the leader's arc length. */
  push(x: number, z: number, deck = false): number {
    const n = this.xs.length - 1;
    const d = Math.hypot(x - this.xs[n], z - this.zs[n]);
    if (d < MIN_STEP) return this.end + d;
    this.xs.push(x);
    this.zs.push(z);
    this.ss.push(this.ss[n] + d);
    this.decks.push(deck);
    return this.end;
  }

  /** Forget crumbs well behind s (keeps memory bounded on long walks). */
  prune(s: number): void {
    let k = 0;
    while (k < this.ss.length - 2 && this.ss[k + 1] < s) k++;
    if (k > 64) {
      this.xs = this.xs.slice(k);
      this.zs = this.zs.slice(k);
      this.ss = this.ss.slice(k);
      this.decks = this.decks.slice(k);
    }
  }

  /** Point on the trail at arc length s (clamped to the trail). */
  point(s: number): { x: number; z: number; deck: boolean; i: number; t: number } {
    const ss = this.ss;
    if (s <= ss[0] || ss.length === 1) return { x: this.xs[0], z: this.zs[0], deck: this.decks[0], i: 0, t: 0 };
    const last = ss.length - 1;
    if (s >= ss[last]) return { x: this.xs[last], z: this.zs[last], deck: this.decks[last], i: last, t: 0 };
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - ss[lo]) / (ss[hi] - ss[lo] || 1);
    return {
      x: this.xs[lo] + (this.xs[hi] - this.xs[lo]) * t,
      z: this.zs[lo] + (this.zs[hi] - this.zs[lo]) * t,
      deck: t < 0.5 ? this.decks[lo] : this.decks[hi],
      i: lo,
      t,
    };
  }

  /** Point and facing at arc length s; facing looks along the trail ahead. */
  sample(s: number): TrailSample {
    const p = this.point(s);
    const a = this.point(s - 0.12);
    const b = this.point(s + 0.12);
    let dx = b.x - a.x, dz = b.z - a.z;
    if (Math.hypot(dx, dz) < 1e-5 && this.xs.length > 1) {
      // at the very ends: the last segment's direction
      const n = this.xs.length - 1;
      dx = this.xs[n] - this.xs[n - 1];
      dz = this.zs[n] - this.zs[n - 1];
    }
    return { x: p.x, z: p.z, deck: p.deck, heading: Math.atan2(-dz, dx) };
  }

  /** Shortest distance from a point to the trail polyline (for tests). */
  distanceTo(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const ax = this.xs[i], az = this.zs[i], bx = this.xs[i + 1], bz = this.zs[i + 1];
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    if (this.xs.length === 1) best = Math.hypot(x - this.xs[0], z - this.zs[0]);
    return best;
  }
}

/**
 * How much the line stretches or bunches: 1 at a steady walk, a little
 * longer when hurrying, a little shorter when stopped.
 */
export function spacingScale(leaderSpeed: number, walkSpeed: number): number {
  const v = Math.max(0, leaderSpeed) / walkSpeed;
  if (v < 0.05) return 0.8;
  return 0.8 + 0.2 * Math.min(1, v / 0.4) + 0.18 * Math.max(0, Math.min(1, v - 1));
}

/** Arc-length offset behind the leader of follower `index` (0 = first duckling). */
export function followerOffset(index: number, scale = 1): number {
  return (FIRST_GAP + index * SPACING) * scale;
}

/** Where follower `index` belongs on the trail, in arc length (never before the trail's start). */
export function slotS(trail: Trail, leaderS: number, index: number, scale = 1): number {
  return Math.max(trail.start, leaderS - followerOffset(index, scale));
}

/** The whole line at rest on the trail: a pure function of the trail, the leader's arc length and the count. */
export function linePositions(trail: Trail, leaderS: number, count: number, scale = 1): TrailSample[] {
  return Array.from({ length: count }, (_, i) => trail.sample(slotS(trail, leaderS, i, scale)));
}
