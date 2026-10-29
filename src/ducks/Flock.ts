import * as THREE from 'three';
import { DuckView } from './DuckView';
import { Mother } from './Mother';
import { Duckling, HUDDLE_DELAY, type LineContext } from './Duckling';
import { Trail, spacingScale } from './trail';
import { Peeps } from './peeps';
import { loadShapes, type ShapeSet } from './geometry/cache';
import { groundKind, nearestFree, WALK_SPEED, type NavPoint } from './nav';
import { inWater, type BodyEvents } from './body';
import { edgeDistance, TILE } from '../scene/park';
import type { DucklingRecord, DucksDoc } from '../state/document';
import type { WorldUniforms } from '../scene/world';
import type { Ripples } from '../scene/water';
import type { ParkLife } from '../scene/life';

/**
 * The family: mother duck, her ducklings in drawing order, and the trail she
 * leaves. Each frame mum moves, drops a breadcrumb, and every duckling is
 * given its place in line, the duckling in front and the huddle spot it
 * would go to if she rests. It also turns the ducks' moments into paint —
 * rings and droplets at a plop, V-wakes when paddling, peeps — and keeps the
 * 3D views in step with the document.
 */

export interface FormationRequest {
  origin: THREE.Vector3;
  radius: number;
  duration: number;
}

interface Live {
  record: DucklingRecord;
  duck: Duckling;
  view: DuckView | null;
  formation: (FormationRequest & { t: number }) | null;
  /** Fading out after an undo (not a goodbye walk). */
  vanish: number;
}

const MOTHER_ID = 'mother';
export { MOTHER_ID };

export class Flock {
  readonly group = new THREE.Group();
  readonly mother: Mother;
  motherView: DuckView | null = null;
  readonly trail: Trail;
  readonly peeps: Peeps;
  private leaderS = 0;
  private readonly live = new Map<string, Live>();
  private order: string[] = [];
  private shapes: ShapeSet | null = null;
  private readonly pending = new Map<string, FormationRequest>();
  private time = 0;
  private wasStill = true;
  private huddled = false;
  private slots: NavPoint[] = [];
  private slotTimer = 0;
  private straggleTimer = 14;
  private peepQueue: { id: string; at: number }[] = [];
  private appliedMother: DucksDoc['mother'] | null = null;
  private doc: DucksDoc | null = null;
  private settleTimer = 0;
  onReady: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** Mum came to rest somewhere new (so the app can save it). */
  onMotherSettled: ((x: number, z: number, heading: number) => void) | null = null;
  /** A duckling finished its goodbye. */
  onGone: ((id: string) => void) | null = null;

  constructor(private readonly world: WorldUniforms, private readonly ripples: Ripples, private readonly life: ParkLife, private readonly reducedMotion: boolean) {
    this.group.name = 'ducks';
    this.mother = new Mother(0, 0, 0, this.events(MOTHER_ID, 1.0), reducedMotion);
    this.trail = new Trail(0, 0);
    this.peeps = new Peeps(world.uTime);
    this.group.add(this.peeps.mesh);
  }

  /** Splashes, rings and wakes for one duck. `size` is roughly its length in metres. */
  private events(id: string, size: number): BodyEvents {
    return {
      onWater: (x, z, entering) => {
        this.ripples.add(x, z, entering ? 0.8 * (size / 0.42) ** 0.5 : 0.5);
        if (entering) this.life.splash(x, z, Math.min(1, size * 1.6));
        else this.later(() => this.life.splash(x, z, 0.35), 0.4);
      },
      onPaddle: (x, z, side) => {
        const b = id === MOTHER_ID ? this.mother.body : this.live.get(id)?.duck.body;
        if (!b) return;
        // rings shed off alternate sides of the tail make the V
        const h = b.heading;
        const back = size * 0.45;
        const sx = Math.sin(h) * size * 0.18 * side, sz = Math.cos(h) * size * 0.18 * side;
        this.ripples.add(x - Math.cos(h) * back + sx, z + Math.sin(h) * back + sz, 0.22 + 0.35 * Math.min(1, b.speed / 0.7) * (size / 0.42));
      },
      onMove: (move) => {
        if (move !== 'peep') return;
        const view = id === MOTHER_ID ? this.motherView : this.live.get(id)?.view;
        if (!view) return;
        const head = view.headWorld();
        this.peeps.add(head.x, head.y + 0.05 * view.scale, head.z, (id === MOTHER_ID ? 0.2 : 0.13), Math.sin(view.root.rotation.y) >= 0 ? 1 : -1);
      },
    };
  }

