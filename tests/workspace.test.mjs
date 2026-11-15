// Every crew member has a work folder: <default space>/<id> unless they have their own; both are settable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, call, newVorld } from './helpers/server.mjs';

test('work folder per crew member, default space, validation and persistence', async (t) => {
  const { home } = await startServer(t);
  const { id, root } = await newVorld({ crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }] });
  const vorld = (await call('GET', `${root}/vorld`)).data;
  const [, a, b] = vorld.crew;

  // every member has one, by default inside the vorld's private space
  assert.ok(vorld.crew.every((c) => c.workspace?.path));
  assert.equal(a.workspace.source, 'vorld');
  assert.equal(a.workspace.path, path.join(home, 'vorlds', id, 'workspaces', a.id));
  assert.equal(vorld.workspace.default_is_custom, false);

  // a folder of their own
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-mine-')); t.after(() => fs.rmSync(mine, { recursive: true, force: true }));
  const set = await call('PUT', `${root}/crew/${a.id}`, { workspace: mine });
  assert.equal(set.status, 200);
  const sa = set.data.crew.find((c) => c.id === a.id).workspace;
  assert.deepEqual([sa.source, sa.path, sa.chosen], ['own', mine, true]);
  assert.equal(set.data.crew.find((c) => c.id === b.id).workspace.source, 'vorld');

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

// Command writs: what the founder approves must match the next call, and secrets stay out of the card.
test('a refused command becomes a short pattern, a bare program means any arguments, secrets are hidden', async () => {
  const { commandPattern, redact, checkScope, commandMatches } = await import('../engine/server/gate.mjs');
  const { deniedAccess } = await import('../engine/server/agents/drivers/claude.mjs');
  const { makeVorld } = await import('./helpers/vorld.mjs');
  const curl = 'curl -sS -X POST https://oauth2.googleapis.com/token -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "client_id=abc.apps.googleusercontent.com" --data-urlencode "client_secret=GOCSPX-supersecret" --data-urlencode "refresh_token=1//0gtoken"';
  assert.equal(commandPattern(curl), 'curl *');
  assert.equal(commandPattern('npm test'), 'npm test');
  assert.equal(commandPattern('npm test -- --watch'), 'npm test *');
  assert.equal(commandPattern('python3 stats.py --json'), 'python3 stats.py *');
  assert.equal(commandPattern('ls'), 'ls');
  const ask = deniedAccess('Bash', { command: curl, description: 'Swap the refresh token' }, '/tmp');
  assert.equal(ask.scope, 'curl *', 'the writ is a pattern that also matches the next call, never a cut-off command line');
  assert.ok(!/supersecret|1\/\/0gtoken/.test(ask.why), 'secrets never reach the writ card');
  assert.match(redact('Authorization: Bearer abc123 x'), /Bearer \S*•••/);
  const ctx = makeVorld();
  assert.equal(checkScope(ctx, 'cmd.run', 'curl'), 'curl *', 'allowing "curl" allows curl with any arguments');
  assert.equal(checkScope(ctx, 'cmd.run', 'npm test'), 'npm test');
  assert.throws(() => checkScope(ctx, 'cmd.run', 'sudo'), /never/);
  assert.throws(() => checkScope(ctx, 'cmd.run', 'x '.repeat(120)), /short pattern/);
  assert.ok(commandMatches('curl *', curl), 'the granted pattern covers the call that was refused');
});
