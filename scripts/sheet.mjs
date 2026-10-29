// Tile images into a contact sheet: node scripts/sheet.mjs out.png cols scale img1 img2 ...
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';

const [out, cols = '4', scale = '0.5', ...imgs] = process.argv.slice(2);
const c = Number(cols);
const inputs = imgs.flatMap((f) => ['-i', f]);
const scaled = imgs.map((_, i) => `[${i}:v]scale=iw*${scale}:ih*${scale}[s${i}]`).join(';');
const layout = imgs.map((_, i) => `${(i % c) ? Array.from({ length: i % c }, (_, k) => `w${k}`).join('+') : '0'}_${Math.floor(i / c) ? Array.from({ length: Math.floor(i / c) }, (_, k) => `h${k * c}`).join('+') : '0'}`).join('|');
const filter = `${scaled};${imgs.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${imgs.length}:layout=${layout}:fill=white`;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', out]);
console.log(out);
