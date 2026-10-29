import * as THREE from 'three';
import { meshSDF, sdCapsule, sdEllipsoid, smin, type SDF } from '../sdf';
import { woolField } from '../wool';

/**
 * Procedural duck shapes, in each duck's own frame: x forward (the bill),
 * y up, z to its right; the waterline is y = 0 (on land the body is lifted
 * onto its legs). Bodies are smooth signed-distance unions meshed with
 * surface nets; the ducklings' fluff is MEADOW's wool — many small soft puffs
 * unioned over a round body. These run in a Web Worker, so no DOM or WebGL.
 */

export interface DuckGeometries {
  [part: string]: THREE.BufferGeometry;
}

const mesh = (sdf: SDF, min: [number, number, number], max: [number, number, number], cell: number) =>
  meshSDF(sdf, { min, max, cell, ao: true });

/** A flat shape lying in the x-z plane (shape y -> +z). */
function flat(shape: THREE.Shape, segments: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, segments);
  g.rotateX(Math.PI / 2);
  g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1), 1));
  g.computeVertexNormals();
  return g;
}

function withAO(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1), 1));
  return g;
}

function webbedFoot(len: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(len, -len * 0.62);
  s.quadraticCurveTo(len * 1.12, -len * 0.2, len * 0.95, 0);
  s.quadraticCurveTo(len * 1.12, len * 0.2, len, len * 0.62);
  s.lineTo(0, 0);
  return flat(s, 6);
}

// --- mother -----------------------------------------------------------------------

/** Mother duck: a round, buoyant hen about 0.9 long, on short legs. */
export function motherShapes(): DuckGeometries {
  // round chest, soft keel, rising to a perky tail
  const body: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, -0.02, 0.08, 0, 0.36, 0.17, 0.24);
    d = smin(d, sdEllipsoid(x, y, z, 0.17, 0.1, 0, 0.19, 0.17, 0.21), 0.12);
    const tx = x + 0.32, ty = y - 0.17;
    const c = Math.cos(0.6), s = Math.sin(0.6);
    d = smin(d, sdEllipsoid(tx * c + ty * s, -tx * s + ty * c, z, 0, 0, 0, 0.13, 0.05, 0.085), 0.08);
    d -= 0.006 * Math.sin(x * 38 + 1.2) * Math.sin(z * 31);
    return d;
  };
  const head: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0.0, 0.0, 0, 0.125, 0.115, 0.11);
    d = smin(d, sdCapsule(x, y, z, -0.05, -0.22, 0, -0.015, -0.05, 0, 0.066), 0.06);
    d = smin(d, sdEllipsoid(x, y, z, 0.03, -0.02, 0, 0.09, 0.08, 0.115), 0.04);
    return d;
  };
  const bill: SDF = (x, y, z) => smin(sdEllipsoid(x, y, z, 0.08, -0.005, 0, 0.095, 0.026, 0.054), sdEllipsoid(x, y, z, 0.01, 0.01, 0, 0.05, 0.034, 0.05), 0.03);
  const wing: SDF = (x, y, z) => smin(sdEllipsoid(x, y, z, -0.13, 0, 0.0, 0.22, 0.032, 0.11), sdEllipsoid(x, y, z, -0.31, -0.004, 0.0, 0.08, 0.022, 0.06), 0.04);
  return {
    body: mesh(body, [-0.52, -0.12, -0.29], [0.4, 0.31, 0.29], 0.011),
    head: mesh(head, [-0.14, -0.31, -0.15], [0.16, 0.14, 0.15], 0.008),
    bill: mesh(bill, [-0.05, -0.05, -0.07], [0.2, 0.05, 0.07], 0.006),
    wing: mesh(wing, [-0.42, -0.06, -0.12], [0.1, 0.06, 0.12], 0.008),
    eye: withAO(new THREE.SphereGeometry(0.021, 12, 8)),
    foot: webbedFoot(0.1),
    leg: withAO(new THREE.CylinderGeometry(0.018, 0.021, 0.1, 8)),
  };
}

