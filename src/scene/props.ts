import * as THREE from 'three';
import { meshSDF, sdEllipsoid } from '../ducks/sdf';
import { woolField } from '../ducks/wool';
import { BENCH, BRIDGE, LILY_PADS, TREES, WATER_Y, deckHeight, groundHeight } from './park';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * Round painted trees, a few smooth stones, the footbridge, the bench, two
 * lily pads and the drifting clouds. Trees and clouds are puff fields (MEADOW's fleece
 * generator), so they share the creatures' soft silhouettes; everything casts
 * the cool lavender shadows.
 */

export const PROP_SHADOW_LAYER = 1;

const vertex = /* glsl */ `
attribute float aAO;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAO = aAO;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uShadeTint;
uniform float uKind; // 0 tree / stone / wood, 1 cloud
uniform float uSeed;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  // dry-brush silhouette: the paint breaks up where the form turns away
  float facing = max(dot(N, V), 0.0);
  float speck = hash13(floor(vWorld * 22.0) + uSeed);
  if (speck > smoothstep(0.0, 0.28, facing) * 1.1) discard;

  float grain = vnoise3(vLocal * 9.0 + uSeed) * 0.6 + vnoise3(vLocal * 26.0) * 0.4;
  vec3 albedo = uColor * (0.9 + 0.18 * grain);
  float ao = mix(0.35, 1.0, vAO);
  float sunVis = uKind > 0.5 ? 1.0 : castLight(vWorld, 0.08);
  vec3 col = paintLight(albedo, N, sunVis, ao, uKind > 0.5 ? 0.35 : 0.15);
  // a dab of sunlit highlight on the side facing the sun
  float hi = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.12, 1.12, 0.95) + vec3(0.03, 0.03, 0.0), hi * (1.0 - uKind) * 0.8);
  // cooler, bluer shade under clouds and inside canopies
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * uShadeTint, shade * 0.6);
  gl_FragColor = vec4(underwater(col, -vWorld.y), 1.0);
}
`;

function propMaterial(world: WorldUniforms, color: string, shadeTint: string, kind: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(color) },
      uShadeTint: { value: new THREE.Color(shadeTint) },
      uKind: { value: kind },
      uSeed: { value: seed },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

function canopy(seed: number, r: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, r, r * 0.88, r);
  const ext = r * 1.35;
  return meshSDF(
    woolField(base, {
      seed,
      min: [-ext, -ext, -ext],
      max: [ext, ext, ext],
      inset: r * 0.14,
      layers: [{ count: 34, rMin: r * 0.26, rMax: r * 0.4 }, { count: 50, rMin: r * 0.14, rMax: r * 0.22 }],
      blend: r * 0.12,
      curl: 0.004,
    }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: r / 14, ao: true },
  );
}

function cloudShape(seed: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) =>
    Math.min(
      sdEllipsoid(x, y, z, 0, 0, 0, 2.1, 0.75, 1.4),
      sdEllipsoid(x, y, z, 0.9, 0.35, 0.3, 1.1, 0.75, 0.95),
      sdEllipsoid(x, y, z, -1.0, 0.2, -0.3, 0.95, 0.6, 0.9),
    );
  return meshSDF(
    woolField(base, {
      seed,
      min: [-3.2, -1.2, -2.3],
      max: [3.2, 1.6, 2.3],
      inset: 0.22,
      layers: [{ count: 40, rMin: 0.45, rMax: 0.75 }, { count: 70, rMin: 0.22, rMax: 0.38 }],
      blend: 0.25,
      curl: 0.01,
    }),
    { min: [-3.8, -1.6, -2.8], max: [3.8, 2.3, 2.8], cell: 0.09, ao: true },
  );
}

/** Smooth stones along the steep edge, some just breaking the surface. */
const STONES: { x: number; z: number; r: number; seed: number }[] = [
  { x: -6.9, z: -1.9, r: 0.24, seed: 31 },
  { x: -6.55, z: -1.6, r: 0.15, seed: 32 },
  { x: 7.75, z: -3.2, r: 0.28, seed: 33 },
  { x: 7.9, z: -2.7, r: 0.17, seed: 34 },
  { x: -2.3, z: -5.35, r: 0.2, seed: 35 },
  { x: 4.6, z: -5.25, r: 0.18, seed: 36 },
  { x: -1.75, z: -1.45, r: 0.16, seed: 37 },
];

