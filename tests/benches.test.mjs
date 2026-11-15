// Workbenches: the folders a member works in. A Main bench by default, more on request, one default, and every chat
// starts on one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, call, newVorld } from './helpers/server.mjs';

const tmp = (t, prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('workbenches: a Main bench by default, more on request, one default, each chat starts on one', async (t) => {
  const { home } = await startServer(t);
  const { id, root } = await newVorld({ crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }] });
  const vorld = (await call('GET', `${root}/vorld`)).data;
  const [, a, b] = vorld.crew;
  const benchesOf = async (m) => (await call('GET', `${root}/vorld`)).data.crew.find((c) => c.id === m).benches;

  // everyone starts with a Main bench inside the vorld
  assert.deepEqual(a.benches.map((x) => [x.id, x.default, x.chosen]), [['main', true, false]]);
  assert.equal(a.benches[0].path, path.join(home, 'vorlds', id, 'workbenches', a.id));
  assert.ok(fs.existsSync(a.benches[0].path), 'default workbench folder exists on disk');
  assert.equal(vorld.benches.custom, false);

  // more benches, in folders the founder picks
  const site = tmp(t, 'ov-site-');
  const added = await call('POST', `${root}/crew/${a.id}/benches`, { name: 'Website', path: site });
  assert.equal(added.status, 200);
  assert.equal(added.data.added, 'website');
  const list = added.data.crew.find((c) => c.id === a.id).benches;
  assert.deepEqual(list.map((x) => [x.id, x.name, x.chosen, x.default]), [['main', 'Main bench', false, true], ['website', 'Website', true, false]]);
  assert.equal(added.data.crew.find((c) => c.id === b.id).benches.length, 1, 'benches belong to one member');

  // the Main bench can move, and go back to its default place
  const mine = tmp(t, 'ov-mine-');
  const moved = await call('PUT', `${root}/crew/${a.id}/benches/main`, { path: mine });
  assert.deepEqual((await benchesOf(a.id))[0].path, mine);
  assert.equal(moved.data.crew.find((c) => c.id === a.id).benches[0].chosen, true);
  const reset = await call('PUT', `${root}/crew/${a.id}/benches/main`, { path: null });
  assert.equal(reset.data.crew.find((c) => c.id === a.id).benches[0].path, path.join(home, 'vorlds', id, 'workbenches', a.id));

  // the default bench, and the folder every default Main bench is made in
  const def = await call('PUT', `${root}/crew/${a.id}/benches/website`, { default: true });
  assert.deepEqual(def.data.crew.find((c) => c.id === a.id).benches.map((x) => x.default), [false, true]);
  const space = tmp(t, 'ov-space-');
  const base = await call('PUT', root, { bench_base: space });
  assert.equal(base.data.crew.find((c) => c.id === b.id).benches[0].path, path.join(space, b.id));
  assert.equal(base.data.benches.custom, true);

  // checks
  assert.equal((await call('POST', `${root}/crew/${a.id}/benches`, { name: 'x', path: '/' })).status, 400, 'too broad');
  assert.equal((await call('POST', `${root}/crew/${a.id}/benches`, { name: 'x', path: '/no/such/parent/x' })).status, 400);
  assert.equal((await call('POST', `${root}/crew/${a.id}/benches`, { name: 'x' })).status, 400);
  assert.equal((await call('PUT', `${root}/crew/${a.id}/benches/website`, { path: null })).status, 400, 'only Main goes back to a default folder');
  assert.equal((await call('DELETE', `${root}/crew/${a.id}/benches/main`)).status, 400);
  assert.equal((await call('PUT', `${root}/crew/${a.id}/benches/nope`, { name: 'x' })).status, 404);

  // every chat starts on one bench and stays there
  const onSite = (await call('POST', `${root}/threads`, { role: a.id, bench: 'website' })).data;
  assert.equal(onSite.bench, 'website');
  const plain = (await call('POST', `${root}/threads`, { role: a.id })).data;
  assert.equal(plain.bench, 'website', 'no choice = the member\'s default bench');
  assert.equal((await call('POST', `${root}/threads`, { role: a.id, bench: 'nope' })).status, 400);
  await call('PUT', `${root}/crew/${a.id}/benches/main`, { default: true });
  assert.equal((await call('GET', `${root}/threads/${onSite.id}`)).data.thread.bench, 'website', 'moving the default does not move old chats');

  // removing a bench: the default falls back to Main
  const gone = await call('DELETE', `${root}/crew/${a.id}/benches/website`);
  assert.deepEqual(gone.data.crew.find((c) => c.id === a.id).benches.map((x) => x.id), ['main']);
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
