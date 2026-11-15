#!/usr/bin/env node
// Redraw the default sprite sheets with an image model (Codex CLI's image generation), then cut the result back into
// the same cells at a higher resolution.
//
//   node tools/redraw-art.mjs plan  <sheet> <src.png> <workdir>      write the reference images (jobs) for the artist
//   node tools/redraw-art.mjs run   <workdir> [--jobs 3] [--only 4,5] ask Codex to redraw each job (needs `codex login`)
//   node tools/redraw-art.mjs build <sheet> <src.png> <workdir> [--cell 128]   assemble <sheet>.png from the redrawn jobs
//
// A job is a square image of up to 4x4 cells (a 5x5 house is a job of its own) with the ORIGINAL sprites on flat
// magenta. Parts of one bigger object (tree_0_0, tree_1_0, ...) are placed together, in their real arrangement, so the
// artist draws them as one picture and the parts keep joining. The redrawn picture is cut back into the cells, the
// magenta becomes transparency, and seamless ground tiles are made seamless again.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/pngcodec.mjs';
import { loadPacks, packRoots } from './lib/packs.mjs';

const SIZE = 1024;
const MAGENTA = [255, 0, 255];

// ---------- planning ----------
/** Groups of cells that belong to one picture: { key, w, h, items: [{ name, idx, c, r }] }. */
export function groupCells(cells) {
  const groups = new Map();
  const put = (key, item, w, h) => { if (!groups.has(key)) groups.set(key, { key, w, h, items: [] }); const g = groups.get(key); g.w = Math.max(g.w, w); g.h = Math.max(g.h, h); g.items.push(item); };
  cells.forEach((name, idx) => {
    if (name === '_') return;
    let m;
    if ((m = name.match(/^(h_house_[a-z]+)_(\d+)_(\d+)$/))) return put(m[1], { name, idx, c: +m[2], r: +m[3] }, 5, 5);
    if ((m = name.match(/^(.+?)_(\d+)_(\d+)$/))) return put(m[1], { name, idx, c: +m[2], r: +m[3] }, +m[2] + 1, +m[3] + 1);
    if ((m = name.match(/^(h_(?:wall|roof)_[a-z]+)_(l|m|r|peak)$/))) return put(m[1], { name, idx, c: ['l', 'm', 'r', 'peak'].indexOf(m[2]), r: 0 }, ['l', 'm', 'r', 'peak'].indexOf(m[2]) + 1, 1);
    put(name, { name, idx, c: 0, r: 0 }, 1, 1);
  });
  return [...groups.values()];
}

/** Pack the groups into jobs: 5x5 houses alone, everything else first-fit into 4x4 grids. */
export function packJobs(groups) {
  const jobs = [];
  const fit = (job, g) => {
    for (let r = 0; r + g.h <= job.G; r++) for (let c = 0; c + g.w <= job.G; c++) {
      let free = true;
      for (let y = 0; y < g.h && free; y++) for (let x = 0; x < g.w; x++) if (job.used[(r + y) * job.G + c + x]) { free = false; break; }
      if (free) { for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) job.used[(r + y) * job.G + c + x] = 1; return { c, r }; }
    }
    return null;
  };
  const sorted = [...groups].sort((a, b) => (b.w * b.h) - (a.w * a.h));
  for (const g of sorted) {
    if (g.w > 4 || g.h > 4) { const job = { G: 5, used: new Array(25).fill(0), items: [] }; fit(job, g); jobs.push(job); job.items = place(g, { c: 0, r: 0 }); continue; }
    let spot = null, job = null;
    for (const j of jobs.filter((x) => x.G === 4)) { spot = fit(j, g); if (spot) { job = j; break; } }
    if (!spot) { job = { G: 4, used: new Array(16).fill(0), items: [] }; jobs.push(job); spot = fit(job, g); }
    job.items.push(...place(g, spot));
  }
  return jobs.map((j, i) => ({ id: i, G: j.G, items: j.items }));
}
const place = (g, at) => g.items.map((it) => ({ name: it.name, idx: it.idx, col: at.c + it.c, row: at.r + it.r }));

const cellRect = (G, col, row) => ({ x0: col * SIZE / G, y0: row * SIZE / G, x1: (col + 1) * SIZE / G, y1: (row + 1) * SIZE / G });