// --- duckling ---------------------------------------------------------------------

/** A duckling: a round puff of fluff about 0.36 long with a big round head. */
export function ducklingShapes(): DuckGeometries {
  const bodyBase: SDF = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, -0.01, 0.05, 0, 0.13, 0.1, 0.112);
    d = smin(d, sdEllipsoid(x, y, z, -0.08, 0.065, 0, 0.075, 0.075, 0.085), 0.05);
    // a stubby tail and the little wing nubs
    d = smin(d, sdEllipsoid(x, y, z, -0.145, 0.1, 0, 0.035, 0.025, 0.035), 0.03);
    for (const s of [-1, 1]) d = smin(d, sdEllipsoid(x, y, z, -0.025, 0.075, 0.098 * s, 0.065, 0.035, 0.028), 0.025);
    return d;
  };
  const body = woolField(bodyBase, {
    seed: 7,
    min: [-0.22, -0.08, -0.16],
    max: [0.16, 0.19, 0.16],
    inset: 0.026,
    layers: [{ count: 46, rMin: 0.028, rMax: 0.034 }, { count: 90, rMin: 0.016, rMax: 0.021 }],
    blend: 0.03,
    curl: 0.0009,
  });
  const headBase: SDF = (x, y, z) => smin(sdEllipsoid(x, y, z, 0, 0, 0, 0.086, 0.082, 0.083), sdEllipsoid(x, y, z, 0.02, -0.03, 0, 0.06, 0.05, 0.072), 0.03);
  const head = woolField(headBase, {
    seed: 11,
    min: [-0.12, -0.11, -0.12],
    max: [0.12, 0.11, 0.12],
    inset: 0.019,
    layers: [{ count: 34, rMin: 0.02, rMax: 0.025 }, { count: 60, rMin: 0.012, rMax: 0.016 }],
    blend: 0.022,
    curl: 0.0007,
  });
  const bill: SDF = (x, y, z) => smin(sdEllipsoid(x, y, z, 0.045, -0.004, 0, 0.04, 0.011, 0.027), sdEllipsoid(x, y, z, 0.008, 0.002, 0, 0.022, 0.016, 0.026), 0.015);
  // a cowlick: three little curls of fluff standing up and leaning back
  const tuft: SDF = (x, y, z) => {
    let d = sdCapsule(x, y, z, 0, 0, 0, -0.012, 0.045, 0, 0.008);
    d = smin(d, sdCapsule(x, y, z, 0.004, 0, 0.008, 0.012, 0.035, 0.016, 0.006), 0.006);
    d = smin(d, sdCapsule(x, y, z, -0.004, 0, -0.008, -0.022, 0.032, -0.014, 0.006), 0.006);
    return d;
  };
  const nub: SDF = (x, y, z) => sdEllipsoid(x, y, z, -0.035, 0, 0, 0.06, 0.016, 0.034);
  return {
    body: mesh(body, [-0.23, -0.09, -0.17], [0.17, 0.2, 0.17], 0.0055),
    head: mesh(head, [-0.13, -0.12, -0.13], [0.13, 0.12, 0.13], 0.0045),
    bill: mesh(bill, [-0.03, -0.03, -0.04], [0.1, 0.03, 0.04], 0.003),
    tuft: mesh(tuft, [-0.04, -0.02, -0.03], [0.03, 0.06, 0.03], 0.0025),
    wing: mesh(nub, [-0.11, -0.025, -0.045], [0.04, 0.025, 0.045], 0.004),
    eye: withAO(new THREE.SphereGeometry(0.0165, 12, 8)),
    foot: webbedFoot(0.048),
    leg: withAO(new THREE.CylinderGeometry(0.008, 0.009, 0.05, 6)),
  };
}

/** Every shape, by kind, built in one go (in the worker). */
export function buildAllShapes(): Record<string, DuckGeometries> {
  return { mother: motherShapes(), duckling: ducklingShapes() };
}
