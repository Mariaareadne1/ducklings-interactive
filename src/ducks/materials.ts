import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';
import { DUCK_ALBEDO_GLSL } from './paint';

/**
 * One painted material for every duck part. Each part chooses its paint with
 * `uPart` (see paint.ts); everything else is shared: MEADOW's brush-sweep
 * reveal (flat colour first, then light and shade), the gouache light ramp
 * with a gentle shade for cream and yellow, the underwater tint for feet
 * paddling below the surface, the wet edge of fresh paint and the soft blue
 * selection rim. Fluff parts also draw a couple of fur shells: the same
 * mesh pushed out along its normals, broken into fibres by noise.
 */

export const PART = {
  motherBody: 10, motherHead: 11, motherBill: 12, motherWing: 13, motherEye: 14, motherFoot: 15,
  ducklingBody: 20, ducklingHead: 21, ducklingBill: 22, ducklingWing: 23, ducklingEye: 24, ducklingFoot: 25, ducklingTuft: 26,
} as const;

export const SHELL_LAYERS = 2;

export interface DuckUniforms {
  [name: string]: THREE.IUniform;
  uReveal: THREE.IUniform<number>;
  uRevealOrigin: THREE.IUniform<THREE.Vector3>;
  uRevealDir: THREE.IUniform<THREE.Vector3>;
  uRevealRadius: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  /** Per-duck look: x cap darkness, y warmth, z wetness (after a swim), w fade (leaving). */
  uLook: THREE.IUniform<THREE.Vector4>;
  /** 0..1 fluffed up (a shake). */
  uFluff: THREE.IUniform<number>;
  /** Fur shell length in local units. */
  uFur: THREE.IUniform<number>;
}

export function createDuckUniforms(seed: number): DuckUniforms {
  return {
    uReveal: { value: 1 },
    uRevealOrigin: { value: new THREE.Vector3() },
    uRevealDir: { value: new THREE.Vector3(1, 0, 0) },
    uRevealRadius: { value: 1 },
    uSeed: { value: (seed % 97) + 0.37 },
    uHighlight: { value: 0 },
    uLook: { value: new THREE.Vector4(0, 0, 0, 1) },
    uFluff: { value: 0 },
    uFur: { value: 0.007 },
  };
}

const DUCK_UNIFORMS_GLSL = /* glsl */ `
uniform float uReveal;
uniform vec3 uRevealOrigin;
uniform vec3 uRevealDir;
uniform float uRevealRadius;
uniform float uSeed;
uniform float uHighlight;
uniform vec4 uLook;
uniform float uFluff;
uniform float uFur;
uniform float uPart;
`;

const vertex = /* glsl */ `
${DUCK_UNIFORMS_GLSL}
attribute float aAO;
#ifdef SHELL
attribute float aShell;
#endif
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vAO;
varying float vShell;

void main() {
  vec3 p = position;
  float h = 0.0;
#ifdef SHELL
  h = aShell;
  p += normal * h * uFur * (1.0 + uFluff * 1.2);
#endif
  vLocal = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vNormalL = normal;
  vAO = aAO;
  vShell = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${DUCK_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vAO;
varying float vShell;

// MEADOW's brush reveal: strokes sweep from tail to bill. Returns closeness
// to the wet front; discards what is not painted yet.
float revealClip(vec3 world) {
  if (uReveal >= 0.999) return 0.0;
  vec3 q = (world - uRevealOrigin) / uRevealRadius;
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), uRevealDir));
  float along = dot(q, uRevealDir);
  vec2 across = vec2(dot(q, side), q.y);
  float stroke = vnoise(across * vec2(7.0, 11.0) + uSeed) * 0.62 + vnoise(vec2(along * 4.0, across.y * 28.0)) * 0.38;
  float gap = uReveal * 1.25 - ((along * 0.5 + 0.5) * 0.8 + stroke * 0.42);
  if (gap < 0.0) discard;
  return 1.0 - smoothstep(0.0, 0.15, gap);
}

float shadeIn() { return smoothstep(0.45, 1.0, uReveal); }

${DUCK_ALBEDO_GLSL}

void main() {
  float front = revealClip(vWorld);
  // leaving: the duck thins out like paint lifted off the page
  if (uLook.w < 0.999 && hash13(floor(vWorld * 90.0)) > uLook.w) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;

  float alpha = 1.0;
  float softness = 0.3;
  float keep = 0.0;
  vec3 albedo = duckAlbedo(alpha, softness, keep, N);
#ifdef SHELL
  // a dry-brush fringe: fine fibres that thin out toward the tips
  // only toward the silhouette, where fluff catches the light against what's behind
  float fibre = vnoise3(vLocal * 240.0 + uSeed) * 0.7 + vnoise3(vLocal * 80.0) * 0.3;
  float facing = abs(dot(N, V));
  if (fibre < 0.42 + vShell * 0.4 || facing > 0.35 + 0.3 * fibre) discard;
  float sunVis = castLightFast(vWorld, 0.02);
#else
  if (alpha < 0.03) discard;
  float sunVis = castLight(vWorld, 0.02);
#endif

  float ao = mix(0.6, 1.0, smoothstep(0.1, 0.9, vAO));
#ifdef SHELL
  ao *= mix(0.9, 1.0, vShell);
#endif
  vec3 lit = paintLight(albedo, N, sunVis, ao, softness);
  lit += albedo * smoothstep(0.75, 0.98, dot(N, normalize(uSunDir + V))) * 0.14 * sunVis * (1.0 - keep);
  lit = mix(lit, albedo * mix(vec3(1.0), uShadeColor, 0.12), keep * (1.0 - sunVis * 0.5));
  // the sunlit edge of fluff glows warm
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += albedo * rim * 0.1 * sunVis;
  vec3 flatPaint = albedo * mix(vec3(1.0), uShadeColor, 0.12);
  vec3 col = mix(flatPaint, lit, shadeIn());
  col = underwater(col, -vWorld.y);
  col = mix(col, col * 0.82, smoothstep(0.5, 0.95, front) * 0.75);
  col += vec3(0.12, 0.3, 0.75) * uHighlight * pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createPartMaterial(world: WorldUniforms, duck: DuckUniforms, part: number, options: { doubleSided?: boolean; shell?: boolean } = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...world, ...duck, uPart: { value: part } },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (options.shell) material.defines = { SHELL: 1 };
  return material;
}

const shellLayerData = (() => {
  const a = new Float32Array(SHELL_LAYERS);
  for (let i = 0; i < SHELL_LAYERS; i++) a[i] = (i + 1) / SHELL_LAYERS;
  return new THREE.InstancedBufferAttribute(a, 1);
})();

/** An instanced view of a fluff geometry: the same buffers, drawn once per fur shell. */
export function shellGeometry(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(base.getIndex());
  geo.setAttribute('aShell', shellLayerData);
  geo.instanceCount = SHELL_LAYERS;
  geo.boundingSphere = base.boundingSphere;
  return geo;
}
