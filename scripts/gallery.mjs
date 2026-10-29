// Regenerates the documentation media in docs/media from the running dev server.
// node scripts/gallery.mjs [--no-demo]
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const run = (args) => execFileSync('node', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const ff = (args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
const jpg = (src, out, extra = []) => ff(['-i', src, ...extra, '-q:v', '3', out]);
mkdirSync('docs/media', { recursive: true });

// the whole pond, and on a phone
run(['scripts/shoot.mjs', 'g-pond', 'showcase', '1600', '1000', '6000']);
jpg('artifacts/g-pond.png', 'docs/media/01-pond.jpg');
run(['scripts/shoot.mjs', 'g-mobile', 'showcase', '390', '844', '6000']);
jpg('artifacts/g-mobile.png', 'docs/media/09-mobile.jpg');

// close-ups: each creature from the front-three-quarter view
run(['scripts/inspect.mjs', 'g-close', 'koi1', 'koi3', 'duck1', 'ling1', 'frog2', 'pad1']);
ff(['-i', 'artifacts/g-close-koi3-front.png', '-i', 'artifacts/g-close-duck1-front.png', '-i', 'artifacts/g-close-frog2-front.png', '-i', 'artifacts/g-close-pad1-front.png',
  '-filter_complex', '[0]scale=600:-1[a];[1]scale=600:-1[b];[2]scale=600:-1[c];[3]scale=600:-1[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', '-q:v', '3', 'docs/media/02-creatures.jpg']);

// the reveal: a fish blooming into the water, frame by frame
run(['scripts/draw.mjs', 'g-bloom', 'fish', '700', '470', '1']);
run(['scripts/montage.mjs', 'artifacts/g-bloom.png', '520,340,360,240', '6', 'artifacts/g-bloom-0-drawn.png', 'artifacts/g-bloom-f018.png', 'artifacts/g-bloom-f030.png', 'artifacts/g-bloom-f042.png', 'artifacts/g-bloom-f054.png', 'artifacts/g-bloom-f100.png']);
jpg('artifacts/g-bloom.png', 'docs/media/03-bloom-strip.jpg');
run(['scripts/draw.mjs', 'g-brush', 'frog', '430', '660', '1']);
run(['scripts/montage.mjs', 'artifacts/g-brush.png', '330,590,200,140', '6', 'artifacts/g-brush-0-drawn.png', 'artifacts/g-brush-f018.png', 'artifacts/g-brush-f030.png', 'artifacts/g-brush-f042.png', 'artifacts/g-brush-f054.png', 'artifacts/g-brush-f100.png']);
jpg('artifacts/g-brush.png', 'docs/media/04-brush-strip.jpg');

// actions as filmstrips
for (const [name, id, action, frames, every, crop] of [
  ['05-leap', 'koi1', 'leap', 8, 8, 300],
  ['06-fly', 'duck1', 'fly', 8, 54, 520],
  ['07-hop', 'frog2', 'hop', 8, 9, 300],
  ['08-dabble', 'duck1', 'dabble', 8, 18, 260],
]) {
  run(['scripts/strip.mjs', `g-${name}`, id, action, String(frames), String(every), String(crop)]);
  jpg(`artifacts/g-${name}.png`, `docs/media/${name}-strip.jpg`);
}

if (!process.argv.includes('--no-demo')) {
  run(['scripts/demo.mjs', '1600', '900']);
  const src = existsSync('artifacts/pond-demo.mp4') ? 'artifacts/pond-demo.mp4' : 'artifacts/pond-demo.webm';
  ff(['-i', src, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', 'docs/media/pond-demo-720p.mp4']);
  ff(['-i', src, '-vf', 'fps=1,scale=400:-1,tile=5x5', '-frames:v', '1', '-q:v', '4', 'docs/media/demo-contact-sheet.jpg']);
}
console.log('docs/media updated');
