import * as THREE from 'three';
import { JETTY, TILE, groundHeight, groundNormal } from './pondShape';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * The painted ground: grassy banks laid in like MEADOW's fields (soft
 * patches of green, long dry-brush strokes, stipple, flecks), a sandy shore,
 * and the pond bed painted in depth bands — pale sand at the rim, clear
 * turquoise-green, a deeper teal-blue centre — so the colour you look down
 * into *is* the water. The ragged dry-brush edge is MEADOW's `paintEdge`.
 */

/** GLSL twin of pondSDF and the painted-ground helpers; shared with tufts, reeds and the water surface. */
export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${TILE.halfX.toFixed(2)};
const float HALF_Z = ${TILE.halfZ.toFixed(2)};
const vec3 JETTY = vec3(${JETTY.x.toFixed(2)}, ${JETTY.z.toFixed(2)}, ${JETTY.yaw.toFixed(3)});

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float pondSDF(vec2 xz) {
  float px = xz.x - 0.6;
  float pz = xz.y + 0.3;
  float wx = px + 0.9 * sin(pz * 0.45 + 1.3);
  float wz = pz + 0.7 * sin(px * 0.38 - 0.6);
  vec2 r = vec2(9.4, 6.2);
  vec2 w = vec2(wx, wz);
  float k0 = length(w / r);
  float k1 = length(w / (r * r));
  float e = k1 < 1e-6 ? -6.2 : k0 * (k0 - 1.0) / k1;
  float ang = atan(wz, wx);
  return e + 0.5 * sin(ang * 2.0 - 0.5) + 0.28 * sin(ang * 3.0 + 2.2) + 0.18 * sin(ang * 5.0 - 1.1);
}

/** Painted water colour seen from above at a given depth below the surface (m). */
vec3 waterPaint(vec2 xz, float depth) {
  vec3 sand = srgb(vec3(0.86, 0.82, 0.64));
  vec3 shallow = srgb(vec3(0.55, 0.80, 0.70));
  vec3 mid = srgb(vec3(0.33, 0.66, 0.64));
  vec3 deep = srgb(vec3(0.20, 0.47, 0.56));
  // band edges wander like a wash laid in a few passes
  float wob = (vnoise(xz * 0.6) - 0.5) * 0.22 + (vnoise(xz * 2.1) - 0.5) * 0.08;
  float d = depth + wob;
  vec3 c = mix(sand, shallow, smoothstep(0.08, 0.32, d));
  c = mix(c, mid, smoothstep(0.55, 0.95, d));
  c = mix(c, deep, smoothstep(1.05, 1.45, d));
  // where each wash dried, its edge is a touch darker (a watercolour back-run)
  float rim = smoothstep(0.05, 0.0, abs(d - 0.75)) + smoothstep(0.05, 0.0, abs(d - 1.25)) * 0.8;
  c *= 1.0 - rim * 0.06;
  // slow pale light streaks and a soft glow across the wash
  float glow = fbm2lite(xz * 0.12 + 3.0);
  c = mix(c, c * vec3(1.08, 1.1, 1.06), smoothstep(0.45, 0.8, glow) * 0.6);
  return c;
}