function stoneShape(seed: number, r: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, r, r * 0.52, r * 0.82);
  const ext = r * 1.4;
  return meshSDF(
    woolField(base, { seed, min: [-ext, -ext, -ext], max: [ext, ext, ext], inset: r * 0.08, layers: [{ count: 6, rMin: r * 0.45, rMax: r * 0.6 }], blend: r * 0.5, curl: 0.002 }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: r / 10, ao: true },
  );
}

function withAO(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = m.geometry.getAttribute('position').count;
    if (!m.geometry.getAttribute('aAO')) m.geometry.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    m.layers.enable(PROP_SHADOW_LAYER);
  });
}

/** The footbridge: a humped deck of planks on posts with a low rail each side. */
function bridge(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  g.position.set(BRIDGE.x, 0, BRIDGE.z);
  // local +x runs along the bridge (u), +z across it (v)
  g.rotation.y = Math.atan2(-BRIDGE.uz, BRIDGE.ux);
  const wood = propMaterial(world, '#c99f70', '#a197cc', 0, 41);
  const dark = propMaterial(world, '#9d7752', '#a197cc', 0, 42);
  const half = BRIDGE.length / 2;
  const planks = Math.round(BRIDGE.length / 0.17);
  for (let i = 0; i < planks; i++) {
    const u = -half + (i + 0.5) * (BRIDGE.length / planks);
    const w = BRIDGE.width * (0.97 + 0.06 * Math.sin(i * 12.9));
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, w), i % 4 === 1 ? dark : wood);
    const slope = Math.atan2(deckHeight(u + 0.05) - deckHeight(u - 0.05), 0.1);
    plank.position.set(u, deckHeight(u) - 0.022, 0.012 * Math.sin(i * 7.1));
    plank.rotation.set(0, 0.025 * Math.sin(i * 5.3), slope);
    g.add(plank);
  }
  for (const v of [-1, 1]) {
    const z = v * (BRIDGE.width / 2 - 0.03);
    // the rail: short straight segments following the hump
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const u0 = -half + 0.1 + (i / segs) * (BRIDGE.length - 0.2);
      const u1 = -half + 0.1 + ((i + 1) / segs) * (BRIDGE.length - 0.2);
      const y0 = deckHeight(u0) + 0.3, y1 = deckHeight(u1) + 0.3;
      const len = Math.hypot(u1 - u0, y1 - y0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.045, 0.05), wood);
      rail.position.set((u0 + u1) / 2, (y0 + y1) / 2, z);
      rail.rotation.z = Math.atan2(y1 - y0, u1 - u0);
      g.add(rail);
    }
    for (let i = 0; i <= 4; i++) {
      const u = -half + 0.1 + (i / 4) * (BRIDGE.length - 0.2);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), dark);
      post.position.set(u, deckHeight(u) + 0.14, z);
      g.add(post);
      // legs down into the water and the bank
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.2, 8), dark);
      leg.position.set(u, deckHeight(u) - 0.62, z);
      g.add(leg);
    }
  }
  withAO(g);
  return g;
}

/** The bench: three seat slats, two back slats, dark iron-ish ends. */
function bench(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  const y = groundHeight(BENCH.x, BENCH.z);
  g.position.set(BENCH.x, y, BENCH.z);
  g.rotation.y = BENCH.yaw;
  const wood = propMaterial(world, '#c58f5e', '#a197cc', 0, 51);
  const iron = propMaterial(world, '#5b5651', '#8f8ab8', 0, 52);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(BENCH.length, 0.04, 0.13), wood);
    slat.position.set(0, BENCH.seat, -0.16 + i * 0.16);
    g.add(slat);
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(BENCH.length, 0.1, 0.035), wood);
    back.position.set(0, BENCH.seat + 0.18 + i * 0.16, -0.27);
    back.rotation.x = -0.18;
    g.add(back);
  }
  for (const s of [-1, 1]) {
    const x = s * (BENCH.length / 2 - 0.12);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, BENCH.seat, 0.05), iron);
    leg.position.set(x, BENCH.seat / 2, 0.15);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, BENCH.seat + 0.42, 0.05), iron);
    back.position.set(x, (BENCH.seat + 0.42) / 2, -0.22);
    back.rotation.x = -0.12;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.46), iron);
    arm.position.set(x, BENCH.seat + 0.18, -0.03);
    g.add(leg, back, arm);
  }
  withAO(g);
  return g;
}

