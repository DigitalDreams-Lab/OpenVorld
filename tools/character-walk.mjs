#!/usr/bin/env node
// Redraw every character of characters.png as an EIGHT-direction walk cycle with Codex image generation.
//   node tools/character-walk.mjs plan  <characters.png> <workdir>
//   node tools/character-walk.mjs run   <workdir> [--jobs 3] [--only 0,2]
//   node tools/character-walk.mjs build <workdir> <out.png> [--cell 256]
// plan writes one reference picture per row (the current art as a grid, see character-row.mjs). A job asks the model for
// ONE picture per character: 5 columns (front, front-right, right, back-right, back) by 4 rows (the four walk frames).
// The sheet stores the five drawn directions of a character in one row (20 cells); the game flips three of them for the
// directions facing left (default-art.yaml > characters.mirror), so it has all eight:
//   down, down_right, right, up_right, up   (4 frames each)
// Frames: 0 contact (one leg and the opposite arm forward), 1 passing (standing neutral), 2 contact (the other leg and arm
// forward), 3 passing again. The standing pose is frame 1.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/pngcodec.mjs';
import { cutCell } from './redraw-art.mjs';
import { plan as planRefs } from './character-row.mjs';

export const FRAMES = 4, ROWS = 16;
const DRAWN_DIRS = 5;                                 // front, front-right, right, back-right, back
const jobName = (row, kind) => `walk_${String(row).padStart(2, '0')}_${kind}.png`;

export function plan(sheetFile, work) { planRefs(sheetFile, work, []); }

const creature = (row) => row === 1;
const prompt = (row) => creature(row)
? `Use your image generation tool (edit mode, with char_${String(row).padStart(2, '0')}_ref.png attached as the reference image) to draw a hovering-flight sprite sheet of this small cute game creature, a fuzzy bee companion.
The reference shows the same creature from 4 directions (front, back, left, right) with wings in different positions, on flat magenta (#FF00FF).
Draw a new sheet of 5 columns x 4 rows (each cell the same size, the whole picture 1280x1024) on flat magenta (#FF00FF). Columns, left to right, are five views of the SAME bee: 1 facing the viewer (front), 2 front three-quarter view turned to the viewer's right, 3 right-facing side profile, 4 back three-quarter view turned to the right (we see its back and a bit of its right side), 5 seen from directly behind. The four rows are four frames of a smooth wing-flap cycle while hovering: row 1 wings fully raised, row 2 wings halfway down, row 3 wings fully lowered, row 4 wings halfway up. The body stays in the same place in every cell of a column, only the wings (and a very slight bob) change. Exactly the same design, colours, proportions and outline style as the reference, crisp richly detailed pixel art with a dark outline. No grid lines, no text, no shadow, no ground; the creature is centred in its cell with space around it and never crosses a cell border. Keep the background flat pure magenta.
Save the picture into the current folder as ${jobName(row, 'out')} (copy the generated file there), then reply with that file name only.`
: `Use your image generation tool (edit mode, with char_${String(row).padStart(2, '0')}_ref.png attached as the reference image) to draw a new walking sprite sheet of this game character.
The reference shows the character as a 4x4 grid on flat magenta (#FF00FF): row 1 seen from the front, row 2 from behind, row 3 facing left, row 4 facing right (first three columns are poses, the last column is empty). It only shows the character's design: ignore its poses.
Draw a new sheet of 5 columns x 4 rows (each cell the same size, the whole picture 1280x1024) on flat magenta (#FF00FF). Columns, left to right, are five views of the SAME character: 1 facing the viewer (front), 2 front three-quarter view turned to the viewer's right (face and chest visible, body angled), 3 right-facing side profile, 4 back three-quarter view turned to the right (we see the back of the head and a bit of the right side), 5 seen from directly behind. The four rows are the four frames of a natural walk cycle: row 1 = contact pose (one leg stepped forward, the other leg back with its heel lifted, and the OPPOSITE arm swung forward, the other arm back), row 2 = passing pose (legs together under the body, standing neutral, arms hanging by the sides, body slightly raised), row 3 = the mirrored contact pose (the other leg forward and the other arm forward), row 4 = passing pose again. Legs and arms must clearly move between the rows in every view, and hair, hats, cloaks and clothes move a little with the steps. In a column the character keeps exactly the same size, centre and foot line (feet at the same height in the contact poses and passing poses, heads bobbing by only a pixel or two).
Exactly the same character design, outfit, hair, colours and proportions as the reference, the same crisp richly detailed pixel art style with a dark outline. No grid lines, no text, no shadows, no ground; each character is centred in its cell with space around it and never crosses a cell border. Keep the background flat pure magenta #FF00FF.
Save the picture into the current folder as ${jobName(row, 'out')} (copy the generated file there), then reply with that file name only.`;

