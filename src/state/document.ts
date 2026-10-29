import { TILE } from '../scene/park';

/**
 * The scene document: mother duck's resting place and the ducklings in line
 * order (the array order *is* the line; the newest is last). Immutable —
 * every edit returns a new document — so undo/redo is a list of snapshots.
 * Duckling positions are not saved: on load they huddle round their mother.
 */

export const VERSION = 1;
export const MAX_DUCKLINGS = 12;
export const NAME_MAX = 16;
export const SIZE_MIN = 0.85;
export const SIZE_MAX = 1.15;

export interface MotherRecord {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface DucklingRecord {
  readonly id: string;
  readonly seed: number;
  readonly size: number;
  readonly name?: string;
}

export interface DucksDoc {
  readonly version: 1;
  readonly mother: MotherRecord;
  readonly ducklings: readonly DucklingRecord[];
}

export const MOTHER_START: MotherRecord = { x: -1.6, z: 3.4, heading: 0.25 };

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e6;
  return `d${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const newSeed = () => Math.floor(Math.random() * 1e6);

export const emptyDoc = (mother: MotherRecord = MOTHER_START): DucksDoc => ({ version: VERSION, mother, ducklings: [] });

export function defaultDoc(): DucksDoc {
  return {
    version: VERSION,
    mother: MOTHER_START,
    ducklings: [
      { id: 'pip', seed: 1201, size: 1.02 },
      { id: 'bean', seed: 3307, size: 0.94 },
      { id: 'waffle', seed: 5413, size: 1.08 },
    ],
  };
}

export function showcaseDoc(): DucksDoc {
  const names = ['Pip', 'Bean', 'Waffle', 'Nugget', 'Dumpling', 'Biscuit', 'Clementine'];
  return {
    version: VERSION,
    mother: { x: 0.6, z: 2.9, heading: 0.1 },
    ducklings: names.map((name, i) => ({ id: `show${i}`, seed: 911 + i * 1777, size: [1.04, 0.9, 1.1, 0.96, 1.0, 0.88, 1.06][i], name })),
  };
}

export function findDuckling(doc: DucksDoc, id: string | null): DucklingRecord | undefined {
  return id ? doc.ducklings.find((d) => d.id === id) : undefined;
}

/** Add a duckling at the end of the line. */
export function addDuckling(doc: DucksDoc, d: DucklingRecord): DucksDoc {
  if (doc.ducklings.length >= MAX_DUCKLINGS) return doc;
  return { ...doc, ducklings: [...doc.ducklings, d] };
}

export function removeDuckling(doc: DucksDoc, id: string): DucksDoc {
  if (!doc.ducklings.some((d) => d.id === id)) return doc;
  return { ...doc, ducklings: doc.ducklings.filter((d) => d.id !== id) };
}

export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex -- strip control characters from names
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function renameDuckling(doc: DucksDoc, id: string, raw: string): DucksDoc {
  const name = cleanName(raw);
  const current = findDuckling(doc, id);
  if (!current || (current.name ?? '') === name) return doc;
  return {
    ...doc,
    ducklings: doc.ducklings.map((d) => {
      if (d.id !== id) return d;
      const { name: _old, ...rest } = d;
      void _old;
      return name ? { ...rest, name } : rest;
    }),
  };
}

export function moveMother(doc: DucksDoc, mother: MotherRecord): DucksDoc {
  const m = doc.mother;
  if (Math.abs(m.x - mother.x) < 1e-4 && Math.abs(m.z - mother.z) < 1e-4 && Math.abs(m.heading - mother.heading) < 1e-4) return doc;
  return { ...doc, mother };
}

const NAMES = [
  'Pip', 'Bean', 'Waffle', 'Nugget', 'Dumpling', 'Biscuit', 'Puddle', 'Sprout', 'Button', 'Clementine', 'Toffee', 'Pebble',
  'Mochi', 'Custard', 'Noodle', 'Peaches', 'Bramble', 'Crumpet', 'Daisy', 'Maple', 'Pickle', 'Butterscotch', 'Wren', 'Tater',
];

/** A name for the 🎲 button, avoiding names already taken. */
export function suggestName(taken: readonly string[], rand: () => number = Math.random): string {
  const free = NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// --- untrusted input ----------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Validate a document from storage or a file. Bad fields are dropped or
 * clamped, the line is capped at 12 and ids are made unique; anything that
 * isn't recognisably a DUCKLINGS scene is rejected (null).
 */
export function parseDoc(input: unknown): DucksDoc | null {
  if (!isObj(input) || input.version !== VERSION) return null;
  const m = input.mother;
  if (!isObj(m) || !finite(m.x) || !finite(m.z)) return null;
  const mother: MotherRecord = {
    x: clamp(m.x, -TILE.halfX + 1, TILE.halfX - 1),
    z: clamp(m.z, -TILE.halfZ + 1, TILE.halfZ - 1),
    heading: finite(m.heading) ? Math.atan2(Math.sin(m.heading), Math.cos(m.heading)) : 0,
  };
  if (!Array.isArray(input.ducklings)) return null;
  const seen = new Set<string>();
  const ducklings: DucklingRecord[] = [];
  for (const raw of input.ducklings) {
    if (ducklings.length >= MAX_DUCKLINGS) break;
    if (!isObj(raw)) continue;
    const id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) && !seen.has(raw.id) ? raw.id : newId();
    seen.add(id);
    const seed = finite(raw.seed) ? Math.abs(Math.floor(raw.seed)) % 1e9 : newSeed();
    const size = finite(raw.size) ? clamp(raw.size, SIZE_MIN, SIZE_MAX) : 1;
    const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
    ducklings.push(name ? { id, seed, size, name } : { id, seed, size });
  }
  return { version: VERSION, mother, ducklings };
}
