// Film leading: node scripts/lead.mjs <prefix> "x,z;x,z;..." [frames] [every] [query]
// Clicks each waypoint (world x,z) in Lead mode when mum arrives, grabbing a frame every `every` seconds.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [prefix = 'lead', wps = '2,1;4,-2', frames = '16', every = '0.6', query = ''] = process.argv.slice(2);
const waypoints = wps.split(';').map((p) => p.split(',').map(Number));
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(`${process.env.DUCKS_URL ?? 'http://localhost:5392/'}?${query}`);
await page.waitForFunction(() => window.__ducks && !window.__ducks.store.get().loading, null, { timeout: 90000 });
await page.evaluate(() => {
  const d = window.__ducks;
  d.store.set({ tool: 'lead', uiHidden: true });
  d.engine.stop();
  d.engine.fixedStep = 1 / 60;
  window.__step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) d.engine.tick(1 / 60); };
  window.__screen = (x, z) => {
    const v = new d.engine.camera.position.constructor(x, 0.3, z).project(d.engine.camera);
    const r = d.engine.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  };
});
await page.evaluate(() => window.__step(2));
let wi = 0;
let shot = 0;
const log = [];
for (let f = 0; f < Number(frames); f++) {
  const snap = await page.evaluate(() => window.__ducks.engine.flock.snapshot());
  if (wi < waypoints.length && (!snap.mother.moving || f === 0)) {
    const [x, z] = waypoints[wi++];
    const [sx, sy] = await page.evaluate(([x, z]) => window.__screen(x, z), [x, z]);
    await page.mouse.click(sx, sy);
  }
  await page.evaluate((s) => window.__step(s), Number(every));
  await page.screenshot({ path: `artifacts/${prefix}-${String(shot++).padStart(2, '0')}.png` });
  log.push(`${f} mum ${snap.mother.x.toFixed(2)},${snap.mother.z.toFixed(2)} ${snap.mother.swimming ? 'swim' : snap.mother.deck ? 'deck' : 'land'} | ` + snap.ducklings.map((d) => `${d.mode[0]}${d.swimming ? '~' : ''}${d.trailDist.toFixed(2)}`).join(' '));
}
console.log(log.join('\n'));
await browser.close();
