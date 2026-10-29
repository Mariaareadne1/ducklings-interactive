/** Pure 2D stroke processing: smoothing, decimation and reading intent from a doodle. */

export interface Pt {
  x: number;
  y: number;
}

export interface StrokeAnalysis {
  valid: boolean;
  reason?: 'short' | 'small';
  length: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  centroid: Pt;
  closed: boolean;
  /** Which way the drawn animal faces on screen: 1 = right, -1 = left. */
  facing: 1 | -1;
  /** Where the feet would be: bottom-centre of the drawing. */
  foot: Pt;
}

export const MIN_STROKE_LENGTH = 36;
export const MIN_STROKE_SIZE = 14;

export function strokeLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Drop points closer than minDist to the last kept one (keeps the final point). */
export function decimate(pts: readonly Pt[], minDist: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Centred moving average; endpoints stay fixed so the line does not shrink. */
export function smooth(pts: readonly Pt[], radius = 2): Pt[] {
  if (pts.length < 3) return pts.slice();
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) {
      sx += pts[k].x;
      sy += pts[k].y;
      n++;
    }
    return { x: sx / n, y: sy / n };
  });
}

export function analyzeStroke(pts: readonly Pt[]): StrokeAnalysis {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    cx += p.x; cy += p.y;
  }
  const n = Math.max(1, pts.length);
  const width = maxX - minX;
  const height = maxY - minY;
  const length = strokeLength(pts);
  const bbox = { minX, minY, maxX, maxY, width, height };
  const centroid = { x: cx / n, y: cy / n };
  const first = pts[0] ?? { x: 0, y: 0 };
  const last = pts[pts.length - 1] ?? first;
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < Math.max(18, 0.3 * Math.max(width, height));

  // Facing: a sheep's head is the highest bump at one end. Compare how the
  // stroke's upper band is distributed either side of centre; fall back on
  // the direction the line was drawn for open strokes and symmetric loops.
  const midX = minX + width / 2;
  let topBias = 0;
  let topCount = 0;
  const band = minY + height * 0.38;
  for (const p of pts) {
    if (p.y <= band) {
      topBias += (p.x - midX) * (band - p.y);
      topCount += band - p.y;
    }
  }
  const lean = topCount > 0 ? topBias / topCount / Math.max(1, width) : 0;
  let facing: 1 | -1;
  if (Math.abs(lean) > 0.06) facing = lean > 0 ? 1 : -1;
  else if (!closed && Math.abs(last.x - first.x) > 8) facing = last.x > first.x ? 1 : -1;
  else facing = 1;

  let reason: StrokeAnalysis['reason'];
  if (length < MIN_STROKE_LENGTH) reason = 'short';
  else if (Math.max(width, height) < MIN_STROKE_SIZE * 2 || Math.min(width, height) < MIN_STROKE_SIZE * 0.4) reason = 'small';

  return {
    valid: !reason,
    reason,
    length,
    bbox,
    centroid,
    closed,
    facing,
    foot: { x: centroid.x * 0.4 + midX * 0.6, y: maxY - height * 0.12 },
  };
}
