import { clampToBank, clampToWater, isBank, isWater } from '../scene/pondShape';
import { KINDS, type FlowerState, type Kind } from '../creatures/types';
import { clampDuck } from '../creatures/habitat';

/** The persisted pond: plain, versioned, immutable data. */

export interface CreatureRecord {
  readonly id: string;
  readonly kind: Kind;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly seed: number;
  /** Size from the drawing, 0.85–1.15. */
  readonly size: number;
  /** Fish: koi pattern 0–3. */
  readonly pattern?: number;
  /** Fish: a small silver minnow rather than a koi. */
  readonly minnow?: boolean;
  /** Lily pad: its flower. */
  readonly flower?: FlowerState;
  /** Duck: the duck this duckling follows. */
  readonly parent?: string;
  /** Frog: the lily pad it sits on. */
  readonly perch?: string;
}

export interface PondDoc {
  readonly version: 1;
  readonly creatures: readonly CreatureRecord[];
}

export const DOC_VERSION = 1;
export const MAX_CREATURES = 24;
export const SIZE_MIN = 0.85;
export const SIZE_MAX = 1.15;

export const emptyDoc = (): PondDoc => ({ version: DOC_VERSION, creatures: [] });

let counter = 0;
export function newId(kind: Kind): string {
  counter = (counter + 1) % 1e6;
  return `${kind[0]}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export function addCreature(doc: PondDoc, c: CreatureRecord): PondDoc {
  return { ...doc, creatures: [...doc.creatures, c] };
}

export function updateCreature(doc: PondDoc, id: string, patch: Partial<Omit<CreatureRecord, 'id' | 'kind'>>): PondDoc {
  return { ...doc, creatures: doc.creatures.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Remove a creature, and let go of anything that referred to it (ducklings, frogs on a pad). */
export function removeCreature(doc: PondDoc, id: string): PondDoc {
  return {
    ...doc,
    creatures: doc.creatures
      .filter((c) => c.id !== id)
      .map((c) => {
        if (c.parent === id) return withoutKey(c, 'parent');
        if (c.perch === id) return withoutKey(c, 'perch');
        return c;
      }),
  };
}

function withoutKey(c: CreatureRecord, key: 'parent' | 'perch'): CreatureRecord {
  const copy: Record<string, unknown> = { ...c };
  delete copy[key];
  return copy as unknown as CreatureRecord;
}

export function findCreature(doc: PondDoc, id: string | null): CreatureRecord | undefined {
  return id ? doc.creatures.find((c) => c.id === id) : undefined;
}

export function countKind(doc: PondDoc, kind: Kind): number {
  return doc.creatures.filter((c) => c.kind === kind).length;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ID = /^[\w-]{1,40}$/;
const FLOWERS: readonly FlowerState[] = ['none', 'bud', 'open'];

/** Put a creature somewhere it can live: fish and pads in the pond, frogs on the bank (or their pad), ducks on either. */
export function placeFor(kind: Kind, x: number, z: number, onPad = false): [number, number] {
  if (kind === 'frog') return onPad || isBank(x, z) ? [x, z] : clampToBank(x, z);
  if (kind === 'duck') return clampDuck(x, z);
  const clearance = kind === 'lily' ? 0.9 : 0.6;
  return isWater(x, z, clearance) ? [x, z] : clampToWater(x, z, clearance);
}

/**
 * Validate untrusted input (localStorage, imported files). Bad entries are
 * dropped rather than failing the whole file; a wrong shape returns null.
 */
export function parseDoc(input: unknown): PondDoc | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { version?: unknown; creatures?: unknown };
  if (raw.version !== DOC_VERSION || !Array.isArray(raw.creatures)) return null;
  const out: CreatureRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw.creatures.slice(0, MAX_CREATURES * 2)) {
    if (out.length >= MAX_CREATURES) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!KINDS.includes(r.kind as Kind)) continue;
    if (!isNum(r.x) || !isNum(r.z) || !isNum(r.heading) || !isNum(r.seed)) continue;
    const kind = r.kind as Kind;
    const id = typeof r.id === 'string' && ID.test(r.id) && !seen.has(r.id) ? r.id : newId(kind);
    seen.add(id);
    const perch = kind === 'frog' && typeof r.perch === 'string' && ID.test(r.perch) ? r.perch : undefined;
    const [x, z] = placeFor(kind, r.x, r.z, !!perch);
    const rec: Record<string, unknown> = {
      id,
      kind,
      x,
      z,
      heading: Math.abs(r.heading) <= Math.PI ? r.heading : Math.atan2(Math.sin(r.heading), Math.cos(r.heading)),
      seed: Math.abs(Math.floor(r.seed)) % 1e6,
      size: isNum(r.size) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, r.size)) : 1,
    };
    if (kind === 'fish') {
      rec.pattern = isNum(r.pattern) ? Math.abs(Math.floor(r.pattern)) % 4 : 0;
      if (r.minnow === true) rec.minnow = true;
    }
    if (kind === 'lily') rec.flower = FLOWERS.includes(r.flower as FlowerState) ? r.flower : 'none';
    if (kind === 'duck' && typeof r.parent === 'string' && ID.test(r.parent)) rec.parent = r.parent;
    if (perch) rec.perch = perch;
    out.push(rec as unknown as CreatureRecord);
  }
  // references must point at something that exists, of the right kind
  const kindOf = new Map(out.map((c) => [c.id, c.kind]));
  const creatures = out.map((c) => {
    if (c.parent && (kindOf.get(c.parent) !== 'duck' || c.parent === c.id)) return withoutKey(c, 'parent');
    if (c.perch && kindOf.get(c.perch) !== 'lily') {
      const [x, z] = placeFor('frog', c.x, c.z);
      return { ...withoutKey(c, 'perch'), x, z };
    }
    return c;
  });
  return { version: DOC_VERSION, creatures };
}

/** The pond a first-time visitor sees: a few pads, two koi and a duck. */
export function defaultDoc(): PondDoc {
  return {
    version: DOC_VERSION,
    creatures: [
      { id: 'pad1', kind: 'lily', x: 4.6, z: -2.6, heading: 0.4, seed: 11, size: 1.05, flower: 'open' },
      { id: 'pad2', kind: 'lily', x: 6.3, z: -1.2, heading: 2.1, seed: 12, size: 0.9, flower: 'none' },
      { id: 'pad3', kind: 'lily', x: -5.6, z: 1.4, heading: 1.2, seed: 13, size: 1, flower: 'bud' },
      { id: 'koi1', kind: 'fish', x: 0.4, z: 0.8, heading: 0.3, seed: 21, size: 1.05, pattern: 0 },
      { id: 'koi2', kind: 'fish', x: -2.4, z: -1.6, heading: 2.8, seed: 22, size: 0.95, pattern: 1 },
      { id: 'duck1', kind: 'duck', x: 2.2, z: -4.2, heading: -0.4, seed: 31, size: 1 },
    ],
  };
}

/** A reproducible scene with every creature at different depths, for screenshots and the demo. */
export function showcaseDoc(): PondDoc {
  return {
    version: DOC_VERSION,
    creatures: [
      { id: 'pad1', kind: 'lily', x: 4.6, z: -2.6, heading: 0.4, seed: 11, size: 1.05, flower: 'open' },
      { id: 'pad2', kind: 'lily', x: 6.3, z: -1.0, heading: 2.1, seed: 12, size: 0.9, flower: 'none' },
      { id: 'pad3', kind: 'lily', x: -5.6, z: 1.4, heading: 1.2, seed: 13, size: 1, flower: 'bud' },
      { id: 'pad4', kind: 'lily', x: -1.6, z: 3.6, heading: 3.0, seed: 14, size: 1.1, flower: 'open' },
      { id: 'koi1', kind: 'fish', x: 0.4, z: 0.8, heading: 0.3, seed: 21, size: 1.1, pattern: 0 },
      { id: 'koi2', kind: 'fish', x: -2.4, z: -1.6, heading: 2.8, seed: 22, size: 1, pattern: 1 },
      { id: 'koi3', kind: 'fish', x: 3.0, z: 2.4, heading: -2.2, seed: 23, size: 0.95, pattern: 2 },
      { id: 'min1', kind: 'fish', x: -4.0, z: -3.6, heading: 0.9, seed: 24, size: 1, pattern: 0, minnow: true },
      { id: 'duck1', kind: 'duck', x: 2.2, z: -4.2, heading: -0.4, seed: 31, size: 1 },
      { id: 'ling1', kind: 'duck', x: 1.0, z: -4.0, heading: -0.4, seed: 32, size: 1, parent: 'duck1' },
      { id: 'frog1', kind: 'frog', x: -1.6, z: 3.6, heading: 1.4, seed: 41, size: 1, perch: 'pad4' },
      { id: 'frog2', kind: 'frog', x: -7.2, z: 6.2, heading: 0.9, seed: 42, size: 1 },
    ],
  };
}
