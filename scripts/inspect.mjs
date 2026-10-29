// Close-ups of each creature from four angles (ids from ?showcase).
// node scripts/inspect.mjs <prefix> [ids...]   (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [prefix = 'inspect', ...only] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(`${process.env.DUCKS_URL ?? 'http://localhost:5392/'}?${process.env.POND_QUERY ?? 'showcase'}`);
await page.waitForFunction(() => window.__ducks && !window.__ducks.store.get().loading, null, { timeout: 90000 });
await page.evaluate(() => {
  const p = window.__ducks;
  p.store.set({ uiHidden: true });
  p.views = Object.fromEntries(p.engine.pond.ids().map((id) => [id, p.engine.pond.get(id).view]));
});
await page.waitForTimeout(800);
await page.screenshot({ path: `artifacts/${prefix}-scene.png` });
const names = only.length ? only : await page.evaluate(() => Object.keys(window.__ducks.views));
for (const name of names) {
  for (const [label, az, el, dist] of [['front', 0.6, 0.35, 2.6], ['side', 1.9, 0.5, 2.6], ['top', 0.3, 1.25, 2.4], ['back', 3.6, 0.45, 2.6]]) {
    await page.evaluate(({ name, az, el, dist }) => {
      const { engine, views } = window.__ducks;
      const v = views[name];
      const p = v.root.position;
      const h = v.root.rotation.y;
      const a = h + az;
      const c = { x: p.x + Math.cos(a) * Math.cos(el) * dist, y: p.y + 0.25 + Math.sin(el) * dist, z: p.z - Math.sin(a) * Math.cos(el) * dist };
      engine.stop();
      engine.debugView(c, { x: p.x, y: p.y + 0.2, z: p.z }, 30);
      engine.tick(1 / 60);
    }, { name, az, el, dist });
    await page.screenshot({ path: `artifacts/${prefix}-${name}-${label}.png` });
  }
}
await browser.close();
console.log('done', names.join(' '));
