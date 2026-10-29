import { describe, expect, test } from 'vitest';
import { findPath, passable, nearestFree, WALK_SPEED, SWIM_SPEED } from '../../src/ducks/nav';
import { BENCH, FLOWERBED, TREES, benchSDF, flowerbedSDF, gentleness, obstacleSDF, onBridge, pondSDF } from '../../src/scene/park';

const len = (pts: { x: number; z: number }[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

describe('pathing', () => {
  test('walks around the bench, the trees and the flowerbed', () => {
    for (const [a, b] of [
      [{ x: BENCH.x - 1.6, z: BENCH.z - 0.9 }, { x: BENCH.x + 1.5, z: BENCH.z + 1.0 }],
      [{ x: FLOWERBED.x - 2.4, z: FLOWERBED.z }, { x: FLOWERBED.x + 2.4, z: FLOWERBED.z }],
      [{ x: TREES[1].x - 1, z: TREES[1].z - 0.5 }, { x: TREES[1].x + 1, z: TREES[1].z + 0.5 }],
    ]) {
      const path = findPath({ ...a, deck: false }, { ...b, deck: false });
      expect(path.complete).toBe(true);
      for (const p of path.points) {
        expect(benchSDF(p.x, p.z)).toBeGreaterThan(0.05);
        expect(flowerbedSDF(p.x, p.z)).toBeGreaterThan(0);
        expect(obstacleSDF(p.x, p.z)).toBeGreaterThan(0);
      }
    }
  });

  test('consecutive points are close together (no teleporting)', () => {
    const path = findPath({ x: -6, z: 5, deck: false }, { x: 6, z: 3, deck: false });
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.2);
    }
  });

  test('crosses the pond over the bridge rather than swimming the steep side', () => {
    // from the near lawn to the far strip behind the waist
    const path = findPath({ x: -1.3, z: 0.6, deck: false }, { x: -0.3, z: -5.0, deck: false });
    expect(path.complete).toBe(true);
    expect(path.points.some((p) => p.deck)).toBe(true);
    for (const p of path.points) if (!p.deck) expect(pondSDF(p.x, p.z)).toBeGreaterThan(-0.05);
  });

  test('gets into and out of the water only along the gentle bank', () => {
    const into = findPath({ x: 4.5, z: 3.2, deck: false }, { x: 4.0, z: -3.0, deck: false });
    expect(into.complete).toBe(true);
    let changes = 0;
    for (let i = 1; i < into.points.length; i++) {
      const a = into.points[i - 1], b = into.points[i];
      const wa = !a.deck && pondSDF(a.x, a.z) < 0, wb = !b.deck && pondSDF(b.x, b.z) < 0;
      if (wa !== wb) {
        changes++;
        expect(gentleness(b.x, b.z)).toBeGreaterThan(0.3);
      }
    }
    expect(changes).toBe(1);
  });

  test('swims across when that is quicker than walking round', () => {
    // two points on the gentle shore of the big lobe, far apart along it: walking the sand is fine,
    // but from the near shore to the middle of the lobe the only way is to swim
    const path = findPath({ x: 3.0, z: 1.6, deck: false }, { x: 5.5, z: -2.0, deck: false });
    expect(path.complete).toBe(true);
    expect(path.points.some((p) => !p.deck && pondSDF(p.x, p.z) < -0.3)).toBe(true);
    expect(SWIM_SPEED).toBeLessThan(WALK_SPEED);
  });

  test('a swimmer can pass under the bridge between the lobes', () => {
    const path = findPath({ x: -4.3, z: -3.3, deck: false }, { x: 3.5, z: -2.6, deck: false });
    expect(path.complete).toBe(true);
    for (const p of path.points) expect(p.deck).toBe(false);
    expect(path.points.some((p) => onBridge(p.x, p.z))).toBe(true);
  });

  test('goals inside obstacles or off the tile are moved to the nearest free spot', () => {
    const p = nearestFree(TREES[0].x, TREES[0].z);
    expect(passable(p.x, p.z)).toBe(true);
    const far = findPath({ x: 0, z: 4, deck: false }, { x: 30, z: 4, deck: false });
    const end = far.points[far.points.length - 1];
    expect(passable(end.x, end.z)).toBe(true);
    expect(len(far.points)).toBeGreaterThan(5);
  });
});
