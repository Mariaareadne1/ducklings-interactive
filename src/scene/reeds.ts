import * as THREE from 'three';
import { groundHeight, onJetty, pondSDF, edgeDistance } from './pondShape';
import { fbm2, seededRandom } from './noise';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { PROP_SHADOW_LAYER } from './props';
import type { WorldUniforms } from './world';

/**
 * Reeds and cattails gathered in clumps along the shore: instanced, tapered
 * blades that sway with the wind and lean together in a breeze. Cattails
 * carry a soft brown head. They cast shadows through a depth material that
 * shares their sway, so a shadow never disagrees with its reed.
 */

const SWAY_GLSL = /* glsl */ `
// lateral sway at height fraction h for a reed rooted at base
vec2 reedSway(vec3 base, float h, float height) {
  vec2 dir = normalize(vec2(1.0, 0.35));
  float gust = (vnoise(base.xz * 0.3 + uTime * 0.45) - 0.5) * 0.3 * uWind;
  float flutter = sin(uTime * 2.3 + base.x * 3.1 + base.z * 1.7) * 0.03 * uWind;
  float lean = uBreeze * (0.42 + 0.1 * sin(uTime * 1.7 + base.x));
  return dir * (gust + flutter + lean) * h * h * height;
}
`;

const reedVertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${SWAY_GLSL}
attribute vec2 aBlade;  // h (0 root .. 1 tip), side (-1 / 1)
attribute vec4 aOffset; // base xyz, yaw
attribute vec4 aShape;  // height, curl, width, rand
varying vec3 vWorld;
varying float vH;
varying float vRand;
void main() {
  float h = aBlade.x;
  float height = aShape.x;
  float width = aShape.z * (1.0 - h * 0.88);
  vec3 p = vec3(aBlade.y * width, h * height, aShape.y * h * h * height);
  float c = cos(aOffset.w), s = sin(aOffset.w);
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  vec2 sway = reedSway(aOffset.xyz, h, height);
  p.xz += sway;
  p.y -= dot(sway, sway) * 0.5 / max(height, 0.1);
  vec4 wp = vec4(aOffset.xyz + p, 1.0);
  vWorld = wp.xyz;
  vH = h;
  vRand = aShape.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const reedFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;
varying float vH;
varying float vRand;
void main() {
  vec3 root = mix(srgb(vec3(0.27, 0.45, 0.22)), srgb(vec3(0.33, 0.52, 0.25)), vRand);
  vec3 tip = mix(srgb(vec3(0.62, 0.73, 0.34)), srgb(vec3(0.74, 0.76, 0.42)), vRand);
  vec3 albedo = mix(root, tip, smoothstep(0.0, 1.0, vH));
  albedo *= 0.94 + 0.1 * vnoise(vec2(vH * 20.0, vRand * 50.0));
  float sunVis = castLight(vWorld, 0.04);
  vec3 col = paintLight(albedo, normalize(vec3(-0.3, 0.8, 0.5)), sunVis, mix(0.75, 1.0, vH), 0.3);
  gl_FragColor = vec4(underwater(col, -vWorld.y), 1.0);
}
`;

const headVertex = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${SWAY_GLSL}
attribute vec4 aOffset; // stalk base xyz, stalk height
attribute vec4 aShape;  // curl, yaw, head scale, rand
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRand;
void main() {
  float height = aOffset.w;
  vec3 top = vec3(0.0, height, aShape.x * height);
  float c = cos(aShape.y), s = sin(aShape.y);
  top = vec3(-s * top.z, top.y, c * top.z);
  vec2 sway = reedSway(aOffset.xyz, 1.0, height);
  top.xz += sway;
  top.y -= dot(sway, sway) * 0.5 / max(height, 0.1);
  vec3 p = position * aShape.z;
  vec4 wp = vec4(aOffset.xyz + top + p - vec3(0.0, 0.16 * aShape.z, 0.0), 1.0);
  vWorld = wp.xyz;
  vNormalW = normal;
  vRand = aShape.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const headFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRand;
void main() {
  vec3 albedo = mix(srgb(vec3(0.52, 0.34, 0.22)), srgb(vec3(0.60, 0.40, 0.26)), vRand);
  albedo *= 0.92 + 0.12 * vnoise(vWorld.xy * 60.0);
  float sunVis = castLight(vWorld, 0.04);
  gl_FragColor = vec4(paintLight(albedo, normalize(vNormalW), sunVis, 1.0, 0.25), 1.0);
}
`;

const depthFragment = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;

function bladeGeometry(): THREE.InstancedBufferGeometry {
  const SEG = 5;
  const blade: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const h = i / SEG;
    blade.push(h, -1, h, 1);
    if (i < SEG) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  // position is unused by the shader but three needs it for draw counts
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array((blade.length / 2) * 3).fill(0), 3));
  geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 2));
  geo.setIndex(index);
  return geo;
}

