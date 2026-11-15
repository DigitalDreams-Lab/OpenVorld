// Every crew member has a work folder: <default space>/<id> unless they have their own; both are settable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, call, newWorld } from './helpers/server.mjs';

test('work folder per crew member, default space, validation and persistence', async (t) => {
  const { home } = await startServer(t);
  const { id, root } = await newWorld({ crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }] });
  const world = (await call('GET', `${root}/world`)).data;
  const [, a, b] = world.crew;

  // every member has one, by default inside the world's private space
  assert.ok(world.crew.every((c) => c.workspace?.path));
  assert.equal(a.workspace.source, 'world');
  assert.equal(a.workspace.path, path.join(home, 'worlds', id, 'workspaces', a.id));
  assert.equal(world.workspace.default_is_custom, false);

  // a folder of their own
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-mine-')); t.after(() => fs.rmSync(mine, { recursive: true, force: true }));
  const set = await call('PUT', `${root}/crew/${a.id}`, { workspace: mine });
  assert.equal(set.status, 200);
  const sa = set.data.crew.find((c) => c.id === a.id).workspace;
  assert.deepEqual([sa.source, sa.path, sa.chosen], ['own', mine, true]);
  assert.equal(set.data.crew.find((c) => c.id === b.id).workspace.source, 'world');

  // the default space moves everyone without a folder of their own
  const space = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-')); t.after(() => fs.rmSync(space, { recursive: true, force: true }));
  const moved = await call('PUT', root, { workspace_base: space });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.crew.find((c) => c.id === b.id).workspace.path, path.join(space, b.id));
  assert.equal(moved.data.crew.find((c) => c.id === a.id).workspace.source, 'own');

  // validation and reset
  assert.equal((await call('PUT', `${root}/crew/${a.id}`, { workspace: '/' })).status, 400);
  assert.equal((await call('PUT', `${root}/crew/${a.id}`, { workspace: '/no/such/parent/x' })).status, 400);
  const reset = await call('PUT', `${root}/crew/${a.id}`, { workspace: '' });
  assert.equal(reset.data.crew.find((c) => c.id === a.id).workspace.path, path.join(space, a.id));
  const back = await call('PUT', root, { workspace_base: null });
  assert.equal(back.data.workspace.default_is_custom, false);
});
