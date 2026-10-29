import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store } from '../state/store';
import {
  addDuckling, emptyDoc, findDuckling, MAX_DUCKLINGS, moveMother, newId, newSeed, removeDuckling, renameDuckling,
  SIZE_MAX, SIZE_MIN, type DucksDoc,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import { analyzeStroke, type Pt } from '../interaction/stroke';
import { surfaceAt, type SurfaceHit } from '../interaction/rays';
import { nearestFree } from '../ducks/nav';
import { surfaceAt as surfaceHeight } from '../ducks/body';
import { DUCKLING_SCALE } from '../ducks/DuckView';
import { MOTHER_ID } from '../ducks/Flock';

/**
 * Application commands. The UI and pointer input call these; they turn
 * intent into document edits (undoable: drawing, removing, renaming) or
 * live requests to the family (not undoable: leading mum, carrying a
 * duckling, a peep).
 */

export const FORMATION_DURATION = 1.1;
const DUCKLING_YELLOW = new THREE.Color('#f8dc84');

export type StrokeResult = { ok: true; id: string } | { ok: false; message: string };

export const MESSAGES = {
  small: 'Draw a little bigger — any blob will do.',
  open: 'Close the loop — a little blob becomes a duckling.',
  paper: 'Draw on the park.',
  full: 'That’s a full family — twelve ducklings. Remove one to make room.',
  leadPaper: 'Lead her somewhere on the park.',
} as const;

export class DucksApp {
  private drag: { id: string; kind: 'duckling' | 'mother' } | null = null;
  private saveTimer = 0;
  private readonly unsub: (() => void)[] = [];
  hoverId: string | null = null;

  constructor(readonly engine: Engine, readonly store: Store) {}

  get flock() {
    return this.engine.flock;
  }

  start(): void {
    let prevDoc: DucksDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      this.flock.sync(doc);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();
    this.flock.onMotherSettled = (x, z, heading) => this.store.amend(moveMother(this.store.doc, { x, z, heading }));
    this.flock.onReady = () => this.store.set({ loading: false });
    this.flock.onError = (message) => this.store.set({ fatal: `The ducks could not be built: ${message}` });
    this.flock.preload();
    this.unsub.push(this.engine.onFrame(() => this.flock.setHighlight(this.store.get().selectedId, this.hoverId)));
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  surfaceAt(clientX: number, clientY: number): SurfaceHit {
    return surfaceAt(this.engine.camera, this.rect, clientX, clientY);
  }

  isOnTile(clientX: number, clientY: number): boolean {
    return this.surfaceAt(clientX, clientY).surface !== 'paper';
  }

  // --- drawing ---------------------------------------------------------------------

  /** A finished stroke: a closed little blob becomes a duckling at the end of the line. */
  createFromStroke(points: readonly Pt[]): StrokeResult {
    const a = analyzeStroke(points);
    if (!a.valid) return { ok: false, message: MESSAGES.small };
    if (!a.closed) return { ok: false, message: MESSAGES.open };
    if (this.store.doc.ducklings.length >= MAX_DUCKLINGS) return { ok: false, message: MESSAGES.full };
    const hit = this.surfaceAt(a.centroid.x, a.centroid.y);
    if (hit.surface === 'paper') return { ok: false, message: MESSAGES.paper };

    // how big it was drawn, measured on the ground, sets its size within ±15 %
    const corners = [
      this.surfaceAt(a.bbox.minX, a.centroid.y), this.surfaceAt(a.bbox.maxX, a.centroid.y),
      this.surfaceAt(a.centroid.x, a.bbox.minY), this.surfaceAt(a.centroid.x, a.bbox.maxY),
    ];
    const across = Math.max(corners[0].point.distanceTo(corners[1].point), corners[2].point.distanceTo(corners[3].point));
    const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, 1 + (Number.isFinite(across) ? across - 0.9 : 0) * 0.3));

    const spot = nearestFree(hit.point.x, hit.point.z, hit.deck);
    const id = newId();
    const seed = newSeed();
    const y = surfaceHeight(spot.x, spot.z, spot.deck);
    this.flock.expectFormation(id, {
      origin: new THREE.Vector3(spot.x, y + 0.1 * DUCKLING_SCALE * size, spot.z),
      radius: 0.3 * size,
      duration: this.engine.reducedMotion ? FORMATION_DURATION * 0.5 : FORMATION_DURATION,
    });
    if (hit.surface === 'water') {
      // drawn on the water: the yellow blooms on the wet surface first, a ring as it settles
      this.engine.ripples.bloom(spot.x, spot.z, 0.34 * size, DUCKLING_YELLOW);
      window.setTimeout(() => this.engine.ripples.add(spot.x, spot.z, 0.5), 700);
    }
    this.store.commit(addDuckling(this.store.doc, { id, seed, size }), { hasDrawn: true, selectedId: null });
    // it starts facing mum, about to hurry over
    const live = this.flock.get(id);
    if (live) {
      live.duck.body.x = spot.x;
      live.duck.body.z = spot.z;
      live.duck.body.deck = spot.deck;
      live.duck.body.heading = Math.atan2(-(this.flock.mother.z - spot.z), this.flock.mother.x - spot.x);
    }
    return { ok: true, id };
  }

  // --- leading ------------------------------------------------------------------------

  /** Click to lead: mum waddles (or swims) to the spot. */
  leadAt(clientX: number, clientY: number): boolean {
    const hit = this.surfaceAt(clientX, clientY);
    if (hit.surface === 'paper') return false;
    return this.flock.leadTo(hit.point.x, hit.point.z, hit.deck);
  }

  /** Drag to lead: she follows the pointer at a waddling pace. */
  leadFollow(clientX: number, clientY: number): boolean {
    const hit = this.surfaceAt(clientX, clientY);
    if (hit.surface === 'paper') return false;
    this.flock.follow(hit.point.x, hit.point.z, hit.deck);
    return true;
  }

  endLead(): void {
    this.flock.endFollow();
  }

  // --- selection & carrying --------------------------------------------------------------

  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.rect;
    return this.flock.pick(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.engine.camera);
  }

  select(id: string | null): void {
    if (this.store.get().selectedId !== id) this.store.set({ selectedId: id });
  }

  /** Pick a duck up (a duckling is carried; mum is led). */
  beginDrag(id: string, clientX: number, clientY: number): void {
    if (id === MOTHER_ID) {
      this.drag = { id, kind: 'mother' };
      this.leadFollow(clientX, clientY);
      return;
    }
    const live = this.flock.get(id);
    if (!live) return;
    this.drag = { id, kind: 'duckling' };
    const b = live.duck.body;
    this.flock.hold(id, b.x, b.z, b.deck);
  }

  /** Returns false when the pointer is somewhere the duck can't go. */
  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    if (!d) return false;
    if (d.kind === 'mother') return this.leadFollow(clientX, clientY);
    const hit = this.surfaceAt(clientX, clientY);
    if (hit.surface === 'paper') return false;
    const p = nearestFree(hit.point.x, hit.point.z, hit.deck);
    this.flock.hold(d.id, p.x, p.z, p.deck);
    return Math.hypot(p.x - hit.point.x, p.z - hit.point.z) < 0.4;
  }

  endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'mother') this.endLead();
    else this.flock.release(d.id);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // --- actions ---------------------------------------------------------------------------

  peep(id = this.store.get().selectedId): void {
    if (id) this.flock.peep(id);
  }

  remove(id = this.store.get().selectedId): void {
    if (!id || id === MOTHER_ID || !findDuckling(this.store.doc, id)) return;
    this.flock.leave(id);
    this.store.commit(removeDuckling(this.store.doc, id), { selectedId: null });
  }

  rename(id: string, name: string): void {
    const next = renameDuckling(this.store.doc, id, name);
    if (next === this.store.doc) return;
    // a burst of typing is one undo step
    const now = performance.now();
    if (this.lastRename.id === id && now - this.lastRename.at < 1500) this.store.amend(next);
    else this.store.commit(next);
    this.lastRename = { id, at: now };
  }

  private lastRename = { id: '', at: 0 };

  reset(): void {
    if (this.store.doc.ducklings.length === 0) return;
    this.store.commit(emptyDoc(this.store.doc.mother), { selectedId: null });
    this.store.toast('The park is quiet. Undo brings the ducklings back.');
  }

  loadDoc(doc: DucksDoc): void {
    this.store.commit(doc, { selectedId: null });
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    for (const u of this.unsub) u();
  }
}
