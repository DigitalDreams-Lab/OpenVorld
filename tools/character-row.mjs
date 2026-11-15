#!/usr/bin/env node
// Put a freshly drawn character into one row of characters.png.
//   node tools/character-row.mjs <characters.png> <row> <drawn.png> [--cell 128]
// <drawn.png> is a 1024x1024 picture on flat magenta: a 4x4 grid of 256 px cells, one row per view (front, back, left,
// right) and the first three columns the three animation frames. The magenta becomes transparency, every cell is
// halved to the sheet's cell size, and each view is placed with ONE shift for all its frames (the body stays put while
// the wings move), centred horizontally and standing on the same foot line.
import fs from 'node:fs';
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
    const dx = Math.round(cell / 2 - med('cx')), dy = Math.round(cell - 10 - med('bottom'));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, row, drawn] = process.argv.slice(2), ci = process.argv.indexOf('--cell'), cell = ci > 0 ? +process.argv[ci + 1] : 128;
  const sheet = decodePng(fs.readFileSync(file));
  placeRow(sheet, +row, decodePng(fs.readFileSync(drawn)), cell);
  fs.writeFileSync(file, encodePng(sheet));
  console.log(`row ${row} of ${file} replaced`);
}
