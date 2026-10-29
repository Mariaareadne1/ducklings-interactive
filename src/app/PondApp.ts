import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store } from '../state/store';
import {
  addCreature, countKind, emptyDoc, findCreature, MAX_CREATURES, newId, newSeed, placeFor, removeCreature, updateCreature,
  type CreatureRecord, type PondDoc,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import { analyzeStroke, type Pt } from '../interaction/stroke';
import { screenToGround, screenToWater, surfaceAt } from '../interaction/rays';
import { clampToBank, clampToWater, WATER_Y } from '../scene/pondShape';
import { FORMATION_DURATION, formationOrigin, formationRadius } from '../creatures/formation';
import { worldLength } from '../creatures/scale';
import { clampDuck, onLand as livesOnLand } from '../creatures/habitat';
import { KIND_LABEL, type Kind } from '../creatures/types';
import { draft } from './drawing';

/**
 * Application commands. UI and pointer input call these; they turn intent
 * into document edits (undoable) or live animation requests (not undoable).
 */

const BLOOM_HEX: Record<string, string> = { koi: '#f6a26c', minnow: '#c4d3c8', duck: '#d8b48c', duckling: '#f6e2a0', lily: '#8fbf7c', frog: '#9fd07a' };

function bloomColor(r: CreatureRecord): THREE.Color {
  const key = r.kind === 'fish' ? (r.minnow ? 'minnow' : 'koi') : r.kind === 'duck' ? (r.parent ? 'duckling' : 'duck') : r.kind;
  return new THREE.Color(BLOOM_HEX[key]);
}

export type StrokeResult = { ok: true; id: string; kind: Kind } | { ok: false; message: string };

export class PondApp {
  private drag: { id: string; offsetX: number; offsetZ: number; startX: number; startZ: number } | null = null;
  private lastRotate = { id: '', at: 0 };
  private saveTimer = 0;
  private insteadTimer = 0;
  private readonly unsub: (() => void)[] = [];
  hoverId: string | null = null;

  constructor(readonly engine: Engine, readonly store: Store) {}

  get pond() {
    return this.engine.pond;
  }

  start(): void {
    let prevDoc: PondDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      this.pond.sync(doc);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();

    this.pond.onMoved = (id, x, z) => {
      if (findCreature(this.store.doc, id)) this.store.amend(updateCreature(this.store.doc, id, { x, z }));
    };
    this.pond.onPerch = (id, perch) => {
      const rec = findCreature(this.store.doc, id);
      if (!rec) return;
      const patch: Record<string, unknown> = { ...rec };
      if (perch) patch.perch = perch;
      else delete patch.perch;
      this.store.amend({ ...this.store.doc, creatures: this.store.doc.creatures.map((c) => (c.id === id ? (patch as unknown as CreatureRecord) : c)) });
    };
    this.pond.onReady = () => this.store.set({ loading: false });
    this.pond.onError = (message) => this.store.set({ fatal: `The pond's creatures could not be built: ${message}` });
    this.pond.preload();
    this.unsub.push(
      this.engine.onFrame(() => {
        this.pond.setHighlight(this.store.get().selectedId, this.hoverId);
      }),
    );
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  // --- drawing -------------------------------------------------------------------

  createFromStroke(points: readonly Pt[]): StrokeResult {
    const a = analyzeStroke(points);
    if (!a.valid) return { ok: false, message: 'Draw a little bigger — any loop will do.' };
    if (this.store.doc.creatures.length >= MAX_CREATURES) return { ok: false, message: 'The pond is full. Remove something to make room.' };
    const plan = draft(this, points, a, this.store.get().drawKind);
    if ('message' in plan) return { ok: false, message: plan.message };
    const record = plan.record;
    this.beginFormation(record);
    this.store.commit(addCreature(this.store.doc, record), { hasDrawn: true, instead: null });
    if (!plan.confident && plan.alternatives.length) this.offerInstead(record.id, plan.alternatives);
    return { ok: true, id: record.id, kind: record.kind };
  }

  private beginFormation(r: CreatureRecord): void {
    const duration = this.engine.reducedMotion ? FORMATION_DURATION * 0.5 : FORMATION_DURATION;
    const onLand = livesOnLand(r.kind, r.x, r.z);
    this.pond.expectFormation(r.id, { origin: formationOrigin(r), radius: formationRadius(r), duration, mode: onLand ? 0 : 1 });
    if (!onLand) {
      // the pigment spreads on the wet surface first; a ring follows as it settles
      this.engine.ripples.bloom(r.x, r.z, formationRadius(r) * 1.05, bloomColor(r));
      window.setTimeout(() => this.engine.ripples.add(r.x, r.z, 0.9), duration * 650);
    }
    else if (r.perch) this.pond.sense.touchPad(r.perch, r.x, r.z + 1, 0.4);
  }

  private offerInstead(id: string, kinds: Kind[]): void {
    window.clearTimeout(this.insteadTimer);
    this.store.set({ instead: { id, kinds, key: Date.now() } });
    this.insteadTimer = window.setTimeout(() => {
      if (this.store.get().instead?.id === id) this.store.set({ instead: null });
    }, 3000);
  }

  /** Swap a just-drawn creature for another kind, as part of the same undo step. */
  makeInstead(id: string, kind: Kind): void {
    const rec = findCreature(this.store.doc, id);
    this.store.set({ instead: null });
    if (!rec || rec.kind === kind) return;
    const [x, z] = kind === 'frog' ? clampToBank(rec.x, rec.z) : placeFor(kind, rec.x, rec.z);
    const next: CreatureRecord = {
      id: newId(kind), kind, x, z, heading: rec.heading, seed: rec.seed, size: rec.size,
      ...(kind === 'fish' ? { pattern: rec.seed % 4 } : {}),
      ...(kind === 'lily' ? { flower: rec.seed % 3 === 0 ? 'bud' as const : 'none' as const } : {}),
    };
    this.beginFormation(next);
    this.store.amend(addCreature(removeCreature(this.store.doc, id), next));
    this.store.set({ selectedId: null });
    this.store.toast(`Made it a ${KIND_LABEL[kind].toLowerCase()}.`);
  }

  // --- selection & dragging ---------------------------------------------------------

  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.rect;
    return this.pond.pick(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1));
  }

  surfaceAt(clientX: number, clientY: number) {
    return surfaceAt(this.engine.camera, this.rect, clientX, clientY);
  }

  isOnTile(clientX: number, clientY: number): boolean {
    return this.surfaceAt(clientX, clientY).surface !== 'paper';
  }

  select(id: string | null): void {
    if (this.store.get().selectedId !== id) this.store.set({ selectedId: id });
  }

  private dragPoint(kind: Kind, clientX: number, clientY: number): THREE.Vector3 | null {
    if (kind === 'frog') return screenToGround(this.engine.camera, this.rect, clientX, clientY) ?? screenToWater(this.engine.camera, this.rect, clientX, clientY);
    // a duck follows the pointer onto the bank as readily as across the water
    if (kind === 'duck') {
      const hit = this.surfaceAt(clientX, clientY);
      return hit.surface === 'paper' ? null : hit.point;
    }
    return screenToWater(this.engine.camera, this.rect, clientX, clientY);
  }

  beginDrag(id: string, clientX: number, clientY: number): void {
    const live = this.pond.get(id);
    if (!live) return;
    const hit = this.dragPoint(live.record.kind, clientX, clientY);
    const { x, z } = live.controller;
    this.drag = { id, offsetX: hit ? x - hit.x : 0, offsetZ: hit ? z - hit.z : 0, startX: x, startZ: z };
    this.pond.setHeld(id, true);
  }

  /** Returns false when the pointer is somewhere this creature can't go (it waits at its last good spot). */
  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    const live = d ? this.pond.get(d.id) : undefined;
    if (!d || !live) return false;
    const kind = live.record.kind;
    const hit = this.dragPoint(kind, clientX, clientY);
    if (!hit) return false;
    const tx = hit.x + d.offsetX;
    const tz = hit.z + d.offsetZ;
    let x: number;
    let z: number;
    if (kind === 'frog') {
      const pad = this.pond.padAt(tx, tz, 0.1);
      [x, z] = pad ? [tx, tz] : clampToBank(tx, tz);
    } else if (kind === 'duck') [x, z] = clampDuck(tx, tz);
    else [x, z] = clampToWater(tx, tz, kind === 'lily' ? 0.9 : 0.6);
    // keep it inside the frame too
    const ndc = new THREE.Vector3(x, WATER_Y + 0.3, z).project(this.engine.camera);
    if (Math.abs(ndc.x) > 0.97 || ndc.y < -1.05 || ndc.z > 1) return false;
    this.pond.dragTo(d.id, x, z);
    return Math.hypot(x - tx, z - tz) < 0.5;
  }

  endDrag(cancel = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.pond.setHeld(d.id, false);
    const live = this.pond.get(d.id);
    if (!live) return;
    if (cancel) {
      this.pond.dragTo(d.id, d.startX, d.startZ);
      return;
    }
    const { x, z } = live.controller;
    if (Math.hypot(x - d.startX, z - d.startZ) < 0.01) return;
    const patch: Partial<CreatureRecord> = { x, z };
    let doc = updateCreature(this.store.doc, d.id, patch);
    if (live.record.kind === 'frog') {
      // dropped onto a pad: sit on it; dropped on the bank: off any pad
      const pad = this.pond.padAt(x, z, 0.1);
      const rec = findCreature(doc, d.id)!;
      const next: Record<string, unknown> = { ...rec };
      if (pad) next.perch = pad.id;
      else delete next.perch;
      doc = { ...doc, creatures: doc.creatures.map((c) => (c.id === d.id ? (next as unknown as CreatureRecord) : c)) };
    }
    this.store.commit(doc);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // --- per-creature actions -------------------------------------------------------------

  get selected(): CreatureRecord | undefined {
    return findCreature(this.store.doc, this.store.get().selectedId);
  }

  /** Run a named action on a creature (the contextual bar and keyboard call this). */
  act(action: string, id = this.selected?.id): void {
    const rec = findCreature(this.store.doc, id ?? null);
    if (!rec) return;
    const p = this.pond;
    switch (action) {
      case 'come':
        this.store.set({ comeFor: rec.id });
        this.store.toast('Tap the water where it should come.');
        break;
      case 'hide':
        if (!p.fishHide(rec.id)) this.store.toast('There are no lily pads to hide under yet — draw one.');
        break;
      case 'leap': p.fishLeap(rec.id); break;
      case 'swim': p.fishSwim(rec.id); break;
      case 'school': {
        const n = p.fishSchool(rec.id);
        if (n < 2) this.store.toast('A school needs at least three fish.');
        break;
      }
      case 'dabble': p.duckDabble(rec.id); break;
      case 'preen': p.duckPreen(rec.id); break;
      case 'fly': p.duckFly(rec.id); break;
      case 'ducklings': this.duplicate(rec.id); break;
      case 'bloom': this.setFlower(rec, rec.flower === 'open' ? 'bud' : 'open'); break;
      case 'drift': p.lilyDrift(rec.id); break;
      case 'invite':
        if (!p.lilyInvite(rec.id)) this.store.toast(countKind(this.store.doc, 'frog') ? 'No frog is free to hop over just now.' : 'There is no frog yet — draw one on the bank.');
        break;
      case 'hop':
        if (!p.frogHop(rec.id)) this.store.toast('Nowhere to hop from here.');
        break;
      case 'catch': p.frogCatch(rec.id); break;
      case 'croak': p.frogCroak(rec.id); this.croakSound(); break;
    }
  }

  /** "Come here": a tap on the water (or a key press with the pointer over it) sets the spot. */
  comeTo(clientX: number, clientY: number): boolean {
    const id = this.store.get().comeFor;
    this.store.set({ comeFor: null });
    const hit = this.surfaceAt(clientX, clientY);
    if (!id || hit.surface !== 'water') return false;
    const [x, z] = clampToWater(hit.point.x, hit.point.z, 0.6);
    this.pond.fishCome(id, x, z);
    return true;
  }

  comeToPoint(id: string, clientX: number, clientY: number): boolean {
    const hit = this.surfaceAt(clientX, clientY);
    if (hit.surface !== 'water') return false;
    const [x, z] = clampToWater(hit.point.x, hit.point.z, 0.6);
    this.pond.fishCome(id, x, z);
    return true;
  }

  private setFlower(rec: CreatureRecord, flower: 'open' | 'bud'): void {
    this.store.commit(updateCreature(this.store.doc, rec.id, { flower }));
  }

  private croakSound(): void {
    if (!this.store.get().sound) return;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(130, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(85, ctx.currentTime + 0.28);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
      o.onended = () => void ctx.close();
    } catch {
      // audio unavailable: the croak is still seen
    }
  }

  rotate(delta: number, id = this.selected?.id): void {
    const rec = findCreature(this.store.doc, id ?? null);
    if (!rec) return;
    const live = this.pond.get(rec.id);
    const h = (live?.controller.heading ?? rec.heading) + delta;
    if (live) live.controller.heading = h;
    const next = updateCreature(this.store.doc, rec.id, { heading: Math.atan2(Math.sin(h), Math.cos(h)) });
    const now = performance.now();
    // a burst of rotation (wheel, held key) is one undo step
    if (this.lastRotate.id === rec.id && now - this.lastRotate.at < 700) this.store.amend(next);
    else this.store.commit(next);
    this.lastRotate = { id: rec.id, at: now };
  }

  /** Duplicate; a duck's duplicate is a duckling that follows it. */
  duplicate(id = this.selected?.id): void {
    const rec = findCreature(this.store.doc, id ?? null);
    if (!rec) return;
    if (this.store.doc.creatures.length >= MAX_CREATURES) {
      this.store.toast('The pond is full.');
      return;
    }
    const live = this.pond.get(rec.id)?.controller;
    const ox = live?.x ?? rec.x;
    const oz = live?.z ?? rec.z;
    const h = live?.heading ?? rec.heading;
    const len = worldLength(rec);
    let copy: CreatureRecord;
    if (rec.kind === 'duck') {
      const parent = rec.parent ?? rec.id;
      const [x, z] = clampDuck(ox - Math.cos(h) * len * 0.9, oz + Math.sin(h) * len * 0.9);
      copy = { id: newId('duck'), kind: 'duck', x, z, heading: h, seed: newSeed(), size: 1, parent };
    } else {
      const [x, z] = rec.kind === 'frog' ? clampToBank(ox + len * 0.9, oz + 0.3) : placeFor(rec.kind, ox + Math.sin(h) * len * 0.8, oz + Math.cos(h) * len * 0.8);
      const extra: Record<string, unknown> = { ...rec };
      delete extra.perch;
      copy = { ...(extra as unknown as CreatureRecord), id: newId(rec.kind), seed: newSeed(), x, z };
      if (rec.kind === 'fish' && !rec.minnow) copy = { ...copy, pattern: copy.seed % 4 };
    }
    this.pond.expectFormation(copy.id, { origin: formationOrigin(copy), radius: formationRadius(copy), duration: 0.9, mode: livesOnLand(copy.kind, copy.x, copy.z) ? 0 : 1 });
    this.store.commit(addCreature(this.store.doc, copy), { selectedId: copy.id });
  }

  remove(id = this.selected?.id): void {
    if (!id) return;
    this.store.commit(removeCreature(this.store.doc, id), { selectedId: null });
  }

  // --- pond-wide ---------------------------------------------------------------------------

  feedAt(clientX: number, clientY: number): boolean {
    const hit = this.surfaceAt(clientX, clientY);
    if (hit.surface !== 'water') return false;
    return this.pond.feed(hit.point.x, hit.point.z) > 0;
  }

  rain(): void {
    if (this.pond.raining) return;
    this.pond.rain(10);
  }

  breeze(): void {
    this.pond.startBreeze(10);
  }

  reset(): void {
    if (this.store.doc.creatures.length === 0) return;
    this.store.commit(emptyDoc(), { selectedId: null });
    this.engine.life.clearCrumbs();
    this.store.toast('The pond is empty. Undo brings everyone back.');
  }

  loadDoc(doc: PondDoc): void {
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
    window.clearTimeout(this.insteadTimer);
    for (const u of this.unsub) u();
  }
}