  private timers: { at: number; fn: () => void }[] = [];
  private later(fn: () => void, seconds: number): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  preload(): void {
    loadShapes()
      .then((shapes) => {
        this.shapes = shapes;
        this.motherView = new DuckView(MOTHER_ID, 'mother', 3, 1, shapes.mother, this.world);
        this.group.add(this.motherView.root);
        for (const l of this.live.values()) this.ensureView(l);
        this.onReady?.();
      })
      .catch((e: unknown) => this.onError?.(e instanceof Error ? e.message : String(e)));
  }

  get ready(): boolean {
    return this.shapes !== null;
  }

  // --- document ------------------------------------------------------------------

  /** Paint in the next duckling with this id (it was just drawn). */
  expectFormation(id: string, f: FormationRequest): void {
    this.pending.set(id, f);
  }

  sync(doc: DucksDoc): void {
    this.doc = doc;
    if (doc.mother !== this.appliedMother) {
      const m = doc.mother;
      const far = Math.hypot(m.x - this.mother.x, m.z - this.mother.z) > 0.05;
      if (!this.appliedMother || far) {
        this.mother.place(m.x, m.z, m.heading);
        this.trail.reset(m.x, m.z);
        this.leaderS = this.trail.end;
      }
      this.appliedMother = m;
    }
    const ids = new Set(doc.ducklings.map((d) => d.id));
    for (const [id, l] of this.live) {
      if (ids.has(id)) continue;
      if (l.duck.mode === 'leaving') continue;
      if (l.vanish === 0) l.vanish = 0.0001;
    }
    doc.ducklings.forEach((rec, i) => {
      const l = this.live.get(rec.id);
      if (l) {
        l.record = rec;
        if (l.vanish > 0 || l.duck.mode === 'leaving') this.revive(l);
        return;
      }
      this.spawn(rec, i, doc.ducklings.length);
    });
    this.order = doc.ducklings.map((d) => d.id);
  }

  private revive(l: Live): void {
    l.vanish = 0;
    if (l.duck.mode === 'leaving') {
      l.duck.mode = 'join';
      l.duck.leaveTime = 0;
      l.duck.gone = false;
    }
    l.view?.setFade(1);
  }

  private spawn(rec: DucklingRecord, index: number, count: number): void {
    const f = this.pending.get(rec.id);
    this.pending.delete(rec.id);
    let x: number, z: number, deck = false;
    if (f) {
      x = f.origin.x;
      z = f.origin.z;
    } else {
      // a loaded or restored duckling appears in a huddle spot round mum
      const slot = this.huddleSlot(index, count);
      x = slot.x;
      z = slot.z;
      deck = slot.deck;
    }
    const duck = new Duckling(rec.id, x, z, this.mother.heading + (Math.random() - 0.5), deck, rec.seed, rec.size, this.events(rec.id, 0.52 * rec.size), this.reducedMotion);
    if (!f) {
      duck.mode = this.mother.moving ? 'join' : 'huddle';
    }
    const l: Live = {
      record: rec,
      duck,
      view: null,
      formation: f ? { ...f, t: 0 } : { origin: new THREE.Vector3(x, 0, z), radius: 0.5, duration: 0.6, t: 0 },
      vanish: 0,
    };
    if (!f) l.formation!.origin.set(x, duck.body.y + 0.1, z);
    this.live.set(rec.id, l);
    this.ensureView(l);
  }