function referenceImage(src, sheetCols, job) {
  const cell = src.width / sheetCols, d = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { d[i * 4] = 255; d[i * 4 + 1] = 0; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
  for (const it of job.items) {
    const sx0 = (it.idx % sheetCols) * cell, sy0 = Math.floor(it.idx / sheetCols) * cell, R = cellRect(job.G, it.col, it.row);
    for (let y = Math.ceil(R.y0); y < R.y1; y++) for (let x = Math.ceil(R.x0); x < R.x1; x++) {
      const sx = sx0 + Math.min(cell - 1, Math.floor((x - R.x0) / (R.x1 - R.x0) * cell)), sy = sy0 + Math.min(cell - 1, Math.floor((y - R.y0) / (R.y1 - R.y0) * cell));
      const j = (sy * src.width + sx) * 4, i = (y * SIZE + x) * 4;
      if (src.data[j + 3] > 8) { d[i] = src.data[j]; d[i + 1] = src.data[j + 1]; d[i + 2] = src.data[j + 2]; }
    }
  }
  return { width: SIZE, height: SIZE, data: d };
}

const readSheet = (name) => {
  const packs = loadPacks(packRoots(process.env.OPENVORLD_HOME ?? ''));
  const sheet = packs.byKind.default_art.default_art.sheets[name];
  if (!sheet) throw new Error(`no sheet called ${name}`);
  return sheet;
};

function plan(sheetName, srcFile, work) {
  const sheet = readSheet(sheetName), src = decodePng(fs.readFileSync(srcFile));
  fs.mkdirSync(work, { recursive: true });
  const jobs = packJobs(groupCells(sheet.cells));
  for (const job of jobs) fs.writeFileSync(path.join(work, `job_${String(job.id).padStart(2, '0')}_ref.png`), encodePng(referenceImage(src, sheet.cols, job)));
  fs.writeFileSync(path.join(work, 'jobs.json'), JSON.stringify({ sheet: sheetName, cols: sheet.cols, jobs }, null, 1));
  console.log(`${sheetName}: ${jobs.length} jobs (${jobs.map((j) => j.items.length).join(', ')} cells)`);
}

// ---------- running the artist ----------
const prompt = (job) => `Use your image generation tool (edit mode, with the reference image ${jobFile(job, 'ref')} attached as the reference) to redraw the sprite sheet in that image.
The reference is a ${job.G}x${job.G} grid (each cell ${Math.round(SIZE / job.G)}x${Math.round(SIZE / job.G)} px) of small pixel-art game sprites on a flat magenta (#FF00FF) background.
Redraw EVERY sprite at much higher quality: crisp, clean, richly detailed pixel art with the same dark outline style, the same subjects, the same colours, the same pose, the same size and exactly the same position inside the same cell. Do not add, remove or move anything. No grid lines, no text, no drop shadows on the background.
Sprites that touch the border of a neighbouring cell are parts of ONE bigger object (for example a tree, a well or a house): keep them joined exactly across the cell borders, with the same outline and pattern on both sides of every border they share.
Keep the background flat pure magenta #FF00FF, and keep any opaque square tile (ground, water, dark void) as an opaque full-cell square of the same material.
Output exactly one ${SIZE}x${SIZE} PNG. Save the final image into the current folder as ${jobFile(job, 'out')} (copy the generated file there), then reply with that file name only.`;
const jobFile = (job, kind) => `job_${String(job.id).padStart(2, '0')}_${kind}.png`;

function runJob(work, job) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-C', work, '--sandbox', 'workspace-write', '-i', path.join(work, jobFile(job, 'ref')), '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
    child.stdin.end(prompt(job));
    child.on('close', (code) => { fs.writeFileSync(path.join(work, `job_${String(job.id).padStart(2, '0')}.log`), log); resolve({ id: job.id, ok: code === 0 && fs.existsSync(path.join(work, jobFile(job, 'out'))) }); });
  });
}

async function run(work, concurrency, only) {
  const { jobs } = JSON.parse(fs.readFileSync(path.join(work, 'jobs.json'), 'utf8'));
  const todo = jobs.filter((j) => (!only || only.includes(j.id)) && !fs.existsSync(path.join(work, jobFile(j, 'out'))));
  console.log(`${todo.length} job(s) to draw`);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < todo.length) { const job = todo[next++]; const t0 = Date.now(); const r = await runJob(work, job); console.log(`job ${job.id}: ${r.ok ? 'drawn' : 'FAILED'} in ${Math.round((Date.now() - t0) / 1000)}s`); }
  }));
}

