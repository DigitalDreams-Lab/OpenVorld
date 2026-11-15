// API keys of model endpoints: a variable name, or the key itself, kept apart from the vorld file and never echoed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adoptLegacyKeys, cleanProviders, hasKey, keyFor, looksLikeEnvName } from '../engine/server/keys.mjs';
import * as openai from '../engine/server/agents/drivers/openai.mjs';

const KEY = 'sk-test-0000-not-a-real-key-1234';    // made up: shaped like a provider key, with dashes and lowercase
const vorld = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-keys-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, id: 'demo', doc: { providers: [] } }; };

test('what is a variable name and what is a key', () => {
  for (const n of ['OPENROUTER_API_KEY', 'MY_KEY', '_X1']) assert.ok(looksLikeEnvName(n), n);
  for (const k of [KEY, 'gsk_AbC123def456', 'sk-ant-api03-xyz', 'my key', 'a', '']) assert.ok(!looksLikeEnvName(k), k);
});

test('a pasted key is stored apart, owner-only, and never returned in the providers to keep', (t) => {
  const ctx = vorld(t);
  const list = cleanProviders(ctx, [{ id: 'openai-compatible', name: 'openrouter', base_url: 'https://x/v1', api_key: KEY }, { id: 'openai-compatible', name: 'ollama', base_url: 'http://localhost:11434/v1' }]);
  assert.ok(!JSON.stringify(list).includes(KEY), 'the vorld file never holds it');
  assert.deepEqual(list.map((p) => p.api_key_env), [undefined, undefined]);
  assert.ok(hasKey(ctx, 'openrouter') && !hasKey(ctx, 'ollama'));
  assert.equal(fs.statSync(path.join(ctx.dir, 'provider-keys.json')).mode & 0o777, 0o600);
  assert.equal(keyFor(ctx, { name: 'openrouter' }).key, KEY);
  assert.equal(keyFor(ctx, { name: 'ollama' }).key, null, 'a local model needs none');
});

test('a variable name is read when used; a key typed in the name box is adopted, not echoed', (t) => {
  const ctx = vorld(t);
  const [byName] = cleanProviders(ctx, [{ name: 'a', api_key: 'GROQ_API_KEY' }]);
  assert.equal(byName.api_key_env, 'GROQ_API_KEY'); assert.ok(!hasKey(ctx, 'a'));
  assert.deepEqual(keyFor(ctx, byName, { GROQ_API_KEY: 'v' }), { key: 'v', missing: null });
  assert.deepEqual(keyFor(ctx, byName, {}), { key: null, missing: 'GROQ_API_KEY' }, 'the variable is named, never a value');
  const [wrongBox] = cleanProviders(ctx, [{ name: 'b', api_key_env: KEY }]);   // what the old Settings screen invited
  assert.equal(wrongBox.api_key_env, undefined); assert.equal(keyFor(ctx, { name: 'b' }).key, KEY);
  assert.deepEqual(keyFor(ctx, { name: 'c', api_key_env: KEY }), { key: KEY, missing: null }, 'even before it is moved, it works and is not reported as a missing variable');
});

test('forgetting a key, and removing an endpoint, remove the key', (t) => {
  const ctx = vorld(t);
  cleanProviders(ctx, [{ name: 'a', api_key: KEY }, { name: 'b', api_key: KEY + 'b' }]);
  cleanProviders(ctx, [{ name: 'a', remove_key: true }, { name: 'b' }]);
  assert.ok(!hasKey(ctx, 'a') && hasKey(ctx, 'b'));
  cleanProviders(ctx, [{ name: 'a' }]);
  assert.ok(!hasKey(ctx, 'b'), 'an endpoint that is gone takes its key with it');
  assert.ok(!fs.existsSync(path.join(ctx.dir, 'provider-keys.json')), 'no keys, no file');
});

test('a key already sitting in the vorld file is moved out and scrubbed from the chats', (t) => {
  const ctx = vorld(t);
  ctx.doc.providers = [{ id: 'openai-compatible', name: 'openai', base_url: 'https://api.openai.com/v1', api_key_env: KEY }, { id: 'openai-compatible', name: 'ok', api_key_env: 'OK_KEY' }];
  fs.mkdirSync(path.join(ctx.dir, 'threads'));
  fs.writeFileSync(path.join(ctx.dir, 'threads', 't.jsonl'), JSON.stringify({ type: 'turn.error', message: `environment variable ${KEY} is not set` }) + '\n');
  let saved;
  const n = adoptLegacyKeys(ctx, (c, mutate) => { const d = { providers: ctx.doc.providers }; mutate(d); saved = d; });
  assert.equal(n, 1);
  assert.deepEqual(saved.providers.map((p) => p.api_key_env), [undefined, 'OK_KEY'], 'only the key is cleared; a real variable name stays');
  assert.equal(keyFor(ctx, { name: 'openai' }).key, KEY);
  assert.ok(!fs.readFileSync(path.join(ctx.dir, 'threads', 't.jsonl'), 'utf8').includes(KEY), 'the chat no longer shows it');
  assert.equal(adoptLegacyKeys({ ...ctx, doc: { providers: [{ name: 'x', api_key_env: 'OK_KEY' }] } }, () => {}), 0);
});

test('the OpenAI-compatible driver sends the key, and an error names a variable, never a key', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (_u, o) => { seen.push(o.headers.authorization); return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'); });
  await openai.run({ system: 's', prompt: 'p', model: 'm', cfg: { base_url: 'https://x/v1', api_key: KEY }, onEvent() {} });
  assert.deepEqual(seen, [`Bearer ${KEY}`]);
  await assert.rejects(openai.run({ system: 's', prompt: 'p', model: 'm', cfg: { base_url: 'https://x/v1', api_key_env: 'NOT_SET_ANYWHERE_X', key_missing: 'NOT_SET_ANYWHERE_X' }, onEvent() {} }), (e) => /NOT_SET_ANYWHERE_X is not set/.test(e.message) && /Settings/.test(e.message));
  await assert.rejects(openai.run({ system: 's', prompt: 'p', model: 'm', cfg: { base_url: 'https://x/v1', api_key_env: 'NOT_SET_ANYWHERE_X' }, onEvent() {} }), /NOT_SET_ANYWHERE_X is not set/);
});
