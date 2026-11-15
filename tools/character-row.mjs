#!/usr/bin/env node
// Put a freshly drawn character into one row of characters.png.
//   node tools/character-row.mjs row <characters.png> <row> <drawn.png> [--cell 128]
//   node tools/character-row.mjs plan|run|build ...   redraw every character of the sheet with Codex image generation
// <drawn.png> is a 1024x1024 picture on flat magenta: a 4x4 grid of 256 px cells, one row per view (front, back, left,
// right) and the first three columns the three animation frames. The magenta becomes transparency, every cell is
// halved to the sheet's cell size, and each view is placed with ONE shift for all its frames (the body stays put while
// the wings move), centred horizontally and standing on the same foot line.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/pngcodec.mjs';
import { cutCell } from './redraw-art.mjs';

const VIEWS = 4, FRAMES = 3;       // down, up, left, right x frame 0, 1, 2 (the order of the sheet's cells)

export function placeRow(sheet, row, drawn, cell = 128) {
  const grid = drawn.width / 4;
  for (let v = 0; v < VIEWS; v++) {
    const cells = [], stats = [];
    for (let f = 0; f < FRAMES; f++) {
      const img = cutCell(drawn, { x0: f * grid, y0: v * grid, x1: (f + 1) * grid, y1: (v + 1) * grid }, cell, false);
      let x0 = cell, x1 = -1, y1 = -1, m = 0, mx = 0;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const a = img[(y * cell + x) * 4 + 3]; if (a > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); m += a; mx += a * x; } }
      cells.push(img); stats.push({ cx: m ? mx / m : cell / 2, bottom: y1 });
    }
    const med = (k) => [...stats.map((s) => s[k])].sort((a, b) => a - b)[1];
    const dx = Math.round(cell / 2 - med('cx')), dy = Math.round(cell - Math.round(cell * 0.078) - med('bottom'));
    for (let f = 0; f < FRAMES; f++) {
      const col = v * FRAMES + f, ox = col * cell, oy = row * cell;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) sheet.data.fill(0, ((oy + y) * sheet.width + ox + x) * 4, ((oy + y) * sheet.width + ox + x) * 4 + 4);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= cell || sy >= cell) continue;
        cells[f].copy(sheet.data, ((oy + y) * sheet.width + ox + x) * 4, (sy * cell + sx) * 4, (sy * cell + sx) * 4 + 4);
      }
    }
  }
  return sheet;
}

// ---------- redrawing the whole character sheet with an image model (see tools/redraw-art.mjs for the same idea) ----------
const GRID = 1024, CHAR_ROWS = 16, CHAR_COLS = 12;
const jobName = (row, kind) => `char_${String(row).padStart(2, '0')}_${kind}.png`;

/** One reference picture per character row: the 12 cells as a 4x4 grid (a row per view, a column per frame) on magenta. */
export function plan(sheetFile, work, skip = [1]) {
  const sheet = decodePng(fs.readFileSync(sheetFile)), cell = sheet.width / CHAR_COLS, g = GRID / 4;
  fs.mkdirSync(work, { recursive: true });
  const rows = [];
  for (let r = 0; r < CHAR_ROWS; r++) {
    if (skip.includes(r)) continue;
    const d = Buffer.alloc(GRID * GRID * 4);
    for (let i = 0; i < GRID * GRID; i++) { d[i * 4] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
    for (let v = 0; v < 4; v++) for (let f = 0; f < 3; f++) {
      const sx0 = (v * 3 + f) * cell, sy0 = r * cell;
      for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
        const sx = sx0 + Math.floor(x * cell / g), sy = sy0 + Math.floor(y * cell / g), j = (sy * sheet.width + sx) * 4, i = ((v * g + y) * GRID + f * g + x) * 4;
        if (sheet.data[j + 3] > 8) { d[i] = sheet.data[j]; d[i + 1] = sheet.data[j + 1]; d[i + 2] = sheet.data[j + 2]; }
      }
    }
    fs.writeFileSync(`${work}/${jobName(r, 'ref')}`, encodePng({ width: GRID, height: GRID, data: d }));
    rows.push(r);
  }
  fs.writeFileSync(`${work}/rows.json`, JSON.stringify(rows));
  console.log(`${rows.length} character references in ${work}`);
}

