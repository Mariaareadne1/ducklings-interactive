// Filmstrip of one action in the app camera, stepping the simulation by hand.
// node scripts/strip.mjs <prefix> <creatureId> <action> [frames] [every] [crop]   (uses ?showcase)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ready } from './shapes.mjs';

const [prefix = 'strip', id = 'koi1', action = 'leap', frames = '8', every = '15', crop = '420'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5366/?${process.env.POND_QUERY ?? 'showcase'}`);
await ready(page);
await page.waitForTimeout(1500);
await page.evaluate(({ id, action }) => {
  const p = window.__pond;
  p.engine.stop();
  for (let i = 0; i < 30; i++) p.engine.tick(1 / 60);
  if (action.startsWith('come:')) {
    const [, x, z] = action.split(':').map(Number);
    p.engine.pond.fishCome(id, x, z);
  } else if (action === 'feed') {
    const c = p.engine.pond.get(id).controller;
    p.engine.pond.feed(c.x + 2, c.z + 0.5);
  } else if (action === 'rain') p.engine.pond.rain(6);
  else if (action === 'breeze') p.engine.pond.startBreeze(8);
  else p.app.act(action, id);
}, { id, action });
const files = [];
for (let f = 0; f < Number(frames); f++) {
  const pos = await page.evaluate(({ id, n }) => {
    const p = window.__pond;
    for (let i = 0; i < n; i++) p.engine.tick(1 / 60);
    const v = p.engine.pond.get(id)?.view;
    if (!v) return null;
    const q = v.root.position.clone().project(p.engine.camera);
    return { x: (q.x + 1) / 2 * innerWidth, y: (1 - q.y) / 2 * innerHeight, state: p.engine.pond.get(id).controller.state };
  }, { id, n: f === 0 ? 1 : Number(every) });
  const file = `artifacts/${prefix}-${f}.png`;
  const size = Number(crop);
  const c = pos ?? { x: 720, y: 450 };
  await page.screenshot({ path: file, clip: { x: Math.max(0, Math.min(1440 - size, c.x - size / 2)), y: Math.max(0, Math.min(900 - size * 0.7, c.y - size * 0.4)), width: size, height: Math.round(size * 0.7) } });
  files.push(file);
  process.stdout.write(`${pos?.state ?? '-'} `);
}
await browser.close();
const ff = (await import('ffmpeg-static')).default;
const n = files.length;
execFileSync(ff, ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}xstack=inputs=${n}:layout=${files.map((_, i) => `${(i % 4) * Number(crop)}_${Math.floor(i / 4) * Math.round(Number(crop) * 0.7)}`).join('|')}`, `artifacts/${prefix}.png`]);
console.log(`\nartifacts/${prefix}.png`);
