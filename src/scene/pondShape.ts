import { fbm2, noise2 } from './noise';

/**
 * The pond is a painted tile — 28 × 21 m of grassy bank around a round,
 * lobed pond — seen from above at a three-quarter angle. World units are
 * metres, y up, the water surface is the plane y = 0, the camera sits on the
 * +z side looking toward -z.
 *
 * `pondSDF` is written so its GLSL twin (in terrain.ts) is the same
 * expression: water colour, the shore line and placement always agree.
 */

export const TILE = { halfX: 14, halfZ: 10.5 };
export const WATER_Y = 0;

/** Signed distance (m, approximately) to the shore: negative over water. */
export function pondSDF(x: number, z: number): number {
  const px = x - 0.6;
  const pz = z + 0.3;
  // a gentle warp so the shore wanders instead of tracing an ellipse
  const wx = px + 0.9 * Math.sin(pz * 0.45 + 1.3);
  const wz = pz + 0.7 * Math.sin(px * 0.38 - 0.6);
  const a = 9.4;
  const b = 6.2;
  const k0 = Math.hypot(wx / a, wz / b);
  const k1 = Math.hypot(wx / (a * a), wz / (b * b));
  const ellipse = k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
  const ang = Math.atan2(wz, wx);
  return ellipse + 0.5 * Math.sin(ang * 2 - 0.5) + 0.28 * Math.sin(ang * 3 + 2.2) + 0.18 * Math.sin(ang * 5 - 1.1);
}

/** Water depth below the surface at a point (0 on the bank). */
export function waterDepth(x: number, z: number): number {
  const s = pondSDF(x, z);
  return s >= 0 ? 0 : 0.06 + 1.5 * (1 - Math.exp(s / 2.4));
}

/** Gentle rolls of the bank, rising from the water line. */
function bankHeight(x: number, z: number): number {
  return 0.34 + 0.32 * fbm2(x / 7 + 2.1, z / 7 - 4.3, 3) + 0.04 * noise2(x / 1.7, z / 1.7);
}

/** The analytic ground: banks above the water, the pond bed below it. */
export function groundHeight(x: number, z: number): number {
  const s = pondSDF(x, z);
  if (s < 0) return -waterDepth(x, z);
  const rise = s / 1.9;
  const t = Math.min(1, rise);
  return bankHeight(x, z) * t * t * (3 - 2 * t);
}

export function groundNormal(x: number, z: number, eps = 0.08): [number, number, number] {
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

/** The little wooden jetty on the near-right bank, reaching into the water. */
export const JETTY = { x: 7.2, z: 5.2, yaw: 2.45, length: 3.6, width: 1.05, deck: 0.36 };

/** Is (x, z) under or on the jetty's deck (with a margin)? */
export function onJetty(x: number, z: number, margin = 0): boolean {
  const c = Math.cos(JETTY.yaw);
  const s = Math.sin(JETTY.yaw);
  const dx = x - JETTY.x;
  const dz = z - JETTY.z;
  // local u runs along the jetty out over the water, v across it
  const u = dx * c - dz * s;
  const v = dx * s + dz * c;
  return u > -margin - 0.2 && u < JETTY.length + margin && Math.abs(v) < JETTY.width / 2 + margin;
}

/** Signed distance (m) to the jetty's footprint: negative under it. */
export function jettySDF(x: number, z: number): number {
  const c = Math.cos(JETTY.yaw);
  const s = Math.sin(JETTY.yaw);
  const dx = x - JETTY.x;
  const dz = z - JETTY.z;
  const u = dx * c - dz * s - (JETTY.length - 0.2) / 2;
  const v = dx * s + dz * c;
  const qx = Math.abs(u) - (JETTY.length + 0.2) / 2;
  const qz = Math.abs(v) - JETTY.width / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** Margins that keep creatures clear of the shore and the paper. */
export const BOUNDS = {
  /** Swimmers keep at least this far out from the shore. */
  waterClearance: 0.55,
  /** Land creatures keep at least this far up the bank. */
  bankClearance: 0.35,
  /** ...and this far inside the tile's painted edge. */
  edge: 1.4,
};

export function isWater(x: number, z: number, clearance = BOUNDS.waterClearance): boolean {
  return pondSDF(x, z) < -clearance && !onJetty(x, z, 0.3);
}

export function isBank(x: number, z: number): boolean {
  return pondSDF(x, z) > BOUNDS.bankClearance && edgeDistance(x, z) > BOUNDS.edge && !onJetty(x, z, 0.1);
}

/** Numerical gradient of the shore field (points away from the water). */
export function shoreGradient(x: number, z: number): [number, number] {
  const e = 0.05;
  const gx = pondSDF(x + e, z) - pondSDF(x - e, z);
  const gz = pondSDF(x, z + e) - pondSDF(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

/** Nearest point that is open water (walks down the shore gradient). */
export function clampToWater(x: number, z: number, clearance = BOUNDS.waterClearance): [number, number] {
  let cx = x;
  let cz = z;
  for (let i = 0; i < 40 && !isWater(cx, cz, clearance); i++) {
    const s = pondSDF(cx, cz);
    const [gx, gz] = shoreGradient(cx, cz);
    const step = Math.max(0.08, s + clearance + 0.05);
    if (onJetty(cx, cz, 0.3) && s < -clearance) {
      // around the jetty: step sideways off it
      cx += Math.sin(JETTY.yaw) * 0.25;
      cz += Math.cos(JETTY.yaw) * 0.25;
    } else {
      cx -= gx * step;
      cz -= gz * step;
    }
  }
  return [cx, cz];
}

/** Nearest point on the bank inside the tile. */
export function clampToBank(x: number, z: number): [number, number] {
  let cx = Math.max(-TILE.halfX + BOUNDS.edge, Math.min(TILE.halfX - BOUNDS.edge, x));
  let cz = Math.max(-TILE.halfZ + BOUNDS.edge, Math.min(TILE.halfZ - BOUNDS.edge, z));
  for (let i = 0; i < 40 && !isBank(cx, cz); i++) {
    const s = pondSDF(cx, cz);
    const [gx, gz] = shoreGradient(cx, cz);
    const step = Math.max(0.08, BOUNDS.bankClearance - s + 0.05);
    cx += gx * step;
    cz += gz * step;
    if (onJetty(cx, cz, 0.1)) {
      cx -= Math.sin(JETTY.yaw) * 0.3;
      cz -= Math.cos(JETTY.yaw) * 0.3;
    }
    cx = Math.max(-TILE.halfX + BOUNDS.edge, Math.min(TILE.halfX - BOUNDS.edge, cx));
    cz = Math.max(-TILE.halfZ + BOUNDS.edge, Math.min(TILE.halfZ - BOUNDS.edge, cz));
  }
  return [cx, cz];
}
