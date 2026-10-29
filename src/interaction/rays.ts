import * as THREE from 'three';
import { bridgeLocal, deckHeight, edgeDistance, groundHeight, onBridge, pondSDF, WATER_Y } from '../scene/park';

/**
 * Exact screen-to-world placement against analytic surfaces: the bridge
 * deck, the water plane and the lawn's height function.
 */

/** March the view ray until it dips under the ground, then bisect. Null if it never does. */
export function raycastGround(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance = 300, target = new THREE.Vector3()): THREE.Vector3 | null {
  const above = (t: number) => origin.y + dir.y * t - groundHeight(origin.x + dir.x * t, origin.z + dir.z * t);
  let prev = 0;
  if (above(prev) < 0) return null;
  let t = 0.05;
  while (t < maxDistance) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) < 0) hi = mid;
        else lo = mid;
      }
      return target.copy(origin).addScaledVector(dir, hi);
    }
    prev = t;
    t += 0.04 + t * 0.012;
  }
  return null;
}

/** Intersect the view ray with the water plane (y = WATER_Y). */
export function raycastWater(origin: THREE.Vector3, dir: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 | null {
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (WATER_Y - origin.y) / dir.y;
  return t > 0 ? target.copy(origin).addScaledVector(dir, t) : null;
}

export type Surface = 'water' | 'land' | 'paper';

export interface SurfaceHit {
  surface: Surface;
  point: THREE.Vector3;
  /** The hit is on the bridge deck. */
  deck: boolean;
}

/** Where the ray meets the bridge deck, if it does. */
export function raycastDeck(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
  if (Math.abs(dir.y) < 1e-6) return null;
  let y = 0.4;
  let p = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    const t = (y - origin.y) / dir.y;
    if (t <= 0) return null;
    p = origin.clone().addScaledVector(dir, t);
    y = deckHeight(bridgeLocal(p.x, p.z)[0]);
  }
  return onBridge(p.x, p.z, -0.05) ? p : null;
}

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();

export function rayFromClient(camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): THREE.Ray {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray;
}

/** What is under a screen point: open water, the bank, or paper outside the tile. */
export function surfaceAt(camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): SurfaceHit {
  const r = rayFromClient(camera, rect, clientX, clientY);
  const d = raycastDeck(r.origin, r.direction);
  if (d) return { surface: 'land', point: d, deck: true };
  const w = raycastWater(r.origin, r.direction);
  if (w && pondSDF(w.x, w.z) < 0 && edgeDistance(w.x, w.z) > 0.2) return { surface: 'water', point: w, deck: false };
  const g = raycastGround(r.origin, r.direction);
  if (g && edgeDistance(g.x, g.z) > 0.2 && pondSDF(g.x, g.z) >= 0) return { surface: 'land', point: g, deck: false };
  return { surface: 'paper', point: w ?? g ?? new THREE.Vector3(), deck: false };
}

export function screenToWater(camera: THREE.PerspectiveCamera, rect: DOMRect | { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): THREE.Vector3 | null {
  const r = rayFromClient(camera, rect, clientX, clientY);
  return raycastWater(r.origin, r.direction);
}

export function screenToGround(camera: THREE.PerspectiveCamera, rect: DOMRect | { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): THREE.Vector3 | null {
  const r = rayFromClient(camera, rect, clientX, clientY);
  return raycastGround(r.origin, r.direction);
}
