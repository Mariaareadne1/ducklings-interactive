import * as THREE from 'three';
import {
  BRIDGE, CHANNEL, FLOWERBED, LOBE_A, LOBE_B, PATH_HALF_WIDTH, PATH_POINTS, TILE, TREES, groundHeight, groundNormal,
} from './park';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * The painted ground: a mown spring lawn laid in like MEADOW's fields (soft
 * patches, faint mowing bands, long dry-brush strokes, stipple and flecks),
 * a cream gravel path, an umber flowerbed with a pale edging, a sandy gentle
 * bank and an earthen steep one, and the pond bed painted in depth bands so
 * the colour you look down into *is* the water. The ragged dry-brush edge is
 * MEADOW's `paintEdge`.
 */

const f = (n: number) => n.toFixed(3);
const vec2s = (pts: [number, number][]) => pts.map(([x, z]) => `vec2(${f(x)}, ${f(z)})`).join(', ');

/** GLSL twin of park.ts; shared with tufts, reeds and the water surface. */
export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};
const int PATH_N = ${PATH_POINTS.length};
const vec2 PATH[${PATH_POINTS.length}] = vec2[](${vec2s(PATH_POINTS)});
const vec4 TREE0 = vec4(${f(TREES[0].x)}, ${f(TREES[0].z)}, ${f(TREES[0].r)}, 0.0);
const vec4 TREE1 = vec4(${f(TREES[1].x)}, ${f(TREES[1].z)}, ${f(TREES[1].r)}, 0.0);

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float ellipseSDF(vec2 p, vec2 c, vec2 r) {
  vec2 w = p - c;
  float k0 = length(w / r);
  float k1 = length(w / (r * r));
  return k1 < 1e-6 ? -min(r.x, r.y) : k0 * (k0 - 1.0) / k1;
}
float segSDF(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float sminf(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float pondSDF(vec2 xz) {
  float wob = 0.16 * sin(xz.x * 1.3 + xz.y * 0.7) + 0.1 * sin(xz.y * 2.1 - xz.x * 0.9 + 1.7);
  float a = ellipseSDF(xz, vec2(${f(LOBE_A.x)}, ${f(LOBE_A.z)}), vec2(${f(LOBE_A.rx)}, ${f(LOBE_A.rz)}));
  float b = ellipseSDF(xz, vec2(${f(LOBE_B.x)}, ${f(LOBE_B.z)}), vec2(${f(LOBE_B.rx)}, ${f(LOBE_B.rz)}));
  float c = segSDF(xz, vec2(${f(CHANNEL.ax)}, ${f(CHANNEL.az)}), vec2(${f(CHANNEL.bx)}, ${f(CHANNEL.bz)})) - ${f(CHANNEL.r)};
  return sminf(sminf(a, b, 0.8), c, 0.9) + wob;
}

float gentleness(vec2 xz) {
  return smoothstep(-1.4, -0.1, xz.y) * smoothstep(1.3, 2.4, xz.x) * smoothstep(7.4, 6.3, xz.x);
}

float pathDistance(vec2 xz) {
  float d = 1e3;
  for (int i = 0; i < PATH_N - 1; i++) d = min(d, segSDF(xz, PATH[i], PATH[i + 1]));
  return d;
}

float flowerbedSDF(vec2 xz) {
  return ellipseSDF(xz, vec2(${f(FLOWERBED.x)}, ${f(FLOWERBED.z)}), vec2(${f(FLOWERBED.rx)}, ${f(FLOWERBED.rz)}));
}

/** Bridge-local (u along, v across). */
vec2 bridgeLocal(vec2 xz) {
  vec2 d = xz - vec2(${f(BRIDGE.x)}, ${f(BRIDGE.z)});
  vec2 u = vec2(${f(BRIDGE.ux)}, ${f(BRIDGE.uz)});
  return vec2(dot(d, u), -d.x * u.y + d.y * u.x);
}

/** Painted water colour seen from above at a given depth below the surface (m). */
vec3 waterPaint(vec2 xz, float depth) {
  vec3 sand = srgb(vec3(0.90, 0.87, 0.72));
  vec3 shallow = srgb(vec3(0.72, 0.88, 0.84));
  vec3 mid = srgb(vec3(0.56, 0.78, 0.82));
  vec3 deep = srgb(vec3(0.44, 0.66, 0.80));
  // band edges wander like a wash laid in a few passes
  float wob = (vnoise(xz * 0.7) - 0.5) * 0.2 + (vnoise(xz * 2.3) - 0.5) * 0.07;
  float d = depth + wob;
  vec3 c = mix(sand, shallow, smoothstep(0.05, 0.26, d));
  c = mix(c, mid, smoothstep(0.45, 0.8, d));
  c = mix(c, deep, smoothstep(0.9, 1.2, d));
  // where each wash dried, its edge is a touch darker (a watercolour back-run)
  float rim = smoothstep(0.05, 0.0, abs(d - 0.62)) + smoothstep(0.05, 0.0, abs(d - 1.05)) * 0.8;
  c *= 1.0 - rim * 0.06;
  float glow = fbm2lite(xz * 0.14 + 3.0);
  c = mix(c, c * vec3(1.06, 1.08, 1.06), smoothstep(0.45, 0.8, glow) * 0.6);
  return c;
}

/** The lawn's base paint, before light. grassy = 0 on gravel, soil and sand. */
vec3 lawnPaint(vec2 xz, float s, out float grassy) {
  // soft mint patches with warm, glaze-like pools of light
  float patchN = fbm2lite(xz * 0.14 + 7.0);
  vec3 c = mix(srgb(vec3(0.58, 0.80, 0.53)), srgb(vec3(0.67, 0.84, 0.56)), smoothstep(0.35, 0.65, patchN));
  c = mix(c, srgb(vec3(0.54, 0.76, 0.49)), smoothstep(0.6, 0.85, fbm2lite(xz * 0.11 - 4.0)) * 0.6);
  float glow = fbm2lite(xz * 0.09 + 1.5);
  c = mix(c, c * vec3(1.08, 1.07, 0.93) + srgb(vec3(0.05, 0.045, 0.0)), smoothstep(0.45, 0.8, glow) * 0.55);
  // faint mowing bands, the lawn's one tidy gesture
  float band = sin((xz.x * 0.55 + xz.y * 0.32) * 2.2 + (vnoise(xz * 0.4) - 0.5) * 0.9);
  c *= 0.975 + 0.035 * smoothstep(-0.3, 0.3, band);
  // long dry-brush strokes
  float a = 0.5 + (vnoise(xz * 0.2) - 0.5) * 0.7;
  vec2 uv = mat2(cos(a), sin(a), -sin(a), cos(a)) * xz;
  float stroke = vnoise(vec2(uv.x * 0.6, uv.y * 7.0)) * 0.65 + vnoise(vec2(uv.x * 1.7, uv.y * 16.0)) * 0.35;
  c *= 0.94 + 0.12 * stroke;
  // cooler, deeper green pooled under the trees
  float under = smoothstep(TREE0.z * 1.25, TREE0.z * 0.4, length(xz - TREE0.xy - vec2(0.35, 0.2)))
              + smoothstep(TREE1.z * 1.25, TREE1.z * 0.4, length(xz - TREE1.xy - vec2(0.35, 0.2)));
  c = mix(c, srgb(vec3(0.47, 0.68, 0.48)), clamp(under, 0.0, 1.0) * 0.35);
  grassy = 1.0;

  float g = gentleness(xz);
  // lusher, darker grass along the steep edge
  float lush = smoothstep(1.2, 0.35, s) * (1.0 - g) * smoothstep(0.4, 0.68, vnoise(xz * 0.5 + 9.0));
  c = mix(c, srgb(vec3(0.44, 0.65, 0.40)) * (0.9 + 0.2 * vnoise(xz * 2.4)), lush * 0.7);

  // the flowerbed: crumbly umber soil inside a pale stone edging
  float fb = flowerbedSDF(xz) + (vnoise(xz * 3.0) - 0.5) * 0.05;
  vec3 soil = mix(srgb(vec3(0.58, 0.44, 0.32)), srgb(vec3(0.66, 0.52, 0.38)), vnoise(xz * 6.0)) * (0.92 + 0.12 * vnoise(xz * 22.0));
  float inBed = smoothstep(0.02, -0.04, fb);
  c = mix(c, soil, inBed);
  float edging = smoothstep(0.09, 0.03, abs(fb - 0.03));
  vec3 stone = srgb(vec3(0.93, 0.89, 0.80)) * (0.9 + 0.12 * step(0.5, fract(atan(xz.y - ${f(FLOWERBED.z)}, xz.x - ${f(FLOWERBED.x)}) * 7.0)));
  c = mix(c, stone, edging * 0.9);
  grassy *= 1.0 - max(inBed, edging);

  // the gravel path: cream, speckled, with soft frayed edges
  float pd = pathDistance(xz) + (vnoise(xz * 2.2) - 0.5) * 0.12;
  float onPath = 1.0 - smoothstep(${f(PATH_HALF_WIDTH - 0.08)}, ${f(PATH_HALF_WIDTH + 0.04)}, pd);
  vec3 gravel = mix(srgb(vec3(0.91, 0.86, 0.74)), srgb(vec3(0.96, 0.92, 0.82)), smoothstep(0.45, 0.0, pd));
  float speck = step(0.82, hash12(floor(xz * 30.0)));
  gravel = mix(gravel, srgb(vec3(0.78, 0.71, 0.58)), speck * 0.5);
  gravel *= 0.96 + 0.07 * vnoise(xz * 11.0);
  c = mix(c, gravel, onPath);
  grassy *= 1.0 - onPath;

  // the shore: a soft sandy slope on the gentle side, an earthen lip on the steep side
  float sh = s + (vnoise(xz * 1.6) - 0.5) * 0.12;
  float sandy = (1.0 - smoothstep(0.25, 1.3, sh)) * g;
  vec3 sand = srgb(vec3(0.91, 0.86, 0.69)) * (0.95 + 0.08 * vnoise(xz * 8.0));
  c = mix(c, sand, sandy);
  float lip = (1.0 - smoothstep(0.12, 0.34, sh)) * (1.0 - g);
  vec3 earth = mix(srgb(vec3(0.55, 0.45, 0.35)), srgb(vec3(0.66, 0.56, 0.44)), vnoise(xz * 5.0));
  c = mix(c, earth, lip);
  c = mix(c, srgb(vec3(0.62, 0.62, 0.52)), smoothstep(0.08, 0.0, s) * 0.45);
  grassy *= 1.0 - max(sandy, lip);
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 1.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.0;
  float rough = (vnoise(xz * 0.9) - 0.5) * 0.7 + (vnoise(xz * 3.4) - 0.5) * 0.35;
  return -box + rough;
}
`;

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${GROUND_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec2 xz = vWorld.xz;
  // dry-brush edge: paint thins, then breaks into specks on the paper
  float edge = paintEdge(xz);
  float cover = smoothstep(-0.1, 0.9, edge);
  if (hash12(floor(xz * 20.0)) > cover * 1.08) discard;

  float s = pondSDF(xz);
  vec3 N = normalize(vNormal);
  vec3 col;
  if (s < 0.0) {
    float depth = max(0.0, -vWorld.y);
    vec3 albedo = waterPaint(xz, depth) * (0.96 + 0.07 * vnoise(xz * 22.0));
    float sunVis = mix(1.0, castLight(vWorld, 0.08), 0.35 * (1.0 - smoothstep(0.4, 1.2, depth)));
    col = paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2);
  } else {
    float grassy;
    vec3 albedo = lawnPaint(xz, s, grassy);
    albedo *= 0.95 + 0.1 * vnoise(xz * 30.0);
    float fleck = step(0.986, hash12(floor(xz * 13.0))) * grassy;
    albedo = mix(albedo, albedo * 1.22 + srgb(vec3(0.07, 0.07, 0.0)), fleck * 0.8);
    float sunVis = castLight(vWorld, 0.04);
    col = paintLight(albedo, N, sunVis, 1.0, 0.2);
  }
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 1.2, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(): THREE.BufferGeometry {
  const step = 0.08;
  const cols = Math.round((TILE.halfX * 2) / step);
  const rows = Math.round((TILE.halfZ * 2) / step);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const normals = new Float32Array(positions.length);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    const z = -TILE.halfZ + r * step;
    for (let c = 0; c <= cols; c++) {
      const x = -TILE.halfX + c * step;
      const [nx, ny, nz] = groundNormal(x, z);
      positions.set([x, groundHeight(x, z), z], k);
      normals.set([nx, ny, nz], k);
      k += 3;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createTerrain(world: WorldUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment });
  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'terrain';
  return mesh;
}
