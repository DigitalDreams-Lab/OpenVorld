// The folder picker lists folder names only, hides dot folders, and marks folders a writ can never cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { loadPacks, packRoots } from '../tools/lib/packs.mjs';
import { browseFolder, pickNative } from '../engine/server/browse.mjs';

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

test('cancelling the Mac folder picker runs the chooser once, including when the initial location fails', { skip: process.platform !== 'darwin' }, async t => {
  const { dir } = tree(t);
  let source;
  const mock = t.mock.method(childProcess, 'execFile', (_cmd, args, _options, callback) => {
    source = args[1]; callback(Object.assign(new Error('User canceled (-128)'), { code: 1 }), '', 'User canceled (-128)');
  });
  syncBuiltinESMExports();
  try { assert.equal(await pickNative('Choose a folder', dir), null); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  // Evaluate the actual AppleScript control flow with a non-UI chooser that cancels on its first call.
  // The former broad error handler would call it again and return the home folder on the second call.
  const evaluate = script => Number(childProcess.execFileSync('osascript', ['-e', `
property attempts : 0
on simulatedChooser()
  set attempts to attempts + 1
  if attempts is 1 then error number -128
  return path to home folder
end simulatedChooser
try
${script.replace(/choose folder with prompt "[^"]*"(?: default location loc)?/g, 'my simulatedChooser()')}
on error
end try
return attempts`], { encoding: 'utf8' }).trim());
  assert.equal(evaluate(source), 1);
  assert.equal(evaluate(source.replace(`POSIX file "${dir}"`, 'POSIX file "/this/path/does/not/exist"')), 1);
});
