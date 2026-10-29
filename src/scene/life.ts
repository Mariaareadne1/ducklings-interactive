import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { PROP_SHADOW_LAYER } from './props';
import { clampToWater, isWater, pondSDF, TILE, WATER_Y } from './pondShape';
import { seededRandom } from './noise';
import type { Ripples } from './water';
import type { WorldUniforms } from './world';

/**
 * Small pond life and the things pond-wide actions scatter: crumbs that
 * float and dissolve, splash droplets, petals drifting on the surface, a
 * dragonfly zipping between the reeds, pond skaters dimpling the water, the
 * fly a frog catches, and a soft shower of rain. All instanced and painted
 * with the same light as everything else.
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
uniform float uAlpha;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 col = uLit > 0.5 ? paintLight(vColor, N, castLight(vWorld, 0.03), 1.0, 0.4) : vColor;
  gl_FragColor = vec4(underwater(col, -vWorld.y), uAlpha);
}
`;

function dabMesh(world: WorldUniforms, geo: THREE.BufferGeometry, count: number, lit = true): THREE.InstancedMesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...world, uLit: { value: lit ? 1 : 0 }, uAlpha: { value: 1 } },
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

interface Crumb { id: number; x: number; z: number; t: number; eaten: number }
interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number }
interface Petal { x: number; z: number; rot: number; spin: number; s: number; tint: number }
interface Skater { x: number; z: number; heading: number; next: number; vx: number; vz: number }

const CRUMB_LIFE = 14;
const MAX_CRUMBS = 48;
const MAX_DROPS = 120;
const RAIN_STREAKS = 260;

export class PondLife {
  readonly group = new THREE.Group();
  private readonly crumbMesh: THREE.InstancedMesh;
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly petalMesh: THREE.InstancedMesh;
  private readonly skaterMesh: THREE.InstancedMesh;
  private readonly flyMesh: THREE.InstancedMesh;
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly dragonflies: Dragonfly[] = [];
  private crumbList: Crumb[] = [];
  private drops: Drop[] = [];
  private readonly petals: Petal[] = [];
  private readonly skaters: Skater[] = [];
  private flies: { x: number; z: number; y: number; t: number; until: number; seed: number }[] = [];
  private nextCrumb = 1;
  private time = 0;
  private readonly rand = seededRandom(404);
  /** Seconds of rain left. */
  rain = 0;

  constructor(private readonly world: WorldUniforms, private readonly ripples: Ripples, density = 1) {
    this.group.name = 'pond-life';
    this.crumbMesh = dabMesh(world, new THREE.SphereGeometry(0.06, 8, 5).scale(1, 0.45, 1), MAX_CRUMBS);
    this.dropMesh = dabMesh(world, new THREE.SphereGeometry(0.045, 6, 4), MAX_DROPS, false);
    const petal = new THREE.CircleGeometry(0.15, 10).scale(1, 0.55, 1).rotateX(-Math.PI / 2);
    this.petalMesh = dabMesh(world, petal, 40);
    this.skaterMesh = dabMesh(world, new THREE.CircleGeometry(0.05, 8).scale(1.6, 0.8, 1).rotateX(-Math.PI / 2), 12);
    this.flyMesh = dabMesh(world, new THREE.SphereGeometry(0.035, 6, 4), 6, false);
    this.rainMesh = dabMesh(world, new THREE.PlaneGeometry(0.012, 0.42), RAIN_STREAKS, false);
    const rainMat = this.rainMesh.material as THREE.ShaderMaterial;
    rainMat.transparent = true;
    rainMat.depthWrite = false;
    rainMat.uniforms.uAlpha.value = 0.4;
    this.rainMesh.renderOrder = 6;
    this.group.add(this.crumbMesh, this.dropMesh, this.petalMesh, this.skaterMesh, this.flyMesh, this.rainMesh);

    const petalTints = ['#f7d9df', '#fbeef0', '#f3c6d1'];
    for (let i = 0; i < Math.round(10 * density); i++) {
      const [x, z] = this.randomWater(0.5);
      this.petals.push({ x, z, rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 0.3, s: 0.7 + this.rand() * 0.5, tint: i % petalTints.length });
      this.petalMesh.setColorAt(i, linear(petalTints[i % petalTints.length]));
    }
    this.petalMesh.count = this.petals.length;
    for (let i = 0; i < 6; i++) {
      const [x, z] = this.randomWater(0.3, 1.6);
      this.skaters.push({ x, z, heading: this.rand() * 6.28, next: this.rand() * 2, vx: 0, vz: 0 });
      this.skaterMesh.setColorAt(i, linear('#3d3a36'));
    }
    this.skaterMesh.count = this.skaters.length;
    for (let i = 0; i < MAX_CRUMBS; i++) this.crumbMesh.setColorAt(i, linear(i % 3 ? '#e2c48c' : '#d4ad72'));
    for (let i = 0; i < MAX_DROPS; i++) this.dropMesh.setColorAt(i, linear('#e9f4f4'));
    for (let i = 0; i < 6; i++) this.flyMesh.setColorAt(i, linear('#2e2b2a'));
    for (let i = 0; i < RAIN_STREAKS; i++) this.rainMesh.setColorAt(i, linear('#dfeaf0'));
    for (const seed of [1, 2]) {
      const d = new Dragonfly(world, seed);
      this.dragonflies.push(d);
      this.group.add(d.group);
    }
  }

  /** A random point on open water (optionally near the shore). */
  private randomWater(clearance: number, nearShore = 99): [number, number] {
    for (let i = 0; i < 200; i++) {
      const x = (this.rand() * 2 - 1) * 10;
      const z = (this.rand() * 2 - 1) * 7;
      if (isWater(x, z, clearance) && pondSDF(x, z) > -nearShore) return [x, z];
    }
    return [0.6, -0.3];
  }

  // --- crumbs ------------------------------------------------------------------

  sprinkle(x: number, z: number): number {
    let added = 0;
    for (let i = 0; i < 9 && this.crumbList.length < MAX_CRUMBS; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * 0.9;
      const cx = x + Math.cos(a) * r;
      const cz = z + Math.sin(a) * r;
      if (!isWater(cx, cz, 0.15)) continue;
      this.crumbList.push({ id: this.nextCrumb++, x: cx, z: cz, t: 0, eaten: -1 });
      if (i % 3 === 0) this.ripples.add(cx, cz, 0.35);
      added++;
    }
    return added;
  }

  crumbs(): { id: number; x: number; z: number }[] {
    return this.crumbList.filter((c) => c.eaten < 0);
  }

  eatCrumb(id: number): void {
    const c = this.crumbList.find((k) => k.id === id);
    if (c && c.eaten < 0) c.eaten = 0;
  }

  clearCrumbs(): void {
    this.crumbList = [];
  }

  // --- splashes ----------------------------------------------------------------

  splash(x: number, z: number, strength: number): void {
    const n = Math.round(6 + 10 * strength);
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const a = this.rand() * Math.PI * 2;
      const h = 0.6 + this.rand() * 1.0 * strength;
      this.drops.push({ x, y: WATER_Y + 0.05, z, vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy: 1.6 + this.rand() * 2.2 * strength, s: 0.6 + this.rand() * 0.7 });
    }
  }

  // --- the frog's fly ------------------------------------------------------------

  /** A fly circling above (x, y, z) until `until` seconds from now. */
  showFly(x: number, y: number, z: number, until: number): void {
    this.flies.push({ x, y, z, t: 0, until, seed: this.rand() * 10 });
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const breeze = this.world.uBreeze.value;

    // crumbs bob, swell a little as they soak, and dissolve
    this.crumbList = this.crumbList.filter((c) => {
      c.t += dt;
      if (c.eaten >= 0) c.eaten += dt;
      c.x += breeze * 0.08 * dt;
      return c.t < CRUMB_LIFE && c.eaten < 0.25;
    });
    this.crumbList.forEach((c, i) => {
      const fade = Math.min(1, (CRUMB_LIFE - c.t) / 2.5) * (c.eaten >= 0 ? 1 - c.eaten / 0.25 : 1) * Math.min(1, c.t * 6);
      dummy.position.set(c.x, WATER_Y + 0.015 + 0.01 * Math.sin(t * 2 + c.id), c.z);
      dummy.rotation.set(0, c.id, 0);
      dummy.scale.setScalar(Math.max(0.001, fade * (1 + 0.15 * Math.min(1, c.t / 6))));
      dummy.updateMatrix();
      this.crumbMesh.setMatrixAt(i, dummy.matrix);
    });
    this.crumbMesh.count = this.crumbList.length;
    this.crumbMesh.instanceMatrix.needsUpdate = true;

    // droplets fly and fall back, each leaving a tiny ring
    this.drops = this.drops.filter((d) => {
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < WATER_Y) {
        if (isWater(d.x, d.z, 0)) this.ripples.add(d.x, d.z, 0.18);
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

    // petals drift on a slow swirl, faster in a breeze
    this.petals.forEach((p, i) => {
      const flow = 0.05 + breeze * 0.35;
      p.x += (Math.sin(p.z * 0.4 + t * 0.05) * 0.5 + breeze) * flow * dt;
      p.z += Math.cos(p.x * 0.35 - t * 0.04) * 0.5 * flow * dt;
      p.rot += p.spin * dt * (1 + breeze * 3);
      if (!isWater(p.x, p.z, 0.3)) [p.x, p.z] = breeze > 0.2 ? this.randomWater(0.6) : clampToWater(p.x, p.z, 0.35);
      dummy.position.set(p.x, WATER_Y + 0.008, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      this.petalMesh.setMatrixAt(i, dummy.matrix);
    });
    this.petalMesh.instanceMatrix.needsUpdate = true;

    // pond skaters: a sudden glide, a pause, a dimple at each push
    this.skaters.forEach((s, i) => {
      s.next -= dt;
      if (s.next <= 0) {
        s.heading += (this.rand() - 0.5) * 2.4;
        const v = 0.8 + this.rand() * 0.9;
        s.vx = Math.cos(s.heading) * v;
        s.vz = -Math.sin(s.heading) * v;
        s.next = 0.7 + this.rand() * 2.2;
        this.ripples.add(s.x, s.z, 0.12);
      }
      s.vx *= 1 - Math.min(1, dt * 3.2);
      s.vz *= 1 - Math.min(1, dt * 3.2);
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      if (!isWater(s.x, s.z, 0.25) || pondSDF(s.x, s.z) < -2.5) {
        s.heading += Math.PI;
        [s.x, s.z] = clampToWater(s.x, s.z, 0.3);
      }
      dummy.position.set(s.x, WATER_Y + 0.01, s.z);
      dummy.rotation.set(0, s.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.skaterMesh.setMatrixAt(i, dummy.matrix);
    });
    this.skaterMesh.instanceMatrix.needsUpdate = true;

    // the fly: a quick, loopy orbit, gone when it's caught
    this.flies = this.flies.filter((f) => (f.t += dt) < f.until);
    this.flies.forEach((f, i) => {
      const a = f.t * 6.5 + f.seed;
      const r = 0.38 + 0.12 * Math.sin(f.t * 3.1);
      dummy.position.set(f.x + Math.cos(a) * r, f.y + 0.55 + 0.15 * Math.sin(f.t * 5.3), f.z + Math.sin(a) * r * 0.8);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1 + 0.3 * Math.sin(f.t * 60));
      dummy.updateMatrix();
      this.flyMesh.setMatrixAt(i, dummy.matrix);
    });
    this.flyMesh.count = this.flies.length;
    this.flyMesh.instanceMatrix.needsUpdate = true;

    this.updateRain(dt);
    for (const d of this.dragonflies) d.update(dt, t, breeze);
  }

  private updateRain(dt: number): void {
    this.rain = Math.max(0, this.rain - dt);
    const strength = Math.min(1, this.rain / 1.5, (10 - Math.min(10, this.rain)) * 2 + 0.0001);
    const n = Math.round(RAIN_STREAKS * strength);
    for (let i = 0; i < n; i++) {
      // each streak falls on its own loop through a column above the tile
      const h = (i * 0.6180339) % 1;
      const k = (i * 0.7548776) % 1;
      const fall = ((this.time * 1.6 + h * 7.3) % 1);
      const x = (h * 2 - 1) * (TILE.halfX - 1);
      const z = (k * 2 - 1) * (TILE.halfZ - 1);
      dummy.position.set(x + 0.6 * fall, 5 * (1 - fall), z);
      dummy.rotation.set(0, 0, 0.12);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.rainMesh.setMatrixAt(i, dummy.matrix);
    }
    this.rainMesh.count = n;
    this.rainMesh.instanceMatrix.needsUpdate = true;
    // drops land as rings across the water
    const rate = 14 * strength;
    let spawn = rate * dt;
    while (spawn > 0) {
      if (this.rand() < spawn) {
        const [x, z] = this.randomWater(0.1);
        this.ripples.add(x, z, 0.22 + this.rand() * 0.2);
      }
      spawn -= 1;
    }
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

/**
 * A dragonfly: a slim teal body and four glassy wings, hovering by a reed
 * clump, then zipping to another in a quick, slightly curved dash.
 */
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
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: { ...world },
      vertexShader: `varying vec3 vWorld; varying vec3 vN; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `${WORLD_UNIFORMS_GLSL}${NOISE_GLSL}${LIGHTING_GLSL} varying vec3 vWorld; varying vec3 vN; void main(){ gl_FragColor = vec4(paintLight(pow(vec3(0.22,0.55,0.62),vec3(2.2)), normalize(vN), 1.0, 1.0, 0.3), 1.0); }`,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.42, 4, 8).rotateZ(Math.PI / 2), bodyMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bodyMat);
    head.position.x = 0.25;
    body.layers.enable(PROP_SHADOW_LAYER);
    const wingMat = new THREE.MeshBasicMaterial({ color: linear('#eef6f7'), transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const wingGeo = new THREE.CircleGeometry(0.2, 12).scale(1, 0.22, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.2);
    for (const [x, s] of [[0.08, 1], [0.08, -1], [-0.04, 1], [-0.04, -1]] as const) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(x, 0.03, 0);
      w.scale.z = s;
      w.layers.enable(PROP_SHADOW_LAYER);
      this.wings.push(w);
      this.group.add(w);
    }
    this.group.add(body, head);
    this.group.scale.setScalar(1.05);
    this.pickPoint(this.from);
    this.to.copy(this.from);
    this.group.position.copy(this.from);
  }

  private pickPoint(out: THREE.Vector3): void {
    for (let i = 0; i < 60; i++) {
      const x = (this.rand() * 2 - 1) * 11;
      const z = (this.rand() * 2 - 1) * 8;
      const s = pondSDF(x, z);
      if (s > -1.4 && s < 0.8) {
        out.set(x, 1.2 + this.rand() * 0.8, z);
        return;
      }
    }
    out.set(0, 1.5, 0);
  }

  update(dt: number, t: number, breeze: number): void {
    for (const [i, w] of this.wings.entries()) w.rotation.x = Math.sin(t * 70 + i * 1.3) * 0.5;
    if (this.hover > 0) {
      this.hover -= dt;
      this.group.position.y = this.to.y + 0.06 * Math.sin(t * 5);
      this.group.position.x = this.to.x + 0.04 * Math.sin(t * 3.1) + breeze * 0.1;
      if (this.hover <= 0) {
        this.from.copy(this.group.position);
        this.pickPoint(this.to);
        this.leg = 0;
        this.legTime = this.from.distanceTo(this.to) / (5 + this.rand() * 3);
      }
      return;
    }
    this.leg += dt / this.legTime;
    const u = Math.min(1, this.leg);
    const e = u * u * (3 - 2 * u);
    const side = Math.sin(u * Math.PI) * 0.8;
    const dx = this.to.x - this.from.x;
    const dz = this.to.z - this.from.z;
    this.group.position.set(this.from.x + dx * e - dz * 0.12 * side, this.from.y + (this.to.y - this.from.y) * e + 0.3 * side, this.from.z + dz * e + dx * 0.12 * side);
    this.group.rotation.y = Math.atan2(-dz, dx);
    if (u >= 1) this.hover = 1.5 + this.rand() * 3.5;
  }
}
