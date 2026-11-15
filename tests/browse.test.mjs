// The folder picker lists folder names only, hides dot folders, and marks folders a writ can never cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPacks, packRoots } from '../tools/lib/packs.mjs';
import { browseFolder } from '../engine/server/browse.mjs';

const tree = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-browse-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const d of ['app', 'Zed', '.hidden', '.ssh', 'notes']) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
  return { dir, ctx: { dir, packs: loadPacks(packRoots(dir)) } };
};

test('lists sub-folders alphabetically, never files or dot folders', (t) => {
  const { dir, ctx } = tree(t);
  const r = browseFolder(ctx, { dir });
  assert.deepEqual(r.entries.map((e) => e.name), ['app', 'notes', 'Zed']);
  assert.equal(r.path, dir);
  assert.equal(r.parent, path.dirname(dir));
  assert.ok(r.roots.length > 0 && r.roots.every((x) => path.isAbsolute(x.path)));
});

test('a file path opens its folder, a missing one falls back to home', (t) => {
  const { dir, ctx } = tree(t);
  assert.equal(browseFolder(ctx, { dir: path.join(dir, 'secret.txt') }).path, dir);
  assert.equal(browseFolder(ctx, { dir: path.join(dir, 'nope') }).path, os.homedir());
});

test('folders a writ can never cover are marked, and broad ones are not selectable', (t) => {
  const { dir, ctx } = tree(t);
  assert.equal(browseFolder(ctx, { dir }).entries.find((e) => e.name === 'app').ok, true);
  assert.equal(browseFolder(ctx, { dir: '/', capability: 'fs.write' }).ok, false);
  assert.equal(browseFolder(ctx, { dir: os.homedir() }).ok, false);
});
