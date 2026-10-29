import { fbm2, noise2 } from './noise';

/**
 * The park: a 20 × 15 m painted tile — a mown lawn, a winding gravel path,
 * a two-lobed pond with a gentle bank on its near side and a steeper edge
 * elsewhere, a little wooden bridge over the waist, a bench, two round trees
 * and a flowerbed. World units are metres, y up, the water surface is the
 * plane y = 0, the camera sits on the +z side looking toward -z.
 *
 * Every function here has a GLSL twin in terrain.ts written as the same
 * expression, so the painted ground, placement and pathing always agree.
 */

export const TILE = { halfX: 10, halfZ: 7.5 };
export const WATER_Y = 0;

// --- the pond --------------------------------------------------------------------

export const LOBE_A = { x: 3.5, z: -2.1, rx: 4.3, rz: 3.0 };
export const LOBE_B = { x: -4.3, z: -3.3, rx: 3.0, rz: 2.15 };
/** The narrow channel joining the lobes, which the bridge crosses. */
export const CHANNEL = { ax: -1.9, az: -3.0, bx: 0.1, bz: -2.45, r: 0.62 };

function ellipseSDF(x: number, z: number, cx: number, cz: number, a: number, b: number): number {
  const px = x - cx;
  const pz = z - cz;
  const k0 = Math.hypot(px / a, pz / b);
  const k1 = Math.hypot(px / (a * a), pz / (b * b));
  return k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
}

