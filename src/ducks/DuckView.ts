import * as THREE from 'three';
import { createDuckUniforms, createPartMaterial, PART, shellGeometry, type DuckUniforms } from './materials';
import { PROP_SHADOW_LAYER } from '../scene/props';
import type { DuckGeometries } from './geometry/shapes';
import type { WorldUniforms } from '../scene/world';
import type { Pose } from './gait';

/** How far through the reveal before the shadow arrives (MEADOW's threshold). */
export const SHADOW_AT = 0.6;

/** World metres per local unit. */
export const MOTHER_SCALE = 1.2;
export const DUCKLING_SCALE = 1.45;

interface Rig {
  bodyPivot: [number, number, number];
  neck: [number, number, number];
  head: [number, number, number];
  bill: [number, number, number];
  eye: [number, number, number];
  wing: [number, number, number];
  leg: [number, number, number];
  foot: [number, number, number];
  /** How high the body rides above the ground when standing (local units). */
  landLift: number;
  proxy: { scale: [number, number, number]; position: [number, number, number] };
  parts: { body: number; head: number; bill: number; wing: number; eye: number; foot: number };
  /** Side-to-side spacing of the eyes. */
  eyeScaleZ: number;
}

const MOTHER_RIG: Rig = {
  bodyPivot: [0, 0.05, 0],
  neck: [0.24, 0.13, 0],
  head: [0.05, 0.22, 0],
  bill: [0.1, -0.02, 0],
  eye: [0.06, 0.03, 0.091],
  wing: [0.12, 0.168, 0.13],
  leg: [0.02, -0.08, 0.075],
  foot: [0.02, -0.13, 0.09],
  landLift: 0.135,
  proxy: { scale: [0.48, 0.38, 0.34], position: [0.02, 0.18, 0] },
  parts: { body: PART.motherBody, head: PART.motherHead, bill: PART.motherBill, wing: PART.motherWing, eye: PART.motherEye, foot: PART.motherFoot },
  eyeScaleZ: 0.55,
};

const DUCKLING_RIG: Rig = {
  bodyPivot: [0, 0.04, 0],
  neck: [0.072, 0.135, 0],
  head: [0.014, 0.05, 0],
  bill: [0.072, -0.014, 0],
  eye: [0.052, 0.022, 0.068],
  wing: [0.03, 0.085, 0.102],
  leg: [0.005, -0.07, 0.04],
  foot: [0.005, -0.097, 0.045],
  landLift: 0.098,
  proxy: { scale: [0.2, 0.2, 0.17], position: [0, 0.08, 0] },
  parts: { body: PART.ducklingBody, head: PART.ducklingHead, bill: PART.ducklingBill, wing: PART.ducklingWing, eye: PART.ducklingEye, foot: PART.ducklingFoot },
  eyeScaleZ: 0.9,
};

/**
 * A duck's 3D view: a root placed at its position and heading, painted parts
 * on one set of uniforms, an invisible proxy for picking, the reveal (which
 * also gates the shadow) and the selection highlight. `apply` poses it.
 */
