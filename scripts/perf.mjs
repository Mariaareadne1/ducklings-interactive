// Frame-time benchmark: renders frames back-to-back with a GPU sync each frame.
// DPR=2 node scripts/perf.mjs
import { chromium } from '@playwright/test';
import { loadavg } from 'node:os';

console.log('load average', loadavg().map((l) => l.toFixed(2)).join(' '));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
for (const [w, h, n] of [[1440, 900, 0], [1440, 900, 15], [1920, 1080, 15]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  await page.goto('http://localhost:5366/?showcase');
  await page.waitForFunction(() => window.__pond && !window.__pond.store.get().loading, null, { timeout: 90000 });
  const ms = await page.evaluate(async (n) => {
    const p = window.__pond;
    if (n === 0) p.app.loadDoc({ version: 1, creatures: [] });
    else for (const id of ['koi1', 'duck1', 'frog2']) p.app.duplicate(id);
    await new Promise((r) => setTimeout(r, 1500));
    p.engine.stop();
    p.engine.adaptive = false;
    const gl = p.engine.renderer.getContext();
    for (let i = 0; i < 30; i++) p.engine.tick(1 / 60);
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < 150; i++) {
      p.engine.tick(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    return { ms: (performance.now() - t0) / 150, count: p.store.doc.creatures.length };
  }, n);
  console.log(`${w}x${h} dpr${process.env.DPR ?? 1} creatures=${ms.count}: ${ms.ms.toFixed(2)} ms/frame (${(1000 / ms.ms).toFixed(0)} fps uncapped)`);
  await page.close();
}
await browser.close();