// ---------- assembling ----------
const isBg = (r, g, b) => r > 190 && b > 190 && g < 100;
function resizeTo1024(img) {
  if (img.width === SIZE && img.height === SIZE) return img;
  const d = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) img.data.copy(d, (y * SIZE + x) * 4, (Math.floor(y * img.height / SIZE) * img.width + Math.floor(x * img.width / SIZE)) * 4, (Math.floor(y * img.height / SIZE) * img.width + Math.floor(x * img.width / SIZE)) * 4 + 4);
  return { width: SIZE, height: SIZE, data: d };
}

/** Cut one cell out of a redrawn job: magenta -> transparent (fringes included), area-averaged down to T x T. */
export function cutCell(img, R, T, keepOpaque) {
  const x0 = Math.floor(R.x0), y0 = Math.floor(R.y0), w = Math.ceil(R.x1) - x0, h = Math.ceil(R.y1) - y0;
  const bg = new Uint8Array(w * h);
  const at = (x, y) => ((y0 + y) * img.width + x0 + x) * 4;
  if (!keepOpaque) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = at(x, y); bg[y * w + x] = isBg(img.data[i], img.data[i + 1], img.data[i + 2]) ? 1 : 0; }
    // pinkish fringe pixels touching the background are background too (two passes)
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (bg[y * w + x]) continue;
        const i = at(x, y), r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (r - g > 55 && b - g > 55 && ((x > 0 && bg[y * w + x - 1]) || (x < w - 1 && bg[y * w + x + 1]) || (y > 0 && bg[(y - 1) * w + x]) || (y < h - 1 && bg[(y + 1) * w + x]))) add.push(y * w + x);
      }
      for (const k of add) bg[k] = 1;
    }
  }
  const out = Buffer.alloc(T * T * 4), sw = (R.x1 - R.x0) / T, sh = (R.y1 - R.y0) / T;
  for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
    let wsum = 0, asum = 0, r = 0, g = 0, b = 0;
    const fx0 = R.x0 + tx * sw, fx1 = fx0 + sw, fy0 = R.y0 + ty * sh, fy1 = fy0 + sh;
    for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
      const wgt = (Math.min(x + 1, fx1) - Math.max(x, fx0)) * (Math.min(y + 1, fy1) - Math.max(y, fy0));
      if (wgt <= 0 || x < x0 || y < y0 || x - x0 >= w || y - y0 >= h) continue;
      wsum += wgt;
      if (bg[(y - y0) * w + x - x0]) continue;
      const i = at(x - x0, y - y0); asum += wgt; r += wgt * img.data[i]; g += wgt * img.data[i + 1]; b += wgt * img.data[i + 2];
    }
    const o = (ty * T + tx) * 4;
    if (asum > 0) { out[o] = Math.round(r / asum); out[o + 1] = Math.round(g / asum); out[o + 2] = Math.round(b / asum); out[o + 3] = Math.round(255 * asum / Math.max(wsum, 1e-9)); }
  }
  return out;
}

/** Make an opaque T x T tile seamless: cross-fade it with a copy shifted by half a tile, away from the borders. */
export function seamless(tile, T, band = 0.22) {
  const out = Buffer.alloc(tile.length), B = T * band;
  const px = (x, y) => (((y + T) % T) * T + ((x + T) % T)) * 4;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const dx = Math.min(x, T - 1 - x) / B, dy = Math.min(y, T - 1 - y) / B, m = Math.min(1, dx) * Math.min(1, dy), t = m * m * (3 - 2 * m);
    const a = px(x, y), s = px(x + T / 2, y + T / 2), o = (y * T + x) * 4;
    for (let k = 0; k < 3; k++) out[o + k] = Math.round(tile[a + k] * t + tile[s + k] * (1 - t));
    out[o + 3] = 255;
  }
  return out;
}