export class DuckView {
  readonly root = new THREE.Group();
  readonly uniforms: DuckUniforms;
  readonly proxy: THREE.Mesh;
  private readonly body = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly bill: THREE.Mesh;
  private readonly wings: THREE.Group[] = [];
  private readonly legs: THREE.Mesh[] = [];
  private readonly feet: THREE.Mesh[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly casters = new Set<THREE.Mesh>();
  private readonly rig: Rig;
  private casting = true;
  /** World metres per local unit. */
  readonly scale: number;
  formation = 1;

  constructor(readonly id: string, readonly kind: 'mother' | 'duckling', seed: number, size: number, geo: DuckGeometries, private readonly world: WorldUniforms, options: { tuft?: boolean; cap?: number; warmth?: number } = {}) {
    this.rig = kind === 'mother' ? MOTHER_RIG : DUCKLING_RIG;
    this.scale = (kind === 'mother' ? MOTHER_SCALE : DUCKLING_SCALE) * size;
    this.uniforms = createDuckUniforms(seed);
    this.uniforms.uLook.value.set(options.cap ?? 0, options.warmth ?? 0, 0, 1);
    this.uniforms.uFur.value = kind === 'mother' ? 0 : 0.0075;
    const noShells = location.search.includes('noshell');
    this.root.name = `${kind}-${id}`;
    this.root.scale.setScalar(this.scale);
    const r = this.rig;
    const fluffy = kind === 'duckling';

    this.root.add(this.body);
    this.body.position.set(...r.bodyPivot);
    this.inner.position.set(-r.bodyPivot[0], -r.bodyPivot[1], -r.bodyPivot[2]);
    this.body.add(this.inner);
    this.part(this.inner, geo.body, r.parts.body, { shell: fluffy && !noShells });

    this.neck.position.set(...r.neck);
    this.neck.rotation.order = 'YZX';
    this.inner.add(this.neck);
    this.head.position.set(...r.head);
    this.head.rotation.order = 'YZX';
    this.neck.add(this.head);
    this.part(this.head, geo.head, r.parts.head, { shell: fluffy && !noShells });
    this.bill = this.part(this.head, geo.bill, r.parts.bill);
    this.bill.position.set(...r.bill);
    this.bill.rotation.z = -0.1;
    if (options.tuft && geo.tuft) {
      const tuft = this.part(this.head, geo.tuft, PART.ducklingTuft, { castShadow: false });
      tuft.position.set(-0.012, 0.074, 0);
      tuft.rotation.set(0.2 * Math.sin(seed), 0, 0.25);
    }
    for (const s of [-1, 1]) {
      const eye = this.part(this.head, geo.eye, r.parts.eye, { castShadow: false });
      eye.position.set(r.eye[0], r.eye[1], r.eye[2] * s);
      eye.scale.set(1, 1, r.eyeScaleZ);
      this.eyes.push(eye);
    }
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(r.wing[0], r.wing[1], r.wing[2] * s);
      wing.rotation.order = 'YXZ';
      const m = this.part(wing, geo.wing, r.parts.wing);
      m.scale.z = s;
      this.inner.add(wing);
      this.wings.push(wing);
    }
    for (const s of [-1, 1]) {
      const leg = this.part(this.inner, geo.leg, r.parts.foot, { castShadow: false });
      leg.position.set(r.leg[0], r.leg[1], r.leg[2] * s);
      this.legs.push(leg);
      const foot = this.part(this.inner, geo.foot, r.parts.foot, { doubleSided: true, castShadow: false });
      foot.position.set(r.foot[0], r.foot[1], r.foot[2] * s);
      this.feet.push(foot);
    }

    this.proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.userData.duckId = id;
    this.proxy.scale.set(...r.proxy.scale);
    this.proxy.position.set(...r.proxy.position);
    this.root.add(this.proxy);
  }

  private part(parent: THREE.Object3D, geo: THREE.BufferGeometry, part: number, options: { doubleSided?: boolean; castShadow?: boolean; shell?: boolean } = {}): THREE.Mesh {
    const material = createPartMaterial(this.world, this.uniforms, part, { doubleSided: options.doubleSided });
    const mesh = new THREE.Mesh(geo, material);
    this.materials.push(material);
    if (options.castShadow !== false) {
      mesh.layers.enable(PROP_SHADOW_LAYER);
      this.casters.add(mesh);
    }
    parent.add(mesh);
    if (options.shell) {
      const shellMat = createPartMaterial(this.world, this.uniforms, part, { shell: true });
      this.materials.push(shellMat);
      const shells = new THREE.Mesh(shellGeometry(geo), shellMat);
      shells.renderOrder = 1;
      parent.add(shells);
    }
    return mesh;
  }

  /** How high the body rides above the ground when standing, in metres. */
  get landLift(): number {
    return this.rig.landLift * this.scale;
  }