interface Clump { x: number; z: number; n: number; cattails: number }

function clumps(seed: number): Clump[] {
  const rand = seededRandom(seed);
  const out: Clump[] = [];
  let attempts = 0;
  while (out.length < 46 && attempts < 4000) {
    attempts++;
    const x = (rand() * 2 - 1) * 13;
    const z = (rand() * 2 - 1) * 9.6;
    const s = pondSDF(x, z);
    if (s < -0.7 || s > 0.8 || edgeDistance(x, z) < 1.1 || onJetty(x, z, 1.2)) continue;
    // reeds gather on the far and left shores, thinner along the near bank where we look in
    const favour = 0.45 + 0.55 * Math.max(0, fbm2(x / 5 + 3, z / 5 - 1, 2) + 0.2) + (z < 2 ? 0.3 : -0.1);
    if (rand() > favour) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 1.1)) continue;
    out.push({ x, z, n: 10 + Math.floor(rand() * 16), cattails: rand() < 0.55 ? 1 + Math.floor(rand() * 3) : 0 });
  }
  return out;
}

function reedMaterial(world: WorldUniforms, vertexShader: string, fragmentShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms: world, vertexShader, fragmentShader, side: THREE.DoubleSide });
}

export function createReeds(world: WorldUniforms, density = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'reeds';
  const rand = seededRandom(91);
  const blades: number[][] = [];
  const heads: number[][] = [];
  for (const c of clumps(17)) {
    const n = Math.round(c.n * density);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.55;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const y = groundHeight(x, z) - 0.02;
      const height = 0.9 + rand() * 0.9 + (r < 0.25 ? 0.3 : 0);
      blades.push([x, y, z, rand() * Math.PI * 2, height, (rand() - 0.3) * 0.35, 0.03 + rand() * 0.015, rand()]);
    }
    for (let i = 0; i < c.cattails; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 0.35;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const y = groundHeight(x, z) - 0.02;
      const height = 1.7 + rand() * 0.6;
      const yaw = rand() * Math.PI * 2;
      const curl = 0.06 + rand() * 0.06;
      // the stalk is a thin blade; its head rides on top with the same sway
      blades.push([x, y, z, yaw, height, curl, 0.012, rand()]);
      heads.push([x, y, z, height, curl, yaw, 0.9 + rand() * 0.3, rand()]);
    }
  }

  const geo = bladeGeometry();
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(blades.flatMap((b) => b.slice(0, 4))), 4));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(blades.flatMap((b) => b.slice(4))), 4));
  geo.instanceCount = blades.length;
  const reeds = new THREE.Mesh(geo, reedMaterial(world, reedVertex, reedFragment));
  reeds.frustumCulled = false;
  reeds.userData.depthMaterial = reedMaterial(world, reedVertex, depthFragment);
  reeds.layers.enable(PROP_SHADOW_LAYER);
  group.add(reeds);

  const capsule = new THREE.CapsuleGeometry(0.05, 0.22, 4, 8);
  const hg = new THREE.InstancedBufferGeometry();
  hg.setAttribute('position', capsule.getAttribute('position'));
  hg.setAttribute('normal', capsule.getAttribute('normal'));
  hg.setIndex(capsule.getIndex());
  hg.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(heads.flatMap((h) => h.slice(0, 4))), 4));
  hg.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(heads.flatMap((h) => h.slice(4))), 4));
  hg.instanceCount = heads.length;
  const headMesh = new THREE.Mesh(hg, reedMaterial(world, headVertex, headFragment));
  headMesh.frustumCulled = false;
  headMesh.userData.depthMaterial = reedMaterial(world, headVertex, depthFragment);
  headMesh.layers.enable(PROP_SHADOW_LAYER);
  group.add(headMesh);
  return group;
}