  private ensureView(l: Live): void {
    if (l.view || !this.shapes) return;
    const rec = l.record;
    const h = (n: number) => {
      const v = Math.sin(rec.seed * 12.9898 + n * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    l.view = new DuckView(rec.id, 'duckling', rec.seed, rec.size, this.shapes.duckling, this.world, {
      cap: h(1),
      warmth: h(2),
      tuft: h(3) < 0.3,
    });
    this.group.add(l.view.root);
    if (l.formation) l.view.setFormation(0, l.formation.origin, l.formation.radius);
  }

  // --- queries ---------------------------------------------------------------------

  ids(): string[] {
    return [...this.order];
  }

  get(id: string): Live | undefined {
    return this.live.get(id);
  }

  viewOf(id: string): DuckView | null {
    return id === MOTHER_ID ? this.motherView : this.live.get(id)?.view ?? null;
  }

  bodyOf(id: string) {
    return id === MOTHER_ID ? this.mother.body : this.live.get(id)?.duck.body;
  }

  /** The id under a screen point (NDC), mum included; null for none. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): string | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const proxies: THREE.Object3D[] = [];
    if (this.motherView) proxies.push(this.motherView.proxy);
    for (const id of this.order) {
      const l = this.live.get(id);
      if (l?.view && l.duck.mode !== 'leaving' && l.vanish === 0) proxies.push(l.view.proxy);
    }
    this.group.updateMatrixWorld(true);
    const hit = ray.intersectObjects(proxies, false)[0];
    return (hit?.object.userData.duckId as string | undefined) ?? null;
  }

  setHighlight(selected: string | null, hover: string | null): void {
    const set = (id: string, v: DuckView | null) => v?.setHighlight(id === selected ? 1 : id === hover ? 0.45 : 0);
    set(MOTHER_ID, this.motherView);
    for (const [id, l] of this.live) set(id, l.view);
  }

  // --- leading -------------------------------------------------------------------------

  leadTo(x: number, z: number, deck = false): boolean {
    return this.mother.leadTo(x, z, deck);
  }

  follow(x: number, z: number, deck = false): void {
    this.mother.follow(x, z, deck);
  }

  endFollow(): void {
    this.mother.endFollow();
  }

  // --- per-duck actions -----------------------------------------------------------------

  /** Peep, and the neighbours answer in a ripple down (and up) the line. */
  peep(id: string): void {
    const body = this.bodyOf(id);
    if (!body) return;
    body.play('peep');
    const line = [MOTHER_ID, ...this.order];
    const i = line.indexOf(id);
    for (let k = 1; k < line.length; k++) {
      for (const j of [i - k, i + k]) {
        if (j < 0 || j >= line.length) continue;
        // mum answers only her neighbour; ducklings answer all the way down the line
        if (line[j] === MOTHER_ID && k > 1) continue;
        this.peepQueue.push({ id: line[j], at: this.time + 0.28 * k });
      }
    }
  }

  hold(id: string, x: number, z: number, deck: boolean): void {
    this.live.get(id)?.duck.hold(x, z, deck);
  }

  release(id: string): void {
    this.live.get(id)?.duck.release();
  }

  /** The goodbye: a wave, a waddle off the nearest edge of the tile, a fade. */
  leave(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    const { x, z } = l.duck.body;
    const toX = TILE.halfX - Math.abs(x);
    const toZ = TILE.halfZ - Math.abs(z);
    const ex = toX < toZ ? Math.sign(x || 1) * (TILE.halfX - 1.05) : x;
    const ez = toX < toZ ? z : Math.sign(z || 1) * (TILE.halfZ - 1.05);
    l.duck.leave(nearestFree(ex, ez));
  }

  // --- the line ---------------------------------------------------------------------------

  /** A loose huddle spot round mum for the i-th of n ducklings, in her medium. */
  huddleSlot(i: number, n: number): NavPoint {
    const m = this.mother.body;
    const swimming = m.swimming;
    const spread = Math.min(2.4, 0.5 + n * 0.22);
    const a = m.heading + Math.PI + (n > 1 ? (i / (n - 1) - 0.5) * 2 * spread : 0) + 0.25 * Math.sin(i * 2.3);
    const ring = 0.8 + 0.32 * (i % 2) + 0.28 * Math.floor(i / 6);
    for (const k of [1, 0.85, 0.7, 0.55]) {
      const x = m.x + Math.cos(a) * ring * k;
      const z = m.z - Math.sin(a) * ring * k;
      const p = nearestFree(x, z, m.deck);
      const kind = groundKind(p.x, p.z);
      if (p.deck === m.deck && (p.deck || (swimming ? kind === 2 : kind === 1))) return p;
    }
    return { x: m.x, z: m.z, deck: m.deck };
  }

  /** Keep ducklings that are off the line from piling into each other or into mum. */
  private separate(): void {
    const free = this.order.map((id) => this.live.get(id)!).filter((l) => l && (l.duck.mode === 'join' || l.duck.mode === 'huddle'));
    const m = this.mother.body;
    for (let i = 0; i < free.length; i++) {
      const a = free[i].duck.body;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j].duck.body;
        if (a.deck !== b.deck) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = 0.34;
        if (d < min && d > 1e-4) {
          const push = (min - d) * 0.25;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
      const dx = a.x - m.x, dz = a.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 1e-4 && a.deck === m.deck) {
        a.x += (dx / d) * (0.6 - d) * 0.2;
        a.z += (dz / d) * (0.6 - d) * 0.2;
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const tm of this.timers.filter((x) => x.at <= t)) tm.fn();
    this.timers = this.timers.filter((x) => x.at > t);

    const mum = this.mother;
    mum.update(dt);
    const moving = mum.moving;
    // setting off after a rest: the trail starts afresh where she stood, and the huddle falls into line
    if (moving && this.wasStill && this.huddled) {
      this.trail.reset(mum.x, mum.z, mum.body.deck);
      for (const l of this.live.values()) l.duck.rejoin();
      this.huddled = false;
    }
    this.wasStill = !moving;
    this.leaderS = this.trail.push(mum.x, mum.z, mum.body.deck);
    if (mum.stillFor > HUDDLE_DELAY) this.huddled = true;
    this.trail.prune(this.leaderS - 30);

    // huddle spots follow mum while she rests
    this.slotTimer -= dt;
    const active = this.order.filter((id) => this.live.get(id)?.vanish === 0);
    if (this.slotTimer <= 0 || this.slots.length !== active.length) {
      this.slotTimer = moving ? 0.5 : 0.25;
      this.slots = active.map((_, i) => this.huddleSlot(i, active.length));
    }

    const scale = spacingScale(mum.body.speed, WALK_SPEED);
    let prevS: number | null = null;
    let index = 0;
    const sitter = active.length >= 3 ? active[active.length - 2] : null;
    for (const id of this.order) {
      const l = this.live.get(id);
      if (!l) continue;
      const ctx: LineContext = {
        trail: this.trail,
        leaderS: this.leaderS,
        leaderSpeed: mum.body.speed,
        scale,
        index,
        prevS,
        mumStill: mum.stillFor,
        huddleSlot: this.slots[index] ?? { x: mum.x, z: mum.z, deck: mum.body.deck },
        sitter: id === sitter,
      };
      this.stepFormation(l, dt);
      l.duck.update(dt, ctx);
      prevS = l.duck.mode === 'line' ? l.duck.s : null;
      if (l.vanish === 0 && l.duck.mode !== 'leaving') index++;
    }
    // ducklings no longer in the document (vanishing, or waddling off)
    for (const [id, l] of this.live) {
      if (this.order.includes(id)) continue;
      l.duck.update(dt, {
        trail: this.trail, leaderS: this.leaderS, leaderSpeed: 0, scale, index: 0, prevS: null, mumStill: 0,
        huddleSlot: { x: l.duck.body.x, z: l.duck.body.z, deck: l.duck.body.deck }, sitter: false,
      });
    }
    this.separate();
    this.straggle(dt);

    for (const p of this.peepQueue.filter((q) => q.at <= t)) this.bodyOf(p.id)?.play('peep');
    this.peepQueue = this.peepQueue.filter((q) => q.at > t);

    // mum came to rest: remember where
    if (!moving) {
      this.settleTimer += dt;
      const m = this.doc?.mother;
      if (this.settleTimer > 0.6 && m && Math.hypot(m.x - mum.x, m.z - mum.z) > 0.05 && !mum.body.deck) {
        this.settleTimer = 0;
        this.onMotherSettled?.(mum.x, mum.z, mum.heading);
      }
    } else this.settleTimer = 0;

    this.apply(t, dt);
  }

  /** Now and then, a duckling on the line stops to look at a flower or the butterfly. */
  private straggle(dt: number): void {
    if (this.reducedMotion) return;
    this.straggleTimer -= dt;
    if (this.straggleTimer > 0) return;
    this.straggleTimer = 18 + Math.random() * 22;
    if (!this.mother.moving || this.mother.body.swimming) return;
    const candidates = this.order.map((id) => this.live.get(id)!).filter((l) => l && l.duck.mode === 'line' && !l.duck.body.swimming);
    if (candidates.some((l) => l.duck.straggling) || candidates.length === 0) return;
    // the back of the line daydreams most
    const pick = candidates[Math.max(0, candidates.length - 1 - Math.floor(Math.random() * Math.min(3, candidates.length)))];
    const b = pick.duck.body;
    const fly = this.life.butterfly.group.position;
    const near = Math.hypot(fly.x - b.x, fly.z - b.z) < 3.5;
    const side = Math.random() < 0.5 ? -1 : 1;
    const lx = near ? fly.x : b.x + Math.cos(b.heading + side * 1.2) * 0.5;
    const lz = near ? fly.z : b.z - Math.sin(b.heading + side * 1.2) * 0.5;
    pick.duck.distract(lx, lz, 1.4 + Math.random() * 1.2);
  }

  private stepFormation(l: Live, dt: number): void {
    const f = l.formation;
    if (!f) return;
    f.t += dt;
    const u = Math.min(1, f.t / f.duration);
    if (u >= 1) {
      l.formation = null;
      l.view?.setFormation(1);
      if (l.duck.mode === 'forming') {
        l.duck.formed();
        this.later(() => this.peep(l.record.id), 0.15);
      }
    } else l.view?.setFormation(u * u * (3 - 2 * u), f.origin, f.radius);
  }

  private apply(t: number, dt: number): void {
    const mum = this.mother.body;
    this.motherView?.apply(mum.x, mum.y, mum.z, mum.heading, mum.pose(t));
    for (const [id, l] of this.live) {
      const b = l.duck.body;
      const view = l.view;
      if (!view) continue;
      const p = b.pose(t + l.record.seed * 0.01);
      if (l.duck.lift > 0) {
        // carried: lifted, little feet paddling the air
        p.lift += (0.3 / view.scale) * l.duck.lift;
        p.footL = Math.sin(t * 16) * l.duck.lift;
        p.footR = -Math.sin(t * 16) * l.duck.lift;
        p.stepL = p.stepR = 0.5 * l.duck.lift;
        p.swim *= 1 - l.duck.lift;
      }
      view.apply(b.x, b.y, b.z, b.heading, p);
      view.setWet(b.wet);
      if (l.vanish > 0) {
        l.vanish += dt;
        view.setFade(Math.max(0, 1 - l.vanish / 0.4));
        if (l.vanish > 0.4) this.drop(id);
      } else if (l.duck.mode === 'leaving') {
        const fade = Math.max(0, Math.min(1, edgeDistance(b.x, b.z) / 0.9, (7 - l.duck.leaveTime) / 1.5));
        view.setFade(fade);
        if (fade <= 0 || l.duck.gone) {
          this.drop(id);
          this.onGone?.(id);
        }
      }
    }
  }

  private drop(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    l.view?.dispose();
    this.live.delete(id);
  }

  /** For tests: a snapshot of the line. */
  snapshot() {
    return {
      mother: { x: this.mother.x, z: this.mother.z, heading: this.mother.heading, swimming: this.mother.body.swimming, deck: this.mother.body.deck, moving: this.mother.moving, still: this.mother.stillFor },
      leaderS: this.leaderS,
      ducklings: this.order.map((id) => {
        const l = this.live.get(id)!;
        const b = l.duck.body;
        return { id, mode: l.duck.mode, x: b.x, z: b.z, s: l.duck.s, swimming: b.swimming, deck: b.deck, inWater: inWater(b.x, b.z, b.deck), trailDist: this.trail.distanceTo(b.x, b.z), formed: !l.formation };
      }),
    };
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.drop(id);
    this.motherView?.dispose();
    this.peeps.dispose();
  }
}
