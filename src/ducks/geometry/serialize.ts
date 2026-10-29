import * as THREE from 'three';
import type { CreatureGeometries } from './shapes';

/** Geometry <-> plain transferable arrays, for crossing the worker boundary. */

interface PackedAttribute { array: Float32Array; itemSize: number }
export interface PackedGeometry {
  attributes: Record<string, PackedAttribute>;
  index: Uint32Array | null;
}
export type PackedSet = Record<string, Record<string, PackedGeometry>>;

export function serializeSet(set: Record<string, CreatureGeometries>): PackedSet {
  const out: PackedSet = {};
  for (const [kind, parts] of Object.entries(set)) {
    out[kind] = {};
    for (const [name, geo] of Object.entries(parts)) {
      const attributes: Record<string, PackedAttribute> = {};
      for (const [key, attr] of Object.entries(geo.attributes)) {
        const a = attr as THREE.BufferAttribute;
        attributes[key] = { array: new Float32Array(a.array as ArrayLike<number>), itemSize: a.itemSize };
      }
      const index = geo.getIndex();
      out[kind][name] = { attributes, index: index ? new Uint32Array(index.array as ArrayLike<number>) : null };
    }
  }
  return out;
}

export function transferables(p: PackedSet): ArrayBuffer[] {
  return Object.values(p).flatMap((parts) =>
    Object.values(parts).flatMap((g) => [
      ...Object.values(g.attributes).map((a) => a.array.buffer as ArrayBuffer),
      ...(g.index ? [g.index.buffer as ArrayBuffer] : []),
    ]),
  );
}

export function deserializeSet(p: PackedSet): Record<string, CreatureGeometries> {
  const out: Record<string, CreatureGeometries> = {};
  for (const [kind, parts] of Object.entries(p)) {
    out[kind] = {};
    for (const [name, packed] of Object.entries(parts)) {
      const geo = new THREE.BufferGeometry();
      for (const [key, a] of Object.entries(packed.attributes)) geo.setAttribute(key, new THREE.BufferAttribute(a.array, a.itemSize));
      if (packed.index) geo.setIndex(new THREE.BufferAttribute(packed.index, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      out[kind][name] = geo;
    }
  }
  return out;
}
