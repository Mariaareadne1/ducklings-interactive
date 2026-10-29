// Draws a shape and captures the reveal frame by frame (deterministic stepping).
// node scripts/draw.mjs <prefix> <fish|duck|lily|frog> [cx] [cy] [scale] [query]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SHAPES, ready } from './shapes.mjs';

const [prefix = 'draw', kind = 'fish', cx = '760', cy = '470', sc = '1', query = 'empty'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(`http://localhost:5392/?${query}`);
await ready(page);
await page.waitForTimeout(400);
const pts = SHAPES[kind](Number(cx), Number(cy), Number(sc));
await page.mouse.move(pts[0][0], pts[0][1]);
await page.mouse.down();
for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
await page.screenshot({ path: `artifacts/${prefix}-0-drawn.png` });
await page.evaluate(() => window.__ducks.engine.stop());
await page.mouse.up();
let frame = 0;
for (const target of [6, 18, 30, 42, 54, 72, 100, 160]) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__ducks.engine.tick(1 / 60); }, target - frame);
  frame = target;
  await page.screenshot({ path: `artifacts/${prefix}-f${String(frame).padStart(3, '0')}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => ({ doc: window.__ducks.store.doc.creatures.slice(-1), instead: window.__ducks.store.get().instead, toast: window.__ducks.store.get().toast }))));
await browser.close();
