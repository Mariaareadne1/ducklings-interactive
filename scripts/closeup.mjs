// Close-ups of showroom ducks: node scripts/closeup.mjs <prefix> <index...> (needs the dev server)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [prefix = 'close', ...idx] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 700, height: 560 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(`${process.env.DUCKS_URL ?? 'http://localhost:5392/'}?showroom${process.env.Q ?? ""}`);
await page.waitForFunction(() => window.__ducks?.views?.length, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `artifacts/${prefix}-scene.png` });
for (const i of idx.length ? idx.map(Number) : [0, 1]) {
  for (const [label, az, el, dist] of [['front', 0.7, 0.3, 1.0], ['side', 1.7, 0.35, 1.0], ['top', 0.4, 1.2, 1.0], ['back', 3.7, 0.4, 1.0]]) {
    await page.evaluate(({ i, az, el, dist }) => {
      const { engine, views } = window.__ducks;
      const v = views[i];
      const d = dist * v.scale * (v.kind === 'mother' ? 1.6 : 1.2);
      const p = v.root.position;
      const a = v.root.rotation.y + az;
      const c = { x: p.x + Math.cos(a) * Math.cos(el) * d, y: p.y + 0.1 * v.scale + Math.sin(el) * d, z: p.z - Math.sin(a) * Math.cos(el) * d };
      engine.stop();
      engine.debugView(c, { x: p.x, y: p.y + 0.1 * v.scale, z: p.z }, 30);
      engine.tick(1 / 60);
    }, { i, az, el, dist });
    await page.screenshot({ path: `artifacts/${prefix}-${i}-${label}.png` });
  }
}
await browser.close();