/** Two lily pads, notched discs lying on the water. */
function lilyPads(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  const mat = propMaterial(world, '#6f9a5c', '#9fb0c8', 0, 61);
  for (const p of LILY_PADS) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(p.r, 28, 0.25, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), mat);
    pad.position.set(p.x, WATER_Y + 0.008, p.z);
    pad.rotation.y = p.yaw;
    g.add(pad);
  }
  withAO(g);
  // pads sit flat; they don't need to cast
  g.traverse((o) => o.layers.disable(PROP_SHADOW_LAYER));
  return g;
}

interface Cloud { mesh: THREE.Mesh; speed: number; size: number; axis: 'x' | 'z'; span: number }

export interface Props {
  group: THREE.Group;
  update(dt: number): void;
}

export function createProps(world: WorldUniforms): Props {
  const group = new THREE.Group();
  group.name = 'props';

  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 8);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = propMaterial(world, '#7a5a3e', '#9a8fc4', 0, 0);
  const trunkAO = new Float32Array(trunkGeo.getAttribute('position').count).fill(1);
  trunkGeo.setAttribute('aAO', new THREE.BufferAttribute(trunkAO, 1));
  for (const t of TREES) {
    const y = groundHeight(t.x, t.z);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(t.x, y - 0.05, t.z);
    trunk.scale.set(t.trunk / 0.1, t.r * 1.1, t.trunk / 0.1);
    const crown = new THREE.Mesh(canopy(t.seed, t.r), propMaterial(world, t.color, t.color === '#f0b6c3' ? '#b8a6dc' : '#8c9fd0', 0, t.seed));
    crown.position.set(t.x, y + t.r * 1.75, t.z);
    for (const m of [trunk, crown]) {
      m.layers.enable(PROP_SHADOW_LAYER);
      group.add(m);
    }
  }

  for (const st of STONES) {
    const mesh = new THREE.Mesh(stoneShape(st.seed, st.r), propMaterial(world, '#c9c2b4', '#a9a6cf', 0, st.seed));
    mesh.position.set(st.x, Math.max(groundHeight(st.x, st.z), -0.1) + st.r * 0.1, st.z);
    mesh.rotation.y = st.seed * 1.3;
    mesh.layers.enable(PROP_SHADOW_LAYER);
    group.add(mesh);
  }
  group.add(bridge(world), bench(world), lilyPads(world));

  const clouds: Cloud[] = [];
  const cloudDefs = [
    // they travel along the edges of the tile, as in the references, so they never hide a sheep for long
    { x: -4, y: 3.6, z: -7.2, s: 0.62, seed: 11, speed: 0.15, axis: 'x' as const, span: 9.5 },
    { x: 9.8, y: 4.0, z: 1.5, s: 0.5, seed: 12, speed: -0.12, axis: 'z' as const, span: 7 },
  ];
  for (const c of cloudDefs) {
    const mesh = new THREE.Mesh(cloudShape(c.seed), propMaterial(world, '#fbfaf6', '#dfe2f5', 1, c.seed));
    mesh.position.set(c.x, c.y, c.z);
    mesh.scale.setScalar(c.s);
    mesh.layers.enable(PROP_SHADOW_LAYER);
    group.add(mesh);
    clouds.push({ mesh, speed: c.speed, size: c.s, axis: c.axis, span: c.span });
  }

  return {
    group,
    update(dt: number) {
      // clouds drift across the tile and gently dissolve as they reach its edge, then return
      for (const c of clouds) {
        const p = c.mesh.position;
        p[c.axis] += c.speed * dt;
        if (p[c.axis] > c.span) p[c.axis] = -c.span;
        if (p[c.axis] < -c.span) p[c.axis] = c.span;
        const fade = Math.min(1, (c.span - Math.abs(p[c.axis])) / 3.5);
        c.mesh.scale.setScalar(c.size * Math.max(0.001, fade * fade * (3 - 2 * fade)));
      }
    },
  };
}
