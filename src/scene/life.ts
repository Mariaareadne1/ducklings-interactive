import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { PROP_SHADOW_LAYER } from './props';
import { FLOWERBED, clampToWater, groundHeight, isOpenWater, pondSDF, WATER_Y } from './park';
import { seededRandom } from './noise';
import type { Ripples } from './water';
import type { WorldUniforms } from './world';

/**
 * Small park life that never competes with the ducks: splash droplets from a
 * plop, petals drifting on the water, a dragonfly zipping between the reeds,
 * and a butterfly that flutters over the flowerbed (a straggling duckling
 * may stop to watch it). Instanced and painted with the same light.
 */

const dabVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const dabFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
uniform float uLit;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 col = uLit > 0.5 ? paintLight(vColor, N, castLight(vWorld, 0.03), 1.0, 0.4) : vColor;
  gl_FragColor = vec4(underwater(col, -vWorld.y), 1.0);
}
`;

function dabMesh(world: WorldUniforms, geo: THREE.BufferGeometry, count: number, lit = true): THREE.InstancedMesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...world, uLit: { value: lit ? 1 : 0 } },
    vertexShader: dabVertex,
    fragmentShader: dabFragment,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

const linear = (hex: string) => new THREE.Color(hex);
const dummy = new THREE.Object3D();

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number }
interface Petal { x: number; z: number; rot: number; spin: number; s: number }

const MAX_DROPS = 120;

export class ParkLife {
  readonly group = new THREE.Group();
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly petalMesh: THREE.InstancedMesh;
  private readonly dragonfly: Dragonfly;
  readonly butterfly: Butterfly;
  private drops: Drop[] = [];
  private readonly petals: Petal[] = [];
  private time = 0;
  private readonly rand = seededRandom(404);

  constructor(private readonly world: WorldUniforms, private readonly ripples: Ripples, density = 1) {
    this.group.name = 'park-life';
    this.dropMesh = dabMesh(world, new THREE.SphereGeometry(0.025, 6, 4), MAX_DROPS, false);
    const petal = new THREE.CircleGeometry(0.09, 10).scale(1, 0.55, 1).rotateX(-Math.PI / 2);
    this.petalMesh = dabMesh(world, petal, 24);
    this.group.add(this.dropMesh, this.petalMesh);
    const tints = ['#f7d9df', '#fbeef0', '#f3c6d1'];
    for (let i = 0; i < Math.round(12 * density); i++) {
      const [x, z] = this.randomWater(0.4);
      this.petals.push({ x, z, rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 0.3, s: 0.7 + this.rand() * 0.5 });
      this.petalMesh.setColorAt(i, linear(tints[i % tints.length]));
    }
    this.petalMesh.count = this.petals.length;
    for (let i = 0; i < MAX_DROPS; i++) this.dropMesh.setColorAt(i, linear('#eef7f7'));
    this.dragonfly = new Dragonfly(world, 1);
    this.butterfly = new Butterfly(world, 5);
    this.group.add(this.dragonfly.group, this.butterfly.group);
  }

  private randomWater(clearance: number): [number, number] {
    for (let i = 0; i < 200; i++) {
      const x = (this.rand() * 2 - 1) * 8;
      const z = (this.rand() * 2 - 1) * 6;
      if (isOpenWater(x, z, clearance)) return [x, z];
    }
    return [3.5, -2.1];
  }

  /** A little splash of droplets (a plop, a shake on the bank). */
  splash(x: number, z: number, strength: number, y = WATER_Y + 0.03): void {
    const n = Math.round(5 + 9 * strength);
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const a = this.rand() * Math.PI * 2;
      const h = 0.3 + this.rand() * 0.6 * strength;
      this.drops.push({ x, y, z, vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy: 0.9 + this.rand() * 1.4 * strength, s: 0.6 + this.rand() * 0.7 });
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const breeze = this.world.uBreeze.value;

    this.drops = this.drops.filter((d) => {
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const floor = pondSDF(d.x, d.z) < 0 ? WATER_Y : groundHeight(d.x, d.z);
      if (d.y < floor) {
        if (pondSDF(d.x, d.z) < 0) this.ripples.add(d.x, d.z, 0.12);
        return false;
      }
      return true;
    });
    this.drops.forEach((d, i) => {
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(d.s, d.s * (1 + Math.min(1.5, Math.abs(d.vy) * 0.25)), d.s);
      dummy.updateMatrix();
      this.dropMesh.setMatrixAt(i, dummy.matrix);
    });
    this.dropMesh.count = this.drops.length;
    this.dropMesh.instanceMatrix.needsUpdate = true;

    this.petals.forEach((p, i) => {
      const flow = 0.05 + breeze * 0.35;
      p.x += (Math.sin(p.z * 0.5 + t * 0.05) * 0.5 + breeze) * flow * dt;
      p.z += Math.cos(p.x * 0.45 - t * 0.04) * 0.5 * flow * dt;
      p.rot += p.spin * dt;
      if (!isOpenWater(p.x, p.z, 0.25)) [p.x, p.z] = clampToWater(p.x, p.z, 0.3);
      dummy.position.set(p.x, WATER_Y + 0.006, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      this.petalMesh.setMatrixAt(i, dummy.matrix);
    });
    this.petalMesh.instanceMatrix.needsUpdate = true;

    this.dragonfly.update(dt, t, breeze);
    this.butterfly.update(dt, t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

function flatMaterial(world: WorldUniforms, rgb: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...world },
    vertexShader: `varying vec3 vWorld; varying vec3 vN; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `${WORLD_UNIFORMS_GLSL}${NOISE_GLSL}${LIGHTING_GLSL} varying vec3 vWorld; varying vec3 vN; void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; gl_FragColor = vec4(paintLight(pow(vec3(${rgb}),vec3(2.2)), N, 1.0, 1.0, 0.4), 1.0); }`,
    side: THREE.DoubleSide,
  });
}

