import type { Page } from '@playwright/test';
import { circle, duck, ellipse, fish } from '../fixtures/drawings';
import type { Pt } from '../../src/interaction/stroke';

export async function openPond(page: Page, query = 'empty'): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__pond && !window.__pond.store.get().loading, null, { timeout: 90_000 });
}

export const strokes = {
  fish: (x: number, y: number, s = 1) => fish(x, y, s),
  duck: (x: number, y: number, s = 1) => duck(x, y, s),
  lily: (x: number, y: number, s = 1) => circle(x, y, 46 * s),
  frog: (x: number, y: number, s = 1) => ellipse(x, y, 22 * s, 18 * s, 0, 40),
};

export async function drawStroke(page: Page, pts: Pt[]): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

/** Where a world point is on screen (CSS px). */
export async function toScreen(page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y, z]) => {
    const p = window.__pond!;
    const v = p.engine.camera.position.clone().set(x, y, z).project(p.engine.camera);
    const r = p.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z]);
}

export async function creatures(page: Page) {
  return page.evaluate(() => window.__pond!.store.doc.creatures.map((c) => ({ ...c })));
}

export async function waitFormed(page: Page, id: string): Promise<void> {
  await page.waitForFunction((i) => window.__pond!.engine.pond.isFormed(i), id, { timeout: 60_000 });
}

export async function frame(page: Page, id: string) {
  return page.evaluate((i) => {
    const f = window.__pond!.engine.pond.frameOf(i);
    return f ? { x: f.x, y: f.y, z: f.z, heading: f.heading, pose: { ...f.pose } } : null;
  }, id);
}

export async function state(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate((i) => window.__pond!.engine.pond.get(i)?.controller.state, id);
}

/** Screen-space box of a creature's painted parts (CSS px). */
export async function screenBox(page: Page, id: string) {
  return page.evaluate((i) => {
    const p = window.__pond!;
    const b = p.engine.pond.get(i)!.view!.bounds();
    const cam = p.engine.camera;
    const rect = p.engine.canvas.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      const v = b.min.clone();
      if (k & 1) v.x = b.max.x;
      if (k & 2) v.y = b.max.y;
      if (k & 4) v.z = b.max.z;
      v.project(cam);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }, id);
}

/** Render a PNG through the app's capture path and measure its colours in the page. */
export async function captureStats(page: Page) {
  return page.evaluate(async () => {
    const blob = await window.__pond!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0, paper = 0, water = 0, grass = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      n++;
      if (r > 215 && g > 210 && b > 195 && Math.max(r, g, b) - Math.min(r, g, b) < 30) paper++;
      else if (b > r + 15 && g > r + 15) water++;
      else if (g > r + 10 && g > b + 25) grass++;
    }
    return { width: bmp.width, paper: paper / n, water: water / n, grass: grass / n, type: blob.type };
  });
}
