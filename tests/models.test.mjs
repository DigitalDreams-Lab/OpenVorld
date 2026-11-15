// The model pickers list what each provider offers: static values, a CLI's list, an endpoint's list, or only what was typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from '../engine/server/models.mjs';

test('static providers list their values and tier defaults, plus the model chosen now', async () => {
  const def = { models: { source: 'static', values: ['opus', 'sonnet', 'haiku'], tiers: { deep: 'opus', balanced: 'sonnet', fast: 'haiku' } } };
  const r = await listModels({ id: 'static-test', def, current: ['my-own-model'] });
  assert.deepEqual(r.models, ['opus', 'sonnet', 'haiku', 'my-own-model']);
  assert.equal(r.tiers.balanced, 'sonnet');
});

test('a CLI that prints its models is asked once, and its lines become the list', async () => {
  let calls = 0;
  const exec = async (cmd, args) => { calls++; return `${cmd} ${args}\n\ngemini-pro   the big one\nflash\n`.replace(/^.*\n/, ''); };
  const def = { models: { source: 'command', command: ['agy', 'models'] } };
  const a = await listModels({ id: 'cmd-test', def, exec });
  assert.deepEqual(a.models, ['gemini-pro', 'flash']);
  await listModels({ id: 'cmd-test', def, exec });
  assert.equal(calls, 1, 'cached for a minute');
  assert.equal((await listModels({ id: 'cmd-missing', def, exec: async () => null })).live, false, 'a missing CLI just gives no list');
});

test('an endpoint lists its models with the key from the environment, which never comes back', async () => {
  let seen;
  const fetcher = async (url, o) => { seen = { url, auth: o.headers.authorization }; return { ok: true, json: async () => ({ data: [{ id: 'llama3' }, { id: 'qwen' }] }) }; };
  const def = { models: { source: 'endpoint', path: '/models' } };
  const r = await listModels({ id: 'ep-test', def, instance: { base_url: 'http://localhost:11434/v1/', api_key_env: 'MY_KEY', models: { fast: 'qwen' } }, env: { MY_KEY: 'secret-value' }, fetcher });
  assert.equal(seen.url, 'http://localhost:11434/v1/models');
  assert.equal(seen.auth, 'Bearer secret-value');
  assert.deepEqual(r.models, ['llama3', 'qwen']);
  assert.ok(!JSON.stringify(r).includes('secret-value'));
  const down = await listModels({ id: 'ep-down', def, instance: { base_url: 'http://x' }, fetcher: async () => { throw new Error('down'); } });
  assert.deepEqual(down.models, []);
});

test('providers whose models are typed in Settings list what the founder typed', async () => {
  const r = await listModels({ id: 'typed-test', def: { models: { source: 'settings' } }, instance: { models: { balanced: 'gpt-x' } } });
  assert.deepEqual(r.models, ['gpt-x']);
});

test('a tool that keeps its own model list in a JSON file is read from it, skipping hidden entries', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-models-')), file = path.join(dir, 'cache.json');
  fs.writeFileSync(file, JSON.stringify({ models: [{ slug: 'a', visibility: 'list' }, { slug: 'secret', visibility: 'hide' }, { slug: 'b', visibility: 'list' }] }));
  try {
    const def = { models: { source: 'file', path: file, list: 'models', key: 'slug', hide_when: { visibility: 'hide' } } };
    assert.deepEqual((await listModels({ id: 'file-test', def })).models, ['a', 'b']);
    assert.deepEqual((await listModels({ id: 'file-missing', def: { models: { source: 'file', path: path.join(dir, 'nope.json'), list: 'models' } } })).models, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