function capsuleSDF(x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): number {
  const pax = x - ax, paz = z - az, bax = bx - ax, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + paz * baz) / (bax * bax + baz * baz)));
  return Math.hypot(pax - bax * h, paz - baz * h) - r;
}

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance (m, approximately) to the shore: negative over water. */
export function pondSDF(x: number, z: number): number {
  const wob = 0.16 * Math.sin(x * 1.3 + z * 0.7) + 0.1 * Math.sin(z * 2.1 - x * 0.9 + 1.7);
  const a = ellipseSDF(x, z, LOBE_A.x, LOBE_A.z, LOBE_A.rx, LOBE_A.rz);
  const b = ellipseSDF(x, z, LOBE_B.x, LOBE_B.z, LOBE_B.rx, LOBE_B.rz);
  const c = capsuleSDF(x, z, CHANNEL.ax, CHANNEL.az, CHANNEL.bx, CHANNEL.bz, CHANNEL.r);
  return smin(smin(a, b, 0.8), c, 0.9) + wob;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * 0..1: how gentle the bank is here. The near side of the big lobe is a soft
 * sandy slope (the ducks walk in and out there); everywhere else the lawn
 * ends in a steeper earthen edge.
 */
export function gentleness(x: number, z: number): number {
  return smoothstep(-1.4, -0.1, z) * smoothstep(1.3, 2.4, x) * smoothstep(7.4, 6.3, x);
}

/** Water depth below the surface at a point (0 on land). */
export function waterDepth(x: number, z: number): number {
  const s = pondSDF(x, z);
  if (s >= 0) return 0;
  const g = gentleness(x, z);
  const reach = 0.7 + 1.9 * g;
  return 0.04 + 1.15 * (1 - Math.exp(s / reach));
}

/** The lawn's gentle rolls. */
function lawnHeight(x: number, z: number): number {
  return 0.3 + 0.12 * fbm2(x / 6 + 2.1, z / 6 - 4.3, 3) + 0.015 * noise2(x / 1.3, z / 1.3);
}

/** The analytic ground: lawn above the water, the pond bed below it. */
export function groundHeight(x: number, z: number): number {
  const s = pondSDF(x, z);
  if (s < 0) return -waterDepth(x, z);
  const g = gentleness(x, z);
  // steep: the lawn drops to the water within half a metre; gentle: a long soft slope
  const reach = 0.42 + 2.1 * g;
  const t = Math.min(1, s / reach);
  const rise = g > 0.5 ? t * (2 - t) : t * t * (3 - 2 * t);
  return lawnHeight(x, z) * (g * rise + (1 - g) * Math.min(1, t * 1.6 - t * t * 0.6));
}

export function groundNormal(x: number, z: number, eps = 0.06): [number, number, number] {
  const hx = groundHeight(x + eps, z) - groundHeight(x - eps, z);
  const hz = groundHeight(x, z + eps) - groundHeight(x, z - eps);
  const nx = -hx;
  const ny = 2 * eps;
  const nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

/** Distance (m) inside the tile's edge; negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

// --- the bridge --------------------------------------------------------------------

/** A humped wooden footbridge across the channel, running from the near lawn to the far one. */
export const BRIDGE = (() => {
  const cx = (CHANNEL.ax + CHANNEL.bx) / 2;
  const cz = (CHANNEL.az + CHANNEL.bz) / 2;
  const dx = CHANNEL.bx - CHANNEL.ax;
  const dz = CHANNEL.bz - CHANNEL.az;
  const l = Math.hypot(dx, dz);
  // along the bridge = across the channel, pointing toward the camera
  const ux = dz / l;
  const uz = -dx / l;
  const flip = uz < 0 ? -1 : 1;
  return { x: cx, z: cz, ux: ux * flip, uz: uz * flip, length: 3.6, width: 0.86, deckEnd: 0.3, deckMid: 0.5 };
})();

/** Bridge-local coordinates: u along (−L/2 far end .. +L/2 near end), v across. */
export function bridgeLocal(x: number, z: number): [number, number] {
  const dx = x - BRIDGE.x;
  const dz = z - BRIDGE.z;
  return [dx * BRIDGE.ux + dz * BRIDGE.uz, -dx * BRIDGE.uz + dz * BRIDGE.ux];
}

export function onBridge(x: number, z: number, margin = 0): boolean {
  const [u, v] = bridgeLocal(x, z);
  return Math.abs(u) < BRIDGE.length / 2 + margin && Math.abs(v) < BRIDGE.width / 2 + margin;
}

/** Height of the deck's walking surface at a bridge-local u. */
export function deckHeight(u: number): number {
  const t = Math.min(1, Math.abs(u) / (BRIDGE.length / 2));
  return BRIDGE.deckEnd + (BRIDGE.deckMid - BRIDGE.deckEnd) * (1 - t * t);
}

// --- the path ---------------------------------------------------------------------

/** The gravel path's centre line, as control points (a Catmull-Rom spline runs through them). */
const PATH_CONTROL: [number, number][] = [
  [-10.6, 6.6], [-8.0, 5.0], [-5.6, 3.6], [-3.6, 2.4], [-2.0, 1.25],
  [BRIDGE.x + BRIDGE.ux * (BRIDGE.length / 2 + 0.25), BRIDGE.z + BRIDGE.uz * (BRIDGE.length / 2 + 0.25)],
  [BRIDGE.x + BRIDGE.ux * (BRIDGE.length / 2 - 0.4), BRIDGE.z + BRIDGE.uz * (BRIDGE.length / 2 - 0.4)],
  [BRIDGE.x - BRIDGE.ux * (BRIDGE.length / 2 - 0.4), BRIDGE.z - BRIDGE.uz * (BRIDGE.length / 2 - 0.4)],
  [BRIDGE.x - BRIDGE.ux * (BRIDGE.length / 2 + 0.3), BRIDGE.z - BRIDGE.uz * (BRIDGE.length / 2 + 0.3)],
  [0.2, -5.9], [3.6, -6.25], [7.2, -6.0], [10.6, -6.4],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** The path sampled as a polyline (shared with the shader as a uniform array). */
export const PATH_POINTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  const P = PATH_CONTROL;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.6));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
})();

export const PATH_HALF_WIDTH = 0.46;

/** Distance (m) from the path's centre line. */
export function pathDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i];
    const [bx, bz] = PATH_POINTS[i + 1];
    best = Math.min(best, capsuleSDF(x, z, ax, az, bx, bz, 0));
  }
  return best;
}

// --- furniture and planting -----------------------------------------------------------

export const BENCH = { x: -5.3, z: 4.75, yaw: 0.52, length: 1.7, depth: 0.5, seat: 0.42 };

