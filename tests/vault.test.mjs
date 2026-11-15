// The house and its vault: private to the member, names only for the model, values only through a secret.use writ.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeVorld } from './helpers/vorld.mjs';
import { startServer, call, newVorld } from './helpers/server.mjs';
import { grant, checkFolder, checkScope } from '../engine/server/gate.mjs';
import { setSecret, removeSecret, listSecrets, hasSecret, heldSecrets, substitute, redactSecrets, redactEvent, vaultHelp, houseDir, vaultDir } from '../engine/server/house.mjs';

const SECRET = 'sk-live-0123456789abcdef';

test('vault: secrets are named in capitals, kept owner-only, listed by name and length only', () => {
  const ctx = makeVorld();
  const name = setSecret(ctx, 'companion', 'yt client secret', SECRET);
  assert.equal(name, 'YT_CLIENT_SECRET');
  assert.deepEqual(listSecrets(ctx, 'companion'), [{ name: 'YT_CLIENT_SECRET', length: SECRET.length }]);
  assert.ok(!JSON.stringify(listSecrets(ctx, 'companion')).includes(SECRET), 'the listing never carries a value');
  const file = path.join(vaultDir(ctx, 'companion'), 'secrets.env');
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'only the owner can read the file');
  assert.equal(fs.statSync(vaultDir(ctx, 'companion')).mode & 0o077, 0);
  assert.ok(file.startsWith(houseDir(ctx, 'companion')), 'the vault lives in the house');
  assert.throws(() => setSecret(ctx, 'companion', 'x', SECRET), /name the secret/);
  assert.throws(() => setSecret(ctx, 'companion', 'SHORT_ONE', 'abc'), /at least/);
  assert.throws(() => vaultDir(ctx, '../escape'), /bad crew member/);
  assert.equal(hasSecret(ctx, 'companion', 'YT_CLIENT_SECRET'), true);
  removeSecret(ctx, 'companion', 'YT_CLIENT_SECRET');
  assert.equal(hasSecret(ctx, 'companion', 'YT_CLIENT_SECRET'), false);
  assert.throws(() => removeSecret(ctx, 'companion', 'YT_CLIENT_SECRET'), /no such secret/);
});

test('vault: a secret is usable only with its own writ; %NAME% is swapped and values are hidden again', () => {
  const ctx = makeVorld();
  setSecret(ctx, 'companion', 'API_TOKEN', SECRET);
  setSecret(ctx, 'companion', 'OTHER_TOKEN', 'another-secret-value');
  const asked = [];
  assert.throws(() => substitute(ctx, 'companion', ['curl', '-H', 'Bearer %API_TOKEN%'], (a) => asked.push(a)), /no writ to use the secret API_TOKEN/);
  assert.deepEqual(asked.map((a) => [a.capability, a.scope]), [['secret.use', 'API_TOKEN']], 'the first use asks the founder');
  assert.deepEqual(heldSecrets(ctx, 'companion'), {});

  grant(ctx, { role: 'companion', capability: 'secret.use', scope: 'API_TOKEN', answer: 'always' });
  assert.deepEqual(substitute(ctx, 'companion', ['curl', '-H', 'Bearer %API_TOKEN%', 'https://x.test/a%20b']), ['curl', '-H', `Bearer ${SECRET}`, 'https://x.test/a%20b'], 'a %WORD% that is no secret stays as it is');
  assert.deepEqual(Object.keys(heldSecrets(ctx, 'companion')), ['API_TOKEN'], 'the writ is per name');
  assert.throws(() => substitute(ctx, 'companion', ['%OTHER_TOKEN%']), /OTHER_TOKEN/);

  assert.equal(redactSecrets(ctx, 'companion', `ok ${SECRET} and another-secret-value`), 'ok $API_TOKEN and $OTHER_TOKEN', 'every vault value is hidden, held or not');
  assert.deepEqual(redactEvent(ctx, 'companion', { type: 'tool', output: `got ${SECRET}`, target: 'x', detail: { note: SECRET } }), { type: 'tool', output: 'got $API_TOKEN', target: 'x', detail: { note: '$API_TOKEN' } });
  assert.equal(redactSecrets(makeVorld(), 'companion', SECRET), SECRET, 'another vorld knows nothing of it');

  const help = vaultHelp(ctx, 'companion');
  assert.ok(help.includes('API_TOKEN') && help.includes('OTHER_TOKEN') && !help.includes(SECRET), 'the prompt names the secrets, never the values');
  assert.equal(vaultHelp(makeVorld(), 'companion'), '', 'an empty vault adds nothing to the prompt');
});

test('house: no folder writ or workbench can ever hold the houses', () => {
  const ctx = makeVorld();
  setSecret(ctx, 'companion', 'API_TOKEN', SECRET);
  const houses = path.join(ctx.dir, 'houses');
  for (const p of [houses, houseDir(ctx, 'companion'), vaultDir(ctx, 'companion'), ctx.dir]) {
    assert.throws(() => checkFolder(ctx, 'fs.write', p), /private houses|too broad|never/, p);
    assert.throws(() => checkScope(ctx, 'fs.read', path.join(p, 'secrets.env')), Error);
  }
  assert.throws(() => checkScope(ctx, 'secret.use', 'lower_case'), /name a secret/);
  assert.equal(checkScope(ctx, 'secret.use', 'YT_TOKEN'), 'YT_TOKEN');
});

test('vault routes: values go in and never come out; a secret.use writ needs a secret that exists', async (t) => {
  await startServer(t);
  const { root } = await newVorld();
  const me = (await call('GET', `${root}/vorld`)).data.crew[0].id;
  const put = await call('POST', `${root}/crew/${me}/vault/secrets`, { name: 'yt_token', value: SECRET });
  assert.equal(put.status, 200);
  assert.deepEqual(put.data.secrets, [{ name: 'YT_TOKEN', length: SECRET.length }]);
  const view = await call('GET', `${root}/crew/${me}/vault`);
  assert.equal(JSON.stringify(view.data).includes(SECRET), false, 'the vault view carries no value');
  assert.equal(view.data.signin.role, me);
  assert.equal((await call('POST', `${root}/crew/${me}/vault/secrets`, { name: 'bad name', value: 'x' })).status, 400);
  assert.equal((await call('POST', `${root}/crew/nobody/vault/secrets`, { name: 'ABC_DEF', value: SECRET })).status, 404);
  assert.equal(JSON.stringify((await call('GET', `${root}/vorld`)).data).includes(SECRET), false, 'the vorld view never carries a value');

  // a bench cannot be made inside a house
  const house = houseDir({ dir: path.join(process.env.OPENVORLD_HOME, 'vorlds', root.split('/').pop()) }, me);
  const inside = await call('POST', `${root}/crew/${me}/benches`, { name: 'sneaky', path: house });
  assert.equal(inside.status, 400);

  const gone = await call('DELETE', `${root}/crew/${me}/vault/secrets/YT_TOKEN`);
  assert.deepEqual(gone.data.secrets, []);
  assert.equal((await call('DELETE', `${root}/crew/${me}/vault/secrets/YT_TOKEN`)).status, 404);
});
