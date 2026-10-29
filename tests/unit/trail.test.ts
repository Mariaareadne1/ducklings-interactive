import { describe, expect, test } from 'vitest';
import { FIRST_GAP, SPACING, Trail, followerOffset, linePositions, slotS, spacingScale } from '../../src/ducks/trail';

/** Walk the leader along an S-curve and record her trail. */
function sCurve(): { trail: Trail; leaderS: number } {
  const trail = new Trail(-4, 0);
  let leaderS = 0;
  for (let i = 1; i <= 400; i++) {
    const t = i / 400;
    leaderS = trail.push(-4 + 8 * t, 1.6 * Math.sin(t * Math.PI * 2));
  }
  return { trail, leaderS };
}

describe('trail', () => {
  test('arc length grows with the distance walked', () => {
    const trail = new Trail(0, 0);
    trail.push(3, 0);
    trail.push(3, 4);
    expect(trail.end).toBeCloseTo(7, 6);
  });

  test('ignores jitter smaller than a breadcrumb', () => {
    const trail = new Trail(0, 0);
    for (let i = 0; i < 50; i++) trail.push(0.001 * Math.sin(i), 0.001 * Math.cos(i));
    expect(trail.length).toBe(1);
  });

  test('followers sit exactly on the leader trail, never cutting the corners', () => {
    const { trail, leaderS } = sCurve();
    const line = linePositions(trail, leaderS, 12);
    for (const p of line) expect(trail.distanceTo(p.x, p.z)).toBeLessThan(1e-6);
    // a straight chord between two followers would leave the curve: the samples are on it
    const mid = trail.sample((slotS(trail, leaderS, 3) + slotS(trail, leaderS, 4)) / 2);
    expect(trail.distanceTo(mid.x, mid.z)).toBeLessThan(1e-6);
  });

  test('followers keep the right arc-length spacing', () => {
    const { trail, leaderS } = sCurve();
    for (let i = 0; i < 12; i++) expect(leaderS - slotS(trail, leaderS, i)).toBeCloseTo(FIRST_GAP + i * SPACING, 6);
    expect(followerOffset(3)).toBeCloseTo(FIRST_GAP + 3 * SPACING, 9);
  });

  test('follower order matches drawing order (index 0 nearest mum)', () => {
    const { trail, leaderS } = sCurve();
    const s = Array.from({ length: 6 }, (_, i) => slotS(trail, leaderS, i));
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThan(s[i - 1]);
  });

  test('a follower faces along the trail', () => {
    const trail = new Trail(0, 0);
    for (let i = 1; i <= 50; i++) trail.push(i * 0.1, 0);
    expect(trail.sample(2).heading).toBeCloseTo(0, 6);
    const up = new Trail(0, 0);
    for (let i = 1; i <= 50; i++) up.push(0, -i * 0.1);
    expect(up.sample(2).heading).toBeCloseTo(Math.PI / 2, 6);
  });

  test('slots never fall before the start of the trail', () => {
    const trail = new Trail(1, 1);
    trail.push(1.5, 1);
    expect(slotS(trail, trail.end, 5)).toBe(trail.start);
    const p = trail.sample(slotS(trail, trail.end, 5));
    expect([p.x, p.z]).toEqual([1, 1]);
  });

  test('the line stretches when hurrying and bunches when stopped', () => {
    expect(spacingScale(0, 0.95)).toBeLessThan(spacingScale(0.95, 0.95));
    expect(spacingScale(1.6, 0.95)).toBeGreaterThan(spacingScale(0.95, 0.95));
    expect(spacingScale(0.95, 0.95)).toBeCloseTo(1, 6);
  });

  test('reset keeps arc length running and pruning keeps the newest crumbs', () => {
    const { trail, leaderS } = sCurve();
    trail.reset(4, 0);
    expect(trail.start).toBeCloseTo(leaderS, 6);
    const t2 = new Trail(0, 0);
    for (let i = 1; i <= 1000; i++) t2.push(i * 0.05, 0);
    t2.prune(40);
    expect(t2.start).toBeLessThanOrEqual(40);
    expect(t2.length).toBeLessThan(400);
    expect(t2.end).toBeCloseTo(50, 6);
  });
});