const alphaOverlap = (cell, T, orig, sheetCols, idx) => {            // how well the redrawn silhouette sits on the original one (0..1)
  const oc = orig.width / sheetCols, ox = (idx % sheetCols) * oc, oy = Math.floor(idx / sheetCols) * oc;
  let both = 0, either = 0, solid = 0;
  for (let y = 0; y < oc; y++) for (let x = 0; x < oc; x++) { if (orig.data[((oy + y) * orig.width + ox + x) * 4 + 3] > 40) solid++; }
  if (solid < 24) return 1;                                     // an (almost) empty original cell has no silhouette to compare
  for (let y = 0; y < oc; y++) for (let x = 0; x < oc; x++) {
    const a = orig.data[((oy + y) * orig.width + ox + x) * 4 + 3] > 40, b = cell[((Math.floor(y * T / oc)) * T + Math.floor(x * T / oc)) * 4 + 3] > 100;
    if (a && b) both++; if (a || b) either++;
  }
  return either ? both / either : 1;
};

function build(sheetName, srcFile, work, T) {
  const sheet = readSheet(sheetName), orig = decodePng(fs.readFileSync(srcFile)), { jobs } = JSON.parse(fs.readFileSync(path.join(work, 'jobs.json'), 'utf8'));
  const rows = Math.ceil(sheet.cells.length / sheet.cols), W = sheet.cols * T, H = rows * T, data = Buffer.alloc(W * H * 4);
  const oc = orig.width / sheet.cols, drawn = new Set(), report = [];
  const blit = (idx, cell) => { const x0 = (idx % sheet.cols) * T, y0 = Math.floor(idx / sheet.cols) * T; for (let y = 0; y < T; y++) cell.copy(data, ((y0 + y) * W + x0) * 4, y * T * 4, (y + 1) * T * 4); };
  // the original art, enlarged with nearest-neighbour, is the fallback for any cell that was not redrawn
  const fallback = (idx) => { const c = Buffer.alloc(T * T * 4), ox = (idx % sheet.cols) * oc, oy = Math.floor(idx / sheet.cols) * oc; for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) orig.data.copy(c, (y * T + x) * 4, ((oy + Math.floor(y * oc / T)) * orig.width + ox + Math.floor(x * oc / T)) * 4, ((oy + Math.floor(y * oc / T)) * orig.width + ox + Math.floor(x * oc / T)) * 4 + 4); return c; };
  const KEEP_ORIGINAL_TILES = new Set(['t_plaza', 't_bridge']);       // structured tiles must stay exactly seamless
  for (const job of jobs) {
    const file = path.join(work, jobFile(job, 'out'));
    if (!fs.existsSync(file)) continue;
    const img = resizeTo1024(decodePng(fs.readFileSync(file)));
    for (const it of job.items) {
      const tile = it.name.startsWith('t_');
      if (KEEP_ORIGINAL_TILES.has(it.name)) continue;
      let cell = cutCell(img, cellRect(job.G, it.col, it.row), T, tile);
      if (tile) { for (let i = 3; i < cell.length; i += 4) cell[i] = 255; cell = seamless(cell, T); }
      const overlap = tile ? 1 : alphaOverlap(cell, T, orig, sheet.cols, it.idx);
      if (overlap < 0.55) { report.push(`${it.name}: redrawn silhouette does not match (${overlap.toFixed(2)}), kept the original`); continue; }
      blit(it.idx, cell); drawn.add(it.idx);
    }
  }
  sheet.cells.forEach((name, idx) => { if (name !== '_' && !drawn.has(idx)) blit(idx, fallback(idx)); });
  const outFile = path.join(work, `${sheetName}.png`);
  fs.writeFileSync(outFile, encodePng({ width: W, height: H, data }));
  console.log(`${sheetName}: ${drawn.size}/${sheet.cells.filter((c) => c !== '_').length} cells redrawn -> ${outFile} (${W}x${H})`);
  for (const r of report) console.log('  ' + r);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
  if (cmd === 'plan') plan(rest[0], rest[1], rest[2]);
  else if (cmd === 'run') await run(rest[0], +flag('--jobs', 3), flag('--only', '') ? flag('--only').split(',').map(Number) : null);
  else if (cmd === 'build') build(rest[0], rest[1], rest[2], +flag('--cell', 128));
  else console.log('usage: plan <sheet> <src.png> <workdir> | run <workdir> [--jobs n] [--only ids] | build <sheet> <src.png> <workdir> [--cell px]');
}