  /**
   * Place and pose the duck. `y` is the surface it stands on (ground, deck
   * or water); swimming lowers the body to the waterline.
   */
  apply(x: number, y: number, z: number, heading: number, p: Pose): void {
    const r = this.rig;
    const stand = r.landLift * (1 - p.swim) * (1 - 0.85 * p.sit);
    this.root.position.set(x, y + (stand + p.bob + p.lift) * this.scale, z);
    this.root.rotation.set(0, heading, 0);
    this.body.rotation.set(p.roll, 0, p.pitch, 'YZX');
    const sq = p.squash;
    this.body.scale.set(1 - sq * 0.35 + p.fluff * 0.06, 1 - sq + p.fluff * 0.08, 1 + sq * 0.45 + p.fluff * 0.1);
    this.uniforms.uFluff.value = p.fluff;
    this.neck.rotation.set(0, p.headYaw * 0.4, p.neck);
    this.head.rotation.set(p.headRoll, p.headYaw * 0.6, p.headPitch);
    this.bill.rotation.z = -0.1 + p.bill * 0.25;
    this.bill.scale.y = 1 + p.bill * 0.5;
    // wings lie folded (painted on mum, nubs on ducklings); the meshes open out for balance, shakes and waves
    const open = Math.max(p.spread, Math.abs(p.wingL), Math.abs(p.wingR));
    const [wl, wr] = this.wings;
    wl.rotation.set(-(0.5 + p.spread * 1.0 + p.wingL), -p.spread * 0.3, 0.06);
    wr.rotation.set(0.5 + p.spread * 1.0 + p.wingR, p.spread * 0.3, 0.06);
    const showWings = this.kind === 'duckling' || open > 0.06;
    wl.visible = wr.visible = showWings;
    const lid = 1 - 0.92 * Math.min(1, p.blink);
    for (const e of this.eyes) e.scale.set(1, lid, r.eyeScaleZ);
    // legs: swing with the stride, lift the swinging foot; folded under when sitting
    const legsShown = p.sit < 0.6;
    const footY = r.foot[1];
    for (const [i, s] of [[0, p.footL], [1, p.footR]] as const) {
      const step = i === 0 ? p.stepL : p.stepR;
      const leg = this.legs[i];
      const foot = this.feet[i];
      leg.visible = foot.visible = legsShown;
      leg.rotation.z = s * 0.5;
      leg.position.x = r.leg[0] + s * 0.25 * Math.abs(footY - r.leg[1]);
      foot.position.x = r.foot[0] + s * 0.5 * Math.abs(footY - r.leg[1]);
      foot.position.y = footY + step * 0.35 * Math.abs(footY - r.leg[1]) + p.swim * 0.02;
      foot.rotation.set(0, (i === 0 ? 1 : -1) * 0.2, -step * 0.5 + p.swim * s * 0.5);
    }
  }

  /** 0..1 — how much of the duck is painted in; brush strokes sweep tail to bill. */
  setFormation(progress: number, origin?: THREE.Vector3, radius?: number): void {
    this.formation = progress;
    this.uniforms.uReveal.value = progress;
    if (origin) this.uniforms.uRevealOrigin.value.copy(origin);
    if (radius) this.uniforms.uRevealRadius.value = radius;
    const h = this.root.rotation.y;
    this.uniforms.uRevealDir.value.set(Math.cos(h), 0, -Math.sin(h));
    this.setCasting(progress > SHADOW_AT && this.uniforms.uLook.value.w > 0.5);
  }

  /** 0..1 — leaving: the duck thins out and its shadow goes with it. */
  setFade(v: number): void {
    this.uniforms.uLook.value.w = v;
    this.setCasting(this.formation > SHADOW_AT && v > 0.5);
  }

  setWet(v: number): void {
    this.uniforms.uLook.value.z = v;
  }

  private setCasting(casting: boolean): void {
    if (casting === this.casting) return;
    this.casting = casting;
    for (const m of this.casters) {
      if (casting) m.layers.enable(PROP_SHADOW_LAYER);
      else m.layers.disable(PROP_SHADOW_LAYER);
    }
  }

  get isCastingShadow(): boolean {
    return this.casting;
  }

  setHighlight(v: number): void {
    this.uniforms.uHighlight.value = v;
  }

  /** World position of the head (for peeps and the selection label). */
  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.head.matrixWorld);
  }

  /** World-space bounds of the painted parts (for the selection box and tests). */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    target.makeEmpty();
    for (const mesh of this.casters) {
      let o: THREE.Object3D | null = mesh;
      let shown = true;
      while (o && shown) {
        shown = o.visible;
        o = o.parent;
      }
      if (!shown) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      target.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
    return target;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.proxy.geometry.dispose();
    (this.proxy.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
