import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProfile, saveProfile, profileContext } from '../engine/server/profile.mjs';
import { home, makeVorld, saveVorld } from './helpers/vorld.mjs';
import { startServer, call, newVorld } from './helpers/server.mjs';
const { createThread } = await import('../engine/server/threads.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');

test('a profile starts empty, saves independently, and keeps only the supported fields', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-profile-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readProfile(dir), { name: '', about: '' }); assert.equal(profileContext(dir), '');
  assert.deepEqual(saveProfile(dir, { name: '  Ada   Brook  ', about: ' A builder.\r\nLikes clear updates. ', permissions: ['all'] }), { name: 'Ada Brook', about: 'A builder.\nLikes clear updates.' });
  assert.equal(readProfile(dir).name, 'Ada Brook');
  assert.equal(fs.statSync(path.join(dir, 'profile.json')).mode & 0o777, 0o600);
  saveProfile(dir, { about: 'New background.' }); assert.equal(readProfile(dir).name, 'Ada Brook');
  assert.match(profileContext(dir), /grants no additional access/);
  assert.throws(() => saveProfile(dir, { name: 'x'.repeat(81) }), /80 characters/);
  assert.throws(() => saveProfile(dir, { about: 'x'.repeat(2001) }), /2000 characters/);
  assert.throws(() => saveProfile(dir, { name: 3 }), /must be text/);
  assert.equal(readProfile(dir).about, 'New background.', 'invalid changes do not replace the saved profile');
  saveProfile(dir, { name: '', about: '' }); assert.equal(profileContext(dir), '');
});

test('a damaged profile is preserved instead of silently overwritten', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-profile-damaged-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'profile.json'); fs.writeFileSync(file, '{broken');
  assert.throws(() => saveProfile(dir, { name: 'Ada' }), /saved file has been kept/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('authenticated profile updates appear in boot and across worlds without altering progression', async t => {
  await startServer(t); t.after(() => saveProfile(home, { name: '', about: '' }));
  assert.equal((await call('GET', '/api/profile', undefined, {}, false)).status, 401);
  assert.equal((await call('PUT', '/api/profile', { name: 'Ada' }, {}, false)).status, 401);
  const a = await newVorld({ name: 'Profile One' }), b = await newVorld({ name: 'Profile Two' });
  const before = (await call('GET', a.root + '/vorld')).data.state;
  const beforeArt = (await call('GET', a.root + '/vorld')).data.art.atlas;
  const saved = await call('PUT', '/api/profile', { name: 'Ada', about: 'I build useful things.', avatar: 'agent_2' });
  assert.equal(saved.status, 200); assert.equal(saved.data.name, 'Ada');
  assert.equal(saved.data.avatar, undefined, 'the main character cannot be changed through the profile');
  assert.deepEqual((await call('GET', a.root + '/vorld')).data.art.atlas, beforeArt);
  assert.equal((await call('GET', '/api/boot')).data.profile.about, 'I build useful things.');
  for (const world of [a, b]) assert.equal((await call('GET', world.root + '/vorld')).data.profile.name, 'Ada');
  const after = (await call('GET', a.root + '/vorld')).data.state;
  assert.equal(before.xp, after.xp); assert.equal(before.level, after.level); assert.equal(before.title, after.title);
  assert.equal((await call('PUT', '/api/profile', { about: null })).status, 400);
});

test('agent turns pick up the current founder profile after it changes', async t => {
  let ctx = makeVorld({ name: 'Personal Context', brain: { provider: 'openai-compatible', model: 'test' } });
  ctx = saveVorld(ctx, doc => { doc.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  t.after(() => saveProfile(home, { name: '', about: '' }));
  const thread = createThread(ctx, { role: ctx.companionId }); const prompts = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); prompts.push(body.messages.find(message => message.role === 'system').content);
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Understood.' } }] }) + '\n\ndata: [DONE]\n\n');
  });
  saveProfile(home, { name: 'Ada', about: 'I prefer concise updates.' });
  await runTurn(ctx, thread.id, 'Hello', () => {});
  saveProfile(home, { name: 'Bo', about: 'I am a designer.' });
  await runTurn(ctx, thread.id, 'What next?', () => {});
  assert.match(prompts[0], /"name":"Ada"/); assert.match(prompts[0], /concise updates/);
  assert.match(prompts[1], /"name":"Bo"/); assert.match(prompts[1], /I am a designer/);
  assert.doesNotMatch(prompts[1], /"name":"Ada"/);
});