const prompt = (row) => `Use your image generation tool (edit mode, with ${jobName(row, 'ref')} attached as the reference image) to redraw this game character sprite sheet.
The reference is a 4x4 grid (each cell 256x256) on flat magenta (#FF00FF). It shows ONE character in a walk cycle: row 1 = seen from the front, row 2 = from behind, row 3 = facing left, row 4 = facing right. Columns 1 and 2 are the two stride poses and column 3 is the standing pose. Column 4 is empty.
Redraw EVERY cell at much higher quality: crisp, clean, richly detailed pixel art with a dark outline, the same character with exactly the same design, outfit, hair, colours, proportions and pose in every cell, the same size, and exactly the same position inside the same cell (the character stands on the same foot line, centred). Do not change the character, do not add or remove anything. No grid lines, no text, no shadows, no ground. Keep the background flat pure magenta #FF00FF and column 4 empty.
Output exactly one ${GRID}x${GRID} PNG. Save it into the current folder as ${jobName(row, 'out')} (copy the generated file there), then reply with that file name only.`;

function runJob(work, row) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-C', work, '--sandbox', 'workspace-write', '-i', `${work}/${jobName(row, 'ref')}`, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
    child.stdin.end(prompt(row));
    child.on('close', (code) => { fs.writeFileSync(`${work}/char_${String(row).padStart(2, '0')}.log`, log); resolve(code === 0 && fs.existsSync(`${work}/${jobName(row, 'out')}`)); });
  });
}

export async function run(work, concurrency = 3) {
  const todo = JSON.parse(fs.readFileSync(`${work}/rows.json`, 'utf8')).filter((r) => !fs.existsSync(`${work}/${jobName(r, 'out')}`));
  console.log(`${todo.length} character(s) to draw`);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < todo.length) { const r = todo[next++], t0 = Date.now(), ok = await runJob(work, r); console.log(`row ${r}: ${ok ? 'drawn' : 'FAILED'} in ${Math.round((Date.now() - t0) / 1000)}s`); } }));
}

/** Assemble the new sheet at `cell` px per cell from the old one, the redrawn rows and (optionally) a drawn companion. */
export function build(oldFile, work, outFile, cell, buzzFile) {
  const old = decodePng(fs.readFileSync(oldFile)), oc = old.width / CHAR_COLS, W = CHAR_COLS * cell, H = CHAR_ROWS * cell;
  const sheet = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  const report = [];
  for (let r = 0; r < CHAR_ROWS; r++) {
    const drawn = r === 1 && buzzFile ? buzzFile : `${work}/${jobName(r, 'out')}`;
    if (fs.existsSync(drawn)) { placeRow(sheet, r, decodePng(fs.readFileSync(drawn)), cell); continue; }
    report.push(`row ${r}: not redrawn, old art enlarged`);
    for (let y = 0; y < cell; y++) for (let x = 0; x < W; x++) old.data.copy(sheet.data, ((r * cell + y) * W + x) * 4, ((r * oc + Math.floor(y * oc / cell)) * old.width + Math.floor(x * oc / cell)) * 4, ((r * oc + Math.floor(y * oc / cell)) * old.width + Math.floor(x * oc / cell)) * 4 + 4);
  }
  fs.writeFileSync(outFile, encodePng(sheet));
  console.log(`${outFile}: ${W}x${H}`); report.forEach((l) => console.log('  ' + l));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2), flag = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  if (cmd === 'row') {                                  // row <characters.png> <row> <drawn.png> [--cell 128]
    const sheet = decodePng(fs.readFileSync(a[0]));
    placeRow(sheet, +a[1], decodePng(fs.readFileSync(a[2])), +flag('--cell', 128));
    fs.writeFileSync(a[0], encodePng(sheet)); console.log(`row ${a[1]} of ${a[0]} replaced`);
  } else if (cmd === 'plan') plan(a[0], a[1]);          // plan <characters.png> <workdir>
  else if (cmd === 'run') await run(a[0], +flag('--jobs', 3));   // run <workdir> [--jobs 3]
  else if (cmd === 'build') build(a[0], a[1], a[2], +flag('--cell', 256), flag('--buzz', null));   // build <old.png> <workdir> <out.png> [--cell 256] [--buzz drawn.png]
  else console.log('usage: row | plan | run | build (see the top of this file)');
}