/** The bank's base paint, before light. Also returns how "grassy" it is (0 on sand/path). */
vec3 bankPaint(vec2 xz, float s, out float grassy) {
  // soft patches of green with glaze-like warm pools
  float patchN = fbm2lite(xz * 0.11 + 7.0);
  vec3 c = mix(srgb(vec3(0.55, 0.73, 0.33)), srgb(vec3(0.66, 0.77, 0.36)), smoothstep(0.35, 0.65, patchN));
  c = mix(c, srgb(vec3(0.48, 0.67, 0.31)), smoothstep(0.6, 0.85, fbm2lite(xz * 0.09 - 4.0)) * 0.7);
  float glow = fbm2lite(xz * 0.07 + 1.5);
  c = mix(c, c * vec3(1.1, 1.08, 0.92) + srgb(vec3(0.06, 0.05, 0.0)), smoothstep(0.45, 0.8, glow) * 0.6);
  // long dry-brush strokes that follow the shore
  float a = atan(xz.y + 0.3, xz.x - 0.6) + 1.5708 + (vnoise(xz * 0.2) - 0.5) * 0.8;
  vec2 uv = mat2(cos(a), sin(a), -sin(a), cos(a)) * xz;
  float stroke = vnoise(vec2(uv.x * 0.55, uv.y * 6.5)) * 0.65 + vnoise(vec2(uv.x * 1.6, uv.y * 15.0)) * 0.35;
  c *= 0.93 + 0.13 * stroke;
  // darker reed-green growth close to the water
  float lush = smoothstep(1.6, 0.6, s) * smoothstep(0.42, 0.7, vnoise(xz * 0.35 + 9.0));
  c = mix(c, srgb(vec3(0.36, 0.56, 0.28)) * (0.9 + 0.2 * vnoise(xz * 2.4)), lush * 0.75);
  grassy = 1.0;

  // a sandy little footpath from the near edge down to the jetty
  vec2 pa = JETTY.xy, pb = vec2(9.4, 11.0);
  vec2 ba = pb - pa;
  float h = clamp(dot(xz - pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 bend = vec2(0.6 * sin(h * 3.1416), 0.0);
  float dp = length(xz - pa - ba * h - bend) + (vnoise(xz * 1.7) - 0.5) * 0.16;
  float onPath = 1.0 - smoothstep(0.42, 0.55, dp);
  vec3 dirt = mix(srgb(vec3(0.88, 0.80, 0.60)), srgb(vec3(0.94, 0.89, 0.74)), smoothstep(0.4, 0.0, dp));
  c = mix(c, dirt * (0.95 + 0.08 * vnoise(xz * 9.0)), onPath);
  grassy *= 1.0 - onPath;

  // a sandy shore with a damp darker line right at the water
  float shore = 1.0 - smoothstep(0.18, 0.5, s + (vnoise(xz * 1.4) - 0.5) * 0.25);
  vec3 sand = srgb(vec3(0.87, 0.81, 0.62)) * (0.95 + 0.08 * vnoise(xz * 7.0));
  c = mix(c, sand, shore);
  c = mix(c, srgb(vec3(0.70, 0.66, 0.50)), smoothstep(0.12, 0.0, s) * 0.55);
  grassy *= 1.0 - shore;
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 1.2;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.2;
  float rough = (vnoise(xz * 0.7) - 0.5) * 0.9 + (vnoise(xz * 2.8) - 0.5) * 0.45;
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
  float cover = smoothstep(-0.1, 1.1, edge);
  if (hash12(floor(xz * 16.0)) > cover * 1.08) discard;

  float s = pondSDF(xz);
  vec3 N = normalize(vNormal);
  vec3 col;
  if (s < 0.0) {
    // the pond bed: painted water, lit flat, with only a soft trace of what is above it
    float depth = max(0.0, -vWorld.y);
    vec3 albedo = waterPaint(xz, depth);
    albedo *= 0.96 + 0.07 * vnoise(xz * 22.0);
    float sunVis = mix(1.0, castLight(vWorld, 0.08), 0.35 * (1.0 - smoothstep(0.4, 1.4, depth)));
    col = paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2);
  } else {
    float grassy;
    vec3 albedo = bankPaint(xz, s, grassy);
    // pigment grain: a fine stipple, and the odd pale fleck of dry brush
    albedo *= 0.95 + 0.1 * vnoise(xz * 26.0);
    float fleck = step(0.986, hash12(floor(xz * 11.0))) * grassy;
    albedo = mix(albedo, albedo * 1.25 + srgb(vec3(0.08, 0.07, 0.0)), fleck * 0.8);
    float sunVis = castLight(vWorld, 0.05);
    col = paintLight(albedo, N, sunVis, 1.0, 0.2);
  }
  // where the paint thins at the edge, the paper shows through
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 1.4, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(): THREE.BufferGeometry {
  const step = 0.1;
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
