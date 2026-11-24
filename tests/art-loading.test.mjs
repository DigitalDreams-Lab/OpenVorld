import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atlasFor, sheetImage } from '../engine/server/art.mjs';
import { encodePng, decodePng } from '../tools/lib/pngcodec.mjs';
import { clientModule } from './helpers/client.mjs';
import { startServer, call, newVorld } from './helpers/server.mjs';

test('large character sheets are paged without altering a frame or its mirrored direction', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-art-pages-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const width = 2560, height = 128, cell = 128, data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([Math.floor(x / cell) * 10, x % cell, y, 255], (y * width + x) * 4);
  fs.writeFileSync(path.join(dir, 'characters.png'), encodePng({ width, height, data }));
  const characters = { file: 'characters.png', dirs: ['down', 'down_right', 'right', 'up_right', 'up'], frames: 4, mirror: { left: 'right' }, rows: [{ id: 'founder', for: 'founder' }] };
  const packs = { sources: { 'default_art/default_art': [path.join(dir, 'default-art.yaml')] }, byKind: { default_art: { default_art: { characters } } } };
  const atlas = atlasFor({ packs, crew: [] }); assert.equal(atlas.sheets.length, 2);
  for (const sheet of atlas.sheets) {
    const page = decodePng(sheetImage(packs, sheet.image)); assert.ok(page.width <= 2048 && page.height <= 2048);
    for (const [name, frame] of Object.entries(sheet.frames)) {
      const [, direction, index] = name.match(/^c_founder_(.+)_(\d+)$/);
      const originalColumn = ['down', 'down_right', 'right', 'up_right', 'up'].indexOf(direction === 'left' ? 'right' : direction) * 4 + Number(index);
      for (let row = 0; row < cell; row++) {
        const offset = ((frame.y + row) * page.width + frame.x) * 4, source = (row * width + originalColumn * cell) * 4;
        assert.deepEqual(page.data.subarray(offset, offset + cell * 4), data.subarray(source, source + cell * 4), name);
      }
      if (direction === 'left') assert.equal(frame.flip, true);
    }
  }
  assert.equal(sheetImage(packs, 'characters-page-900-0'), null);
  assert.equal(sheetImage(packs, '../characters'), null);
  assert.equal(decodePng(sheetImage(packs, 'characters')).width, width, 'original sheet remains available');
  const replacement = Buffer.from(data); replacement.fill(0);
  fs.writeFileSync(path.join(dir, 'characters.png'), encodePng({ width, height, data: replacement }));
  assert.equal(decodePng(sheetImage(packs, atlas.sheets[0].image)).data.some(byte => byte), false, 'replacing a pack invalidates cached pages');
});

test('a failed image load reports the sheet and can retry the same atlas revision', async t => {
  let fail = true;
  const previous = globalThis.Image;
  globalThis.Image = class { async decode() { if (fail) throw new Error('image decode failed'); } };
  t.after(() => { if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous; });
  const pixels = await clientModule('engine/client/src/game/pixels.ts', {}, true);
  const atlas = { revision: 'retry', sheets: [{ image: 'characters-page-0-0', frames: { c_founder_down_0: {} } }] };
  await assert.rejects(pixels.loadGenerated(atlas, async () => new Blob(['png'])), /characters-page-0-0/);
  assert.equal(pixels.generatedRevision(), null);
  fail = false; await pixels.loadGenerated(atlas, async () => new Blob(['png']));
  assert.equal(pixels.generatedRevision(), 'retry'); assert.equal(pixels.hasGenerated('c_founder_down_0'), true);
});

