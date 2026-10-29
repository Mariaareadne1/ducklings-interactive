// Records the live canvas through the app's recorder, saves it, and inspects it with ffprobe/ffmpeg.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5366/?showcase');
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => window.__pond && window.__pond.engine.pond.isFormed('koi1'), null, { timeout: 90000 });
const out = await page.evaluate(async () => {
  const { recordCanvas } = await import('/src/capture/recorder.ts');
  const m = window.__pond;
  m.store.set({ uiHidden: true });
  setTimeout(() => m.app.act('leap', 'koi1'), 600);
  setTimeout(() => m.app.act('fly', 'duck1'), 1200);
  const rec = await recordCanvas(m.engine.canvas, { seconds: 4, ink: document.querySelector('svg.ink') });
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), type: rec.type, ext: rec.extension, ms: rec.durationMs };
});
const file = `artifacts/recording-test.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log('type', out.type, 'wall ms', out.ms.toFixed(0));
const probe = execFileSync(ffprobe.path, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration', '-of', 'default=nw=1', file]).toString();
console.log(probe.trim());
// frame luminance stats: blank or black frames would show here
const stats = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
void stats;
execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', file, '-vf', 'fps=2,scale=320:-1,tile=4x2', '-frames:v', '1', 'artifacts/recording-frames.png']);
console.log('frames -> artifacts/recording-frames.png');
await browser.close();
