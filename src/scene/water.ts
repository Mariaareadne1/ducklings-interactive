import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { GROUND_GLSL } from './terrain';
import { MAX_BLOOMS, MAX_RIPPLES, type WorldUniforms } from './world';
import { WATER_Y } from './pondShape';

/**
 * The water's surface, painted over the pond bed the way a watercolourist
 * would finish it: a thin wash of reflected sky (stronger toward the far
 * side), slow pale light streaks, a darker wet line where water meets bank,
 * cool shadows from what floats or flies above, and ripple rings — a pale
 * crest with a darker trough — spreading from anything that touches it.
 * Things under the surface show through it; it never writes depth.
 */

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;

// "over" compositing of premultiplied layers
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }

void main() {
  vec2 xz = vWorld.xz;
  float s = pondSDF(xz);
  if (s > 0.02) discard;
  float edge = paintEdge(xz);
  if (edge < 0.0) discard;

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(V.y, 0.0), 2.0);

  // reflected sky: pale and cool, a little stronger toward the far bank
  vec3 sky = srgb(vec3(0.88, 0.94, 0.97));
  float skyA = 0.07 + 0.32 * fres;
  skyA *= 0.75 + 0.5 * vnoise(xz * 0.25 + uTime * 0.02);
  vec4 layer = vec4(sky * skyA, skyA);

  // pigment blooming on the wet surface as something is painted in: a soft,
  // irregular stain with a darker edge where the paint pools, fading as it sinks in
  for (int i = 0; i < ${MAX_BLOOMS}; i++) {
    vec4 b = uBlooms[i];
    float age = uTime - b.z;
    if (age < 0.0 || age > 2.6) continue;
    float grow = 1.0 - exp(-age * 3.0);
    float r = b.w * (0.25 + 0.8 * grow);
    vec2 q = (xz - b.xy) / b.w;
    float n = vnoise(q * 2.4 + float(i) * 7.1) * 0.6 + vnoise(q * 6.5 - float(i) * 3.3) * 0.4;
    float d = length(xz - b.xy) / r + (n - 0.5) * 0.5;
    float inside = smoothstep(1.0, 0.9, d);
    float rim = smoothstep(0.68, 0.95, d) * inside;
    float fade = 1.0 - smoothstep(1.0, 2.6, age);
    float a = (0.1 + 0.2 * rim) * inside * fade;
    layer = over(vec4(uBloomColors[i] * (1.0 - 0.3 * rim) * a, a), layer);
  }

  // cool shadow of whatever floats or flies over the water
  float sunVis = castLight(vWorld, 0.03);
  float sh = (1.0 - sunVis) * 0.42;
  vec3 shadeCol = srgb(vec3(0.20, 0.30, 0.44)) * uShadeColor;
  layer = over(vec4(shadeCol * sh, sh), layer);

  // slow, horizontal light streaks drifting across, like dry-brush highlights
  float n = vnoise(vec2(xz.x * 0.32 + uTime * 0.035, xz.y * 2.4)) * 0.7 + vnoise(vec2(xz.x * 0.9 - uTime * 0.05, xz.y * 6.0)) * 0.3;
  float streak = smoothstep(0.7, 0.86, n) * (0.35 + 0.65 * fres) * sunVis;
  // a few glints: short white dashes that twinkle
  vec2 g = vec2(xz.x * 4.0, xz.y * 14.0);
  float glint = step(0.9985, hash12(floor(g) + floor(uTime * 0.8 + hash12(floor(g)) * 5.0) * 7.0));
  float hi = streak * 0.4 + glint * 0.35 * sunVis;

  // the wet line where water meets the bank, and a broken pale band just inside it
  float wet = smoothstep(-0.22, 0.0, s);
  float foam = smoothstep(0.06, 0.0, abs(s + 0.28 + (vnoise(xz * 2.5) - 0.5) * 0.12)) * step(0.45, vnoise(xz * 3.3 + uTime * 0.1));
  hi += foam * 0.35;

  // ripple rings
  float crest = 0.0;
  float trough = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.2 || r.w <= 0.0) continue;
    float life = 1.0 - age / 3.2;
    float rad = 0.12 + age * (0.55 + 0.25 * r.w);
    float d = length(xz - r.xy) - rad;
    float w = 0.025 + age * 0.022;
    float k = r.w * life * life;
    crest += exp(-pow((d - w * 0.6) / w, 2.0)) * k;
    trough += exp(-pow((d + w * 0.9) / w, 2.0)) * k * 0.7;
    // a second, fainter ring behind the first
    float d2 = length(xz - r.xy) - rad * 0.58;
    crest += exp(-pow(d2 / (w * 0.8), 2.0)) * k * 0.45 * smoothstep(0.2, 0.6, age);
  }
  trough = min(trough, 1.0);
  layer = over(vec4(srgb(vec3(0.16, 0.36, 0.42)) * 0.45 * trough, 0.45 * trough), layer);
  float wetA = wet * 0.32;
  layer = over(vec4(srgb(vec3(0.24, 0.36, 0.34)) * wetA, wetA), layer);
  float hiA = clamp(hi + crest * 0.5, 0.0, 0.85);
  layer = over(vec4(srgb(vec3(0.97, 0.98, 0.95)) * hiA, hiA), layer);

  // feather into the shore, thin out where the tile's paint runs out
  float fade = smoothstep(0.02, -0.06, s) * smoothstep(0.0, 0.8, edge);
  gl_FragColor = layer * fade;
}
`;

export function createWater(world: WorldUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(26, 18, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0.6, WATER_Y, -0.3);
  const material = new THREE.ShaderMaterial({
    uniforms: world,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'water';
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * A small pool of ripple rings written straight into the shared uniforms.
 * The oldest ring is reused when the pool is full.
 */
export class Ripples {
  private next = 0;

  constructor(private readonly world: WorldUniforms) {}

  add(x: number, z: number, strength = 1): void {
    const slot = this.world.uRipples.value[this.next];
    slot.set(x, z, this.world.uTime.value, Math.max(0, Math.min(1.6, strength)));
    this.next = (this.next + 1) % MAX_RIPPLES;
  }

  clear(): void {
    for (const r of this.world.uRipples.value) r.set(0, 0, -100, 0);
  }

  /** A watercolour stain blooming on the water (x, z, radius in m, colour as linear RGB). */
  private nextBloom = 0;
  bloom(x: number, z: number, radius: number, color: THREE.Color): void {
    const i = this.nextBloom;
    this.world.uBlooms.value[i].set(x, z, this.world.uTime.value, radius);
    this.world.uBloomColors.value[i].copy(color);
    this.nextBloom = (i + 1) % MAX_BLOOMS;
  }
}
