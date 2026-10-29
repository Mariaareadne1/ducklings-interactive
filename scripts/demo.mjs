// Scripted ~24 s demo, recorded by the app's own compositing recorder (pen line included).
// draw a fish -> it blooms in and swims -> draw a lily pad -> the fish hides under it ->
// draw a duck -> it dabbles -> a frog hops onto the pad -> feed -> rain
// node scripts/demo.mjs [width] [height]  ->  artifacts/pond-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fishPath, duckPath, loopPath } from './shapes.mjs';

const [W = '1600', H = '900'] = process.argv.slice(2);
const w = Number(W), h = Number(H);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5392/?empty');
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => window.__ducks && !window.__ducks.store.get().loading, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const sleep = (ms) => page.waitForTimeout(ms);
const screen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const p = window.__ducks, v = p.engine.camera.position.clone().set(x, y, z).project(p.engine.camera);
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}, [x, y, z]);
const k = h / 900; // drawings scale with the viewport

async function trace(pts, ms) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    await page.mouse.move(...p);
    await sleep(ms / pts.length);
  }
  await page.mouse.up();
}
const last = () => page.evaluate(() => window.__ducks.store.doc.creatures.at(-1).id);

await page.evaluate(() => {
  const p = window.__ducks;
  p.store.set({ uiHidden: true });
  p.engine.adaptive = false;
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = import('/src/capture/recorder.ts').then(({ recordCanvas }) =>
    recordCanvas(p.engine.canvas, { seconds: 40, ink: document.querySelector('svg.ink'), until: window.__demoDone }),
  );
});

await sleep(1300);
let [x, y] = await screen(-1.5, 0, 0.6);
await trace(fishPath(x, y, 1.05 * k), 1100);                 // a fish
const fish = await last();
await sleep(2200);                                           // it blooms in and swims
[x, y] = await screen(-5.8, 0, 3.0);
await trace(loopPath(x, y, 46 * k, 42 * k), 900);             // a lily pad by the near-left shore
const pad = await last();
await sleep(800);
await page.evaluate(([f]) => window.__ducks.app.act('hide', f), [fish]);   // the fish slips under it
await sleep(2600);
[x, y] = await screen(3.2, 0, -2.6);
await trace(duckPath(x, y, 1.0 * k), 1000);                  // a duck
const duck = await last();
await sleep(1500);
await page.evaluate(([d]) => window.__ducks.app.act('dabble', d), [duck]);
await sleep(1500);
[x, y] = await screen(-9.4, 0.45, 6.6);
await trace(loopPath(x, y, 20 * k, 16 * k), 600);             // a frog on the bank
const frog = await last();
await sleep(1400);
await page.evaluate(([p]) => window.__ducks.app.act('invite', p), [pad]);  // it hops onto the pad
await sleep(2000);
await page.evaluate(() => window.__ducks.engine.pond.feed(-2.2, 1.6));     // feed: the fish comes out
await sleep(2700);
await page.evaluate(([f]) => { window.__ducks.engine.pond.rain(10); window.__ducks.app.act('croak', f); }, [frog]);  // rain
await sleep(3600);
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type };
});
const file = `artifacts/pond-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`, JSON.stringify(await page.evaluate(() => window.__ducks.store.doc.creatures.map((c) => [c.kind, c.perch ?? '']))));
await browser.close();