test('the authenticated art API serves the default atlas pages with valid frame bounds', async t => {
  await startServer(t); const world = await newVorld();
  const atlas = (await call('GET', world.root + '/vorld')).data.art.atlas;
  const pages = atlas.sheets.filter(sheet => sheet.group === 'characters'); assert.ok(pages.length > 1);
  for (const sheet of pages) {
    assert.equal((await call('GET', '/api/art/' + sheet.image, undefined, {}, false)).status, 401);
    const response = await call('GET', '/api/art/' + sheet.image);
    assert.equal(response.status, 200); assert.equal(response.headers['content-type'], 'image/png');
    const image = decodePng(response.data); assert.ok(image.width <= 2048 && image.height <= 2048);
    for (const frame of Object.values(sheet.frames)) assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.w <= image.width && frame.y + frame.h <= image.height);
  }
  assert.equal((await call('GET', '/api/art/characters-page-999-0')).status, 404);
});

test('the quick encoder gives back the same pixels, and every character page comes out right', t => {
  const width = 300, height = 40, data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 5)) & 255;
  assert.deepEqual(decodePng(encodePng({ width, height, data }, { fast: true })).data, data);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-art-once-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sheet = 2560, rows = 128, big = Buffer.alloc(sheet * rows * 4, 200);
  fs.writeFileSync(path.join(dir, 'characters.png'), encodePng({ width: sheet, height: rows, data: big }));
  const characters = { file: 'characters.png', dirs: ['down', 'down_right', 'right', 'up_right', 'up'], frames: 4, rows: [{ id: 'founder', for: 'founder' }] };
  const packs = { sources: { 'default_art/default_art': [path.join(dir, 'default-art.yaml')] }, byKind: { default_art: { default_art: { characters } } } };
  const cellWidth = sheet / 20, edge = Math.floor(2048 / cellWidth) * cellWidth;
  assert.equal(decodePng(sheetImage(packs, 'characters-page-0-0')).width, edge);
  assert.equal(decodePng(sheetImage(packs, 'characters-page-1-0')).width, sheet - edge, 'the second page is the rest of the sheet');
});

test('the art sheets download side by side, and one that fails still names itself', async t => {
  const previous = globalThis.Image;
  globalThis.Image = class { async decode() {} };
  t.after(() => { if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous; });
  const pixels = await clientModule('engine/client/src/game/pixels.ts', {}, true);
  const asked = []; let release; const gate = new Promise(r => { release = r; });
  const atlas = { revision: 'parallel', sheets: ['a', 'b', 'c'].map(image => ({ image, frames: { [`f_${image}`]: {} } })) };
  const done = pixels.loadGenerated(atlas, async name => { asked.push(name); await gate; return new Blob(['png']); });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(asked, ['a', 'b', 'c'], 'no sheet waits for the one before it');
  release(); await done;
  assert.ok(['a', 'b', 'c'].every(n => pixels.hasGenerated(`f_${n}`)));
  const broken = { revision: 'one-bad', sheets: atlas.sheets };
  await assert.rejects(pixels.loadGenerated(broken, async name => { if (name === 'b') throw new Error('gone'); return new Blob(['png']); }), /b/);
});

test('sheets are decoded with createImageBitmap when the browser has it, and by the image element when it does not', async t => {
  const previousImage = globalThis.Image, previousBitmap = globalThis.createImageBitmap;
  let bitmaps = 0, elements = 0;
  globalThis.Image = class { async decode() { elements++; } };
  t.after(() => { globalThis.Image = previousImage; if (previousBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousBitmap; });
  const pixels = await clientModule('engine/client/src/game/pixels.ts', {}, true);
  const atlas = (revision) => ({ revision, sheets: [{ image: 'a', frames: { f: {} } }] });
  globalThis.createImageBitmap = async () => { bitmaps++; return { bitmap: true }; };
  await pixels.loadGenerated(atlas('bitmap'), async () => new Blob(['png']));
  assert.deepEqual([bitmaps, elements], [1, 0]);
  globalThis.createImageBitmap = async () => { throw new Error('cannot read it'); };
  await pixels.loadGenerated(atlas('fallback'), async () => new Blob(['png']));
  assert.equal(elements, 1, 'an image the bitmap path cannot read still loads through the element');
});