function runJob(work, row) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-C', work, '--sandbox', 'workspace-write', '-i', `${work}/char_${String(row).padStart(2, '0')}_ref.png`, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
    child.stdin.end(prompt(row));
    child.on('close', (code) => { fs.writeFileSync(`${work}/walk_${String(row).padStart(2, '0')}.log`, log); resolve(code === 0 && fs.existsSync(`${work}/${jobName(row, 'out')}`)); });
  });
}

export async function run(work, concurrency = 3, only = null) {
  const rows = (only ?? Array.from({ length: ROWS }, (_, i) => i)).filter((r) => !fs.existsSync(`${work}/${jobName(r, 'out')}`));
  console.log(`${rows.length} character(s) to draw`);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < rows.length) { const r = rows[next++], t0 = Date.now(), ok = await runJob(work, r); console.log(`row ${r}: ${ok ? 'drawn' : 'FAILED'} in ${Math.round((Date.now() - t0) / 1000)}s`); } }));
}

/** The 5 x 4 cells of a drawn sheet as cell x cell RGBA buffers: cells[view][frame], one shift per view so the body stays put. */
export function cutSheet(drawn, cell, { floor = 0.078 } = {}) {
  const gw = drawn.width / DRAWN_DIRS, gh = drawn.height / FRAMES, side = Math.min(gw, gh), out = [];
  for (let v = 0; v < DRAWN_DIRS; v++) {
    const cells = [], stats = [];
    for (let f = 0; f < FRAMES; f++) {
      // the square of the cell, centred (a cell is square when the picture has the 5:4 shape we asked for)
      const x0 = v * gw + (gw - side) / 2, y0 = f * gh + (gh - side) / 2;
      const img = cutCell(drawn, { x0, y0, x1: x0 + side, y1: y0 + side }, cell, false);
      let y1 = -1, m = 0, mx = 0;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const a = img[(y * cell + x) * 4 + 3]; if (a > 60) { y1 = Math.max(y1, y); m += a; mx += a * x; } }
      cells.push(img); stats.push({ cx: m ? mx / m : cell / 2, bottom: y1 });
    }
    const sorted = (k) => [...stats.map((s) => s[k])].sort((a, b) => a - b), med = (k) => (sorted(k)[1] + sorted(k)[2]) / 2;
    const dx = Math.round(cell / 2 - med('cx')), dy = Math.round(cell - Math.round(cell * floor) - med('bottom'));
    out.push(cells.map((c) => {
      const o = Buffer.alloc(c.length);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= cell || sy >= cell) continue;
        c.copy(o, (y * cell + x) * 4, (sy * cell + sx) * 4, (sy * cell + sx) * 4 + 4);
      }
      return o;
    }));
  }
  return out;
}

export function build(work, outFile, cell = 256) {
  const W = DRAWN_DIRS * FRAMES * cell, H = ROWS * cell, sheet = { width: W, height: H, data: Buffer.alloc(W * H * 4) }, report = [];
  for (let r = 0; r < ROWS; r++) {
    const file = `${work}/${jobName(r, 'out')}`;
    if (!fs.existsSync(file)) { report.push(`row ${r}: NOT DRAWN`); continue; }
    cutSheet(decodePng(fs.readFileSync(file)), cell).forEach((frames, v) => frames.forEach((px, f) => {
      const col = v * FRAMES + f;
      for (let y = 0; y < cell; y++) px.copy(sheet.data, ((r * cell + y) * W + col * cell) * 4, y * cell * 4, (y + 1) * cell * 4);
    }));
  }
  fs.writeFileSync(outFile, encodePng(sheet)); console.log(`${outFile}: ${W}x${H}`); report.forEach((l) => console.log('  ' + l));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...a] = process.argv.slice(2), flag = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  if (cmd === 'plan') plan(a[0], a[1]);
  else if (cmd === 'run') await run(a[0], +flag('--jobs', 3), flag('--only', null)?.split(',').map(Number) ?? null);
  else if (cmd === 'build') build(a[0], a[1], +flag('--cell', 256));
  else console.log('usage: plan | run | build (see the top of this file)');
}