/** A dragonfly: hovers by the reeds, then zips to another spot in a quick curved dash. */
class Dragonfly {
  readonly group = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];
  private readonly rand: () => number;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private leg = 0;
  private legTime = 1;
  private hover = 0;

  constructor(world: WorldUniforms, seed: number) {
    this.rand = seededRandom(seed * 77);
    const bodyMat = flatMaterial(world, '0.22,0.55,0.62');
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.26, 4, 8).rotateZ(Math.PI / 2), bodyMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), bodyMat);
    head.position.x = 0.16;
    body.layers.enable(PROP_SHADOW_LAYER);
    const wingMat = new THREE.MeshBasicMaterial({ color: linear('#eef6f7'), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const wingGeo = new THREE.CircleGeometry(0.12, 12).scale(1, 0.22, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.12);
    for (const [x, s] of [[0.05, 1], [0.05, -1], [-0.03, 1], [-0.03, -1]] as const) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(x, 0.02, 0);
      w.scale.z = s;
      this.wings.push(w);
      this.group.add(w);
    }
    this.group.add(body, head);
    this.pickPoint(this.from);
    this.to.copy(this.from);
    this.group.position.copy(this.from);
  }

  private pickPoint(out: THREE.Vector3): void {
    for (let i = 0; i < 60; i++) {
      const x = (this.rand() * 2 - 1) * 8.5;
      const z = (this.rand() * 2 - 1) * 6.5;
      const s = pondSDF(x, z);
      if (s > -1.2 && s < 0.5) {
        out.set(x, 0.8 + this.rand() * 0.6, z);
        return;
      }
    }
    out.set(0, 1.2, -2);
  }

  update(dt: number, t: number, breeze: number): void {
    for (const [i, w] of this.wings.entries()) w.rotation.x = Math.sin(t * 70 + i * 1.3) * 0.5;
    if (this.hover > 0) {
      this.hover -= dt;
      this.group.position.y = this.to.y + 0.04 * Math.sin(t * 5);
      this.group.position.x = this.to.x + 0.03 * Math.sin(t * 3.1) + breeze * 0.1;
      if (this.hover <= 0) {
        this.from.copy(this.group.position);
        this.pickPoint(this.to);
        this.leg = 0;
        this.legTime = this.from.distanceTo(this.to) / (3.5 + this.rand() * 2);
      }
      return;
    }
    this.leg += dt / this.legTime;
    const u = Math.min(1, this.leg);
    const e = u * u * (3 - 2 * u);
    const side = Math.sin(u * Math.PI) * 0.8;
    const dx = this.to.x - this.from.x;
    const dz = this.to.z - this.from.z;
    this.group.position.set(this.from.x + dx * e - dz * 0.12 * side, this.from.y + (this.to.y - this.from.y) * e + 0.2 * side, this.from.z + dz * e + dx * 0.12 * side);
    this.group.rotation.y = Math.atan2(-dz, dx);
    if (u >= 1) this.hover = 1.5 + this.rand() * 3.5;
  }
}

/** A small butter-yellow butterfly that bobs about over the flowerbed and the lawn near it. */
export class Butterfly {
  readonly group = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];
  private readonly seed: number;

  constructor(world: WorldUniforms, seed: number) {
    this.seed = seed;
    const wingMat = flatMaterial(world, '0.99,0.88,0.55');
    const wingGeo = new THREE.CircleGeometry(0.05, 10).scale(0.8, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.045);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.scale.z = s;
      this.wings.push(w);
      this.group.add(w);
    }
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.05, 3, 6).rotateZ(Math.PI / 2), flatMaterial(world, '0.35,0.3,0.28'));
    this.group.add(body);
  }

  update(_dt: number, t: number): void {
    const k = this.seed;
    // a lazy figure-of-eight around the flowerbed, wandering a little wider now and then
    const a = t * 0.32 + k;
    const wide = 1 + 0.6 * Math.max(0, Math.sin(t * 0.07 + k));
    const x = FLOWERBED.x + Math.sin(a) * FLOWERBED.rx * 1.2 * wide + 0.3 * Math.sin(t * 1.7);
    const z = FLOWERBED.z + Math.sin(a * 2) * FLOWERBED.rz * 0.9 * wide + 0.2 * Math.sin(t * 2.3 + 1);
    const y = groundHeight(x, z) + 0.35 + 0.12 * Math.sin(t * 3.1) + 0.06 * Math.sin(t * 7.3);
    const p = this.group.position;
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.hypot(dx, dz) > 1e-4) this.group.rotation.y = Math.atan2(-dz, dx);
    p.set(x, y, z);
    const flap = Math.sin(t * 22) * 0.9;
    this.wings[0].rotation.x = flap;
    this.wings[1].rotation.x = -flap;
  }
}
