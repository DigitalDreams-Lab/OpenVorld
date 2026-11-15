#!/usr/bin/env node
// Redraw portraits.png (the 4x4 avatar sheet) with Codex image generation, at 512 px per cell.
//   node tools/portrait-sheet.mjs plan  <portraits.png> <characters.png> <workdir>
//   node tools/portrait-sheet.mjs run   <workdir> [--jobs 4]
//   node tools/portrait-sheet.mjs build <portraits.png> <workdir> <out.png> [--cell 512]
// Each job is a 2x2 grid of portraits (1024x1024, 512 px cells) on flat magenta. The reference of a person is the old
// portrait; the companion's reference is the redrawn Buzz sprite (front, standing) so the avatar matches the one in town.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/pngcodec.mjs';
import { cutCell } from './redraw-art.mjs';

const GRID = 1024, CELLS = 16, COLS = 4, PER = 4;      // 16 portraits, four jobs of 2x2
const jobName = (j, kind) => `portraits_${j}_${kind}.png`;

function fillMagenta(d) { for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 2] = 255; d[i + 3] = 255; } }

/** Copy `src` (w x h RGBA) into `dst` scaled to a 512 cell at (cx, cy), visible pixels only. */
function blitCell(dst, cx, cy, src, sw, sh, fit) {
  const cell = GRID / 2;
  let ox = 0, oy = 0, scale = cell / sw;
  if (fit) { scale = Math.min(cell / sw, cell / sh) * 0.86; ox = Math.round((cell - sw * scale) / 2); oy = Math.round(cell - sh * scale - cell * 0.06); }
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const sx = Math.floor((x - ox) / scale), sy = Math.floor((y - oy) / scale);
    if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
    const j = (sy * sw + sx) * 4; if (src[j + 3] < 8) continue;
    const i = ((cy + y) * GRID + cx + x) * 4; dst[i] = src[j]; dst[i + 1] = src[j + 1]; dst[i + 2] = src[j + 2];
  }
}

export function plan(portraitsFile, charactersFile, work) {
  const p = decodePng(fs.readFileSync(portraitsFile)), pc = p.width / COLS, ch = decodePng(fs.readFileSync(charactersFile)), cc = ch.width / 12;
  fs.mkdirSync(work, { recursive: true });
  for (let j = 0; j < CELLS / PER; j++) {
    const d = Buffer.alloc(GRID * GRID * 4); fillMagenta(d);
    for (let k = 0; k < PER; k++) {
      const idx = j * PER + k, cx = (k % 2) * (GRID / 2), cy = Math.floor(k / 2) * (GRID / 2);
      const cell = Buffer.alloc(pc * pc * 4);
      if (idx === 1) {                                  // the companion: the new sprite, front, standing (column 2 of row 1)
        const s = Buffer.alloc(cc * cc * 4);
        for (let y = 0; y < cc; y++) for (let x = 0; x < cc; x++) ch.data.copy(s, (y * cc + x) * 4, ((1 * cc + y) * ch.width + 2 * cc + x) * 4, ((1 * cc + y) * ch.width + 2 * cc + x) * 4 + 4);
        blitCell(d, cx, cy, s, cc, cc, true);
      } else {
        for (let y = 0; y < pc; y++) for (let x = 0; x < pc; x++) p.data.copy(cell, (y * pc + x) * 4, (((Math.floor(idx / COLS)) * pc + y) * p.width + (idx % COLS) * pc + x) * 4, (((Math.floor(idx / COLS)) * pc + y) * p.width + (idx % COLS) * pc + x) * 4 + 4);
        blitCell(d, cx, cy, cell, pc, pc, false);
      }
    }
    fs.writeFileSync(`${work}/${jobName(j, 'ref')}`, encodePng({ width: GRID, height: GRID, data: d }));
  }
  console.log(`${CELLS / PER} portrait references in ${work}`);
}

