import { deserializeSet, type PackedSet } from './serialize';
import type { CreatureGeometries } from './shapes';

/**
 * Every creature shape is built once, off the main thread, and shared by
 * every creature of that kind (variety comes from paint seeds, size and pose).
 */

export type ShapeSet = Record<string, CreatureGeometries>;

let promise: Promise<ShapeSet> | null = null;
let ready: ShapeSet | null = null;

export function loadShapes(): Promise<ShapeSet> {
  if (promise) return promise;
  promise = new Promise<ShapeSet>((resolve, reject) => {
    const worker = new Worker(new URL('./shapes.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ packed?: PackedSet; error?: string }>) => {
      worker.terminate();
      if (event.data.packed) {
        ready = deserializeSet(event.data.packed);
        resolve(ready);
      } else reject(new Error(event.data.error ?? 'Creature shapes failed to build'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The shape worker crashed'));
    };
    worker.postMessage(null);
  });
  promise.catch(() => (promise = null));
  return promise;
}

export function shapesReady(): ShapeSet | null {
  return ready;
}
