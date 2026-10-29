import * as THREE from 'three';

/**
 * A peep, drawn rather than heard: a tiny cream speech-tick — three short
 * strokes fanning out from beside the duck's head — that pops in, holds a
 * moment and fades. Billboards in the scene (so recordings keep them),
 * pooled.
 */

const MAX = 24;
const LIFE = 0.95;

const vertex = /* glsl */ `
attribute vec4 aSpawn; // xyz, start time
attribute vec2 aSide;  // side (-1 / 1), scale
uniform float uTime;
varying vec2 vUv;
varying float vAge;
void main() {
  float age = (uTime - aSpawn.w) / ${LIFE.toFixed(2)};
  vAge = age;
  float pop = age < 0.0 || age > 1.0 ? 0.0 : (1.0 + 0.35 * sin(min(age * 7.0, 3.1416))) * smoothstep(0.0, 0.08, age);
  vec4 centre = viewMatrix * vec4(aSpawn.xyz, 1.0);
  vec2 corner = position.xy * vec2(aSide.x, 1.0);
  centre.xy += corner * aSide.y * pop + vec2(aSide.x * 0.06, 0.04 + age * 0.05) * aSide.y;
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * centre;
}
`;

const fragment = /* glsl */ `
varying vec2 vUv;
varying float vAge;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  vec2 p = vUv;
  // three short strokes fanning out from the lower-left corner (the head is there)
  float d = min(seg(p, vec2(0.18, 0.62), vec2(0.42, 0.9)), seg(p, vec2(0.3, 0.45), vec2(0.72, 0.62)));
  d = min(d, seg(p, vec2(0.3, 0.26), vec2(0.66, 0.2)));
  float line = smoothstep(0.075, 0.055, d);
  float edge = smoothstep(0.115, 0.09, d);
  float fade = 1.0 - smoothstep(0.65, 1.0, vAge);
  if (edge * fade < 0.02) discard;
  vec3 cream = pow(vec3(0.99, 0.96, 0.86), vec3(2.2));
  vec3 ink = pow(vec3(0.42, 0.34, 0.26), vec3(2.2));
  gl_FragColor = vec4(mix(ink, cream, line / max(edge, 1e-3)), edge * fade);
}
`;

export class Peeps {
  readonly mesh: THREE.Mesh;
  private readonly spawn: THREE.InstancedBufferAttribute;
  private readonly side: THREE.InstancedBufferAttribute;
  private next = 0;

  constructor(private readonly time: THREE.IUniform<number>) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setIndex(quad.getIndex());
    this.spawn = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4).fill(-100), 4);
    this.side = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2).fill(1), 2);
    geo.setAttribute('aSpawn', this.spawn);
    geo.setAttribute('aSide', this.side);
    geo.instanceCount = MAX;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'peeps';
  }

  /** A peep beside a head at (x, y, z); size in metres; side −1/1 (which side of the head). */
  add(x: number, y: number, z: number, size: number, side = 1): void {
    const i = this.next;
    this.next = (i + 1) % MAX;
    this.spawn.setXYZW(i, x, y, z, this.time.value);
    this.side.setXY(i, side, size);
    this.spawn.needsUpdate = true;
    this.side.needsUpdate = true;
  }

  /** How many peeps are showing (tests). */
  live(): number {
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const age = this.time.value - this.spawn.getW(i);
      if (age >= 0 && age <= LIFE) n++;
    }
    return n;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