const prompt = (j) => `Use your image generation tool (edit mode, with ${jobName(j, 'ref')} attached as the reference image) to redraw these four game character avatar portraits.
The reference is a 2x2 grid (each cell 512x512) on flat magenta (#FF00FF), reading left to right, top to bottom. Each cell is ONE head-and-shoulders avatar of a character in a cosy pixel-art RPG. (If a cell shows a small full-body bee creature, make its avatar a charming head-and-upper-body portrait of that same bee: round fuzzy yellow-and-brown body, big friendly eyes, pink cheeks, two antennae with round tips, light-blue wings.)
Redraw EVERY cell as a much higher quality portrait: crisp, clean, richly detailed pixel art with a dark outline, a visible friendly face with eyes, brows and a mouth, nicely shaded hair, hat and clothes. Keep exactly the same character in each cell: the same hair, hat, beard, glasses, skin tone, outfit and colours, the same framing and the same position inside the cell, facing the viewer. Do not mix characters up, do not change a cell's identity. No grid lines, no text, no shadows, no ground. Keep the background flat pure magenta #FF00FF.
Output exactly one ${GRID}x${GRID} PNG. Save it into the current folder as ${jobName(j, 'out')} (copy the generated file there), then reply with that file name only.`;

function runJob(work, j) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-C', work, '--sandbox', 'workspace-write', '-i', `${work}/${jobName(j, 'ref')}`, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
    child.stdin.end(prompt(j));
    child.on('close', (code) => { fs.writeFileSync(`${work}/portraits_${j}.log`, log); resolve(code === 0 && fs.existsSync(`${work}/${jobName(j, 'out')}`)); });
  });
}

export async function run(work, concurrency = 4) {
  const todo = [0, 1, 2, 3].filter((j) => !fs.existsSync(`${work}/${jobName(j, 'out')}`));
  console.log(`${todo.length} job(s) to draw`);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < todo.length) { const j = todo[next++], t0 = Date.now(), ok = await runJob(work, j); console.log(`job ${j}: ${ok ? 'drawn' : 'FAILED'} in ${Math.round((Date.now() - t0) / 1000)}s`); } }));
}

export function build(oldFile, work, outFile, cell = 512) {
  const old = decodePng(fs.readFileSync(oldFile)), oc = old.width / COLS, W = COLS * cell, H = COLS * cell;
  const sheet = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  for (let idx = 0; idx < CELLS; idx++) {
    const j = Math.floor(idx / PER), k = idx % PER, cx = idx % COLS * cell, cy = Math.floor(idx / COLS) * cell, file = `${work}/${jobName(j, 'out')}`;
    let px;
    if (fs.existsSync(file)) {
      const drawn = decodePng(fs.readFileSync(file)), g = drawn.width / 2, x0 = (k % 2) * g, y0 = Math.floor(k / 2) * g;
      px = cutCell(drawn, { x0, y0, x1: x0 + g, y1: y0 + g }, cell, false);
    } else {
      console.log(`portrait ${idx}: not redrawn, old art enlarged`);
      px = Buffer.alloc(cell * cell * 4);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) old.data.copy(px, (y * cell + x) * 4, ((Math.floor(idx / COLS) * oc + Math.floor(y * oc / cell)) * old.width + (idx % COLS) * oc + Math.floor(x * oc / cell)) * 4, ((Math.floor(idx / COLS) * oc + Math.floor(y * oc / cell)) * old.width + (idx % COLS) * oc + Math.floor(x * oc / cell)) * 4 + 4);
    }
    for (let y = 0; y < cell; y++) px.copy(sheet.data, ((cy + y) * W + cx) * 4, y * cell * 4, (y + 1) * cell * 4);
  }
  fs.writeFileSync(outFile, encodePng(sheet)); console.log(`${outFile}: ${W}x${H}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2), flag = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  if (cmd === 'plan') plan(a[0], a[1], a[2]);
  else if (cmd === 'run') await run(a[0], +flag('--jobs', 4));
  else if (cmd === 'build') build(a[0], a[1], a[2], +flag('--cell', 512));
  else console.log('usage: plan | run | build (see the top of this file)');
}
