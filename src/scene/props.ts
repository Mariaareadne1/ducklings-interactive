import * as THREE from 'three';
import { meshSDF, sdEllipsoid } from '../creatures/sdf';
import { woolField } from '../creatures/wool';
import { groundHeight, JETTY } from './pondShape';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * Round painted trees, a few smooth stones, the little wooden jetty and the
 * drifting clouds. Trees and clouds are puff fields (MEADOW's fleece
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

interface TreeDef { x: number; z: number; r: number; color: string; seed: number }

const TREES: TreeDef[] = [
  { x: -11.6, z: -7.9, r: 1.3, color: '#7cb956', seed: 1 },
  { x: -9.4, z: -8.9, r: 0.85, color: '#8cc35e', seed: 2 },
  { x: 11.4, z: -7.6, r: 1.1, color: '#e8a7b7', seed: 3 }, // a blossom tree leaning over the far shore
  { x: -11.8, z: 7.8, r: 1.05, color: '#72b04f', seed: 4 },
  { x: 11.9, z: 8.0, r: 0.8, color: '#94c862', seed: 6 },
];

/** Smooth stones: some on the bank, some just breaking the surface in the shallows. */
const STONES: { x: number; z: number; r: number; seed: number }[] = [
  { x: -9.6, z: 3.6, r: 0.42, seed: 31 },
  { x: -9.1, z: 4.1, r: 0.26, seed: 32 },
  { x: 9.6, z: -3.4, r: 0.5, seed: 33 },
  { x: 10.1, z: -2.8, r: 0.3, seed: 34 },
  { x: -3.2, z: 6.9, r: 0.34, seed: 35 },
  { x: 3.4, z: -7.0, r: 0.3, seed: 36 },
  { x: -10.6, z: -2.4, r: 0.36, seed: 37 },
];

function stoneShape(seed: number, r: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, r, r * 0.52, r * 0.82);
  const ext = r * 1.4;
  return meshSDF(
    woolField(base, { seed, min: [-ext, -ext, -ext], max: [ext, ext, ext], inset: r * 0.08, layers: [{ count: 6, rMin: r * 0.45, rMax: r * 0.6 }], blend: r * 0.5, curl: 0.002 }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: r / 10, ao: true },
  );
}

/** The jetty: a deck of planks on posts, its outer end over the water. */
function jetty(world: WorldUniforms): THREE.Group {
  const g = new THREE.Group();
  g.position.set(JETTY.x, 0, JETTY.z);
  g.rotation.y = JETTY.yaw;
  const wood = propMaterial(world, '#b48a5f', '#9a8fc4', 0, 41);
  const dark = propMaterial(world, '#8c6a4b', '#9a8fc4', 0, 42);
  const planks = Math.round(JETTY.length / 0.3);
  for (let i = 0; i < planks; i++) {
    const w = JETTY.width * (0.96 + 0.08 * Math.sin(i * 12.9));
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, w), i % 3 === 1 ? dark : wood);
    plank.position.set(0.15 + i * 0.3, JETTY.deck, 0.02 * Math.sin(i * 7.1));
    plank.rotation.y = 0.03 * Math.sin(i * 5.3);
    g.add(plank);
  }
  for (const u of [0.3, JETTY.length * 0.55, JETTY.length - 0.15]) {
    for (const v of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.6, 8), dark);
      post.position.set(u, JETTY.deck - 0.62, v * (JETTY.width / 2 - 0.05));
      g.add(post);
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = m.geometry.getAttribute('position').count;
    if (!m.geometry.getAttribute('aAO')) m.geometry.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    m.layers.enable(PROP_SHADOW_LAYER);
  });
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
    trunk.scale.set(1, t.r * 0.95, 1);
    const crown = new THREE.Mesh(canopy(t.seed, t.r), propMaterial(world, t.color, t.color === '#e8a7b7' ? '#b8a6dc' : '#8c9fd0', 0, t.seed));
    crown.position.set(t.x, y + t.r * 1.45, t.z);
    for (const m of [trunk, crown]) {
      m.layers.enable(PROP_SHADOW_LAYER);
      group.add(m);
    }
  }

  for (const st of STONES) {
    const mesh = new THREE.Mesh(stoneShape(st.seed, st.r), propMaterial(world, '#c9c2b4', '#a9a6cf', 0, st.seed));
    mesh.position.set(st.x, Math.max(groundHeight(st.x, st.z), -0.12) + st.r * 0.12, st.z);
    mesh.rotation.y = st.seed * 1.3;
    mesh.layers.enable(PROP_SHADOW_LAYER);
    group.add(mesh);
  }
  group.add(jetty(world));

  const clouds: Cloud[] = [];
  const cloudDefs = [
    // they travel along the edges of the tile, as in the references, so they never hide a sheep for long
    { x: -5, y: 4.4, z: -9.6, s: 0.9, seed: 11, speed: 0.18, axis: 'x' as const, span: 13 },
    { x: 13.6, y: 5.0, z: 2, s: 0.7, seed: 12, speed: -0.14, axis: 'z' as const, span: 9 },
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