export interface TreeDef { x: number; z: number; r: number; color: string; seed: number; trunk: number }
export const TREES: TreeDef[] = [
  { x: -8.1, z: -1.2, r: 1.25, color: '#86c262', seed: 1, trunk: 0.16 },
  { x: 7.3, z: 4.9, r: 1.05, color: '#f0b6c3', seed: 3, trunk: 0.13 },
];

export const FLOWERBED = { x: 2.5, z: 4.55, rx: 1.65, rz: 0.92 };

export function flowerbedSDF(x: number, z: number): number {
  return ellipseSDF(x, z, FLOWERBED.x, FLOWERBED.z, FLOWERBED.rx, FLOWERBED.rz);
}

/** Bench footprint, signed distance (negative under it). */
export function benchSDF(x: number, z: number): number {
  const c = Math.cos(BENCH.yaw), s = Math.sin(BENCH.yaw);
  const dx = x - BENCH.x, dz = z - BENCH.z;
  const u = dx * c - dz * s;
  const v = dx * s + dz * c;
  const qx = Math.abs(u) - BENCH.length / 2;
  const qz = Math.abs(v) - BENCH.depth / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export const LILY_PADS = [
  { x: 5.4, z: -3.2, r: 0.42, yaw: 0.6 },
  { x: 2.3, z: -3.9, r: 0.34, yaw: 2.4 },
];

/** Signed distance to the nearest thing a duck must walk around (bench, tree trunks, flowerbed). */
export function obstacleSDF(x: number, z: number): number {
  let d = Math.min(benchSDF(x, z), flowerbedSDF(x, z) + 0.05);
  for (const t of TREES) d = Math.min(d, Math.hypot(x - t.x, z - t.z) - t.trunk - 0.12);
  return d;
}

// --- where ducks can be --------------------------------------------------------------------

/** Margins that keep ducks clear of the paper and the furniture. */
export const BOUNDS = { edge: 1.0, obstacle: 0.22, waterClearance: 0.18, shore: 0.22 };

export type Medium = 'land' | 'water' | 'bridge';

/** What a duck at (x, z) stands on or floats in. */
export function mediumAt(x: number, z: number): Medium {
  if (onBridge(x, z)) return 'bridge';
  return pondSDF(x, z) < 0 ? 'water' : 'land';
}

/** The height a duck's feet (or waterline) sit at. */
export function surfaceHeight(x: number, z: number): number {
  if (onBridge(x, z)) return deckHeight(bridgeLocal(x, z)[0]);
  const s = pondSDF(x, z);
  return s < 0 ? WATER_Y : Math.max(WATER_Y, groundHeight(x, z));
}

/** Is (x, z) open water at least `clearance` from the shore (and not under the bridge)? */
export function isOpenWater(x: number, z: number, clearance = 0.3): boolean {
  return pondSDF(x, z) < -clearance && !onBridge(x, z, 0.25);
}

/** Numerical gradient of the shore field (points away from the water). */
export function shoreGradient(x: number, z: number): [number, number] {
  const e = 0.05;
  const gx = pondSDF(x + e, z) - pondSDF(x - e, z);
  const gz = pondSDF(x, z + e) - pondSDF(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

/** Nearest open-water point (walks down the shore gradient). */
export function clampToWater(x: number, z: number, clearance = 0.3): [number, number] {
  let cx = x;
  let cz = z;
  for (let i = 0; i < 40 && !isOpenWater(cx, cz, clearance); i++) {
    const s = pondSDF(cx, cz);
    const [gx, gz] = shoreGradient(cx, cz);
    const step = Math.max(0.06, s + clearance + 0.04);
    if (onBridge(cx, cz, 0.25) && s < -clearance) {
      // under the bridge: step off it sideways
      const [, v] = bridgeLocal(cx, cz);
      const sgn = v >= 0 ? 1 : -1;
      cx += -BRIDGE.uz * 0.2 * sgn;
      cz += BRIDGE.ux * 0.2 * sgn;
    } else {
      cx -= gx * step;
      cz -= gz * step;
    }
  }
  return [cx, cz];
}
