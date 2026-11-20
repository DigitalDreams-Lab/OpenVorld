import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer, call, newVorld } from './helpers/server.mjs';
import { saveVorld, vorldCtx } from './helpers/vorld.mjs';
import { createThread, appendEvent, deleteThread, getThread, listThreads } from '../engine/server/threads.mjs';

test('threads, events and project bindings are readable after a fresh process starts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sf-persist-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const thread=createThread({dir},{role:'jax',kind:'forge',binding:{project:'/tmp/my-project'},title:'Earlier work'});
  const event=appendEvent({dir},thread.id,{type:'founder.message',text:'Remember this feature'});
  const moduleUrl=new URL('../engine/server/threads.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {listThreads,readEvents} from ${JSON.stringify(moduleUrl)}; const ctx={dir:process.argv[1]}; console.log(JSON.stringify({threads:listThreads(ctx,'jax'),events:readEvents(ctx,process.argv[2])}));`,dir,thread.id],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{threads:[thread],events:[event]});
});

test('a damaged history index is preserved instead of silently replaced', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'threads'));
  const file=path.join(dir,'threads/index.json');fs.writeFileSync(file,'[damaged');
  assert.throws(()=>listThreads({dir},'jax'),/history has been kept/);
  assert.throws(()=>createThread({dir},{role:'jax'}),/history has been kept/);
  assert.equal(fs.readFileSync(file,'utf8'),'[damaged');
});

test('an interrupted deletion hides the chat and can finish on retry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-delete-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { dir };
  const chat = createThread(ctx, { role: 'ada' });
  const other = createThread(ctx, { role: 'ada' });
  appendEvent(ctx, chat.id, { type: 'founder.message', text: 'Delete me' });
  const uploadDir = path.join(dir, 'threads', `${chat.id}.files`);
  fs.mkdirSync(uploadDir);
  fs.writeFileSync(path.join(uploadDir, 'upload.txt'), 'A copy');
  const rm = fs.rmSync;
  const remove = t.mock.method(fs, 'rmSync', (file, options) => {
    if (file === uploadDir) throw new Error('disk refused cleanup');
    return rm(file, options);
  });

  assert.throws(() => deleteThread(ctx, chat.id), /disk refused cleanup/);
  assert.throws(() => getThread(ctx, chat.id), { status: 404 });
  assert.deepEqual(listThreads(ctx), [other]);
  remove.mock.restore();
  deleteThread(ctx, chat.id);
  assert.equal(fs.existsSync(uploadDir), false);
  assert.deepEqual(listThreads(ctx), [other]);
});

test('a direct chat can only be deleted after its active reply finishes', { timeout: 5000 }, async (t) => {
  await startServer(t);
  const { isWorking } = await import('../engine/server/agents/runner.mjs');
  const { id, root } = await newVorld({
    crew: [{ name: 'Ada', job: 'Writer' }],
    brain: { provider: 'openai-compatible', model: 'slow-test' },
  });
  const ctx = saveVorld(vorldCtx(id), (doc) => {
    doc.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }];
  });
  const role = ctx.crew.find((member) => member.role === 'agent').id;
  const created = await call('POST', `${root}/threads`, { role });
  assert.equal(created.status, 200);
  const chat = created.data.id;
  const url = `${root}/threads/${chat}`;
  const dir = path.join(ctx.dir, 'threads');
  const log = path.join(dir, `${chat}.jsonl`);
  const files = path.join(dir, `${chat}.files`);
  const upload = await call('POST', `${url}/attachments`, Buffer.from('Some notes'), { 'x-file-name': 'notes.txt' });
  assert.equal(upload.status, 200);
  assert.ok(fs.existsSync(files));

  let markStarted, finishReply;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const reply = new Promise((resolve) => { finishReply = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    markStarted();
    await reply;
    const chunk = JSON.stringify({ choices: [{ delta: { content: 'Finished writing.' } }] });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`);
  });

  try {
    const sent = await call('POST', `${url}/messages`, { text: 'Write an outline', attachments: [upload.data.id] });
    assert.equal(sent.status, 200);
    await started;
    assert.equal(isWorking(chat), true);
    const before = fs.readFileSync(log, 'utf8');
    assert.match(before, /Write an outline/);
    assert.equal((await call('DELETE', url)).status, 409);
    assert.equal(fs.readFileSync(log, 'utf8'), before);
    assert.ok(fs.existsSync(files));
  } finally {
    finishReply();
  }

  while (isWorking(chat)) await delay(10, undefined, { signal: t.signal });
  assert.match(fs.readFileSync(log, 'utf8'), /Finished writing\./);
  assert.equal((await call('DELETE', url)).status, 200);
  assert.equal((await call('GET', url)).status, 404);
  assert.equal((await call('POST', `${url}/messages`, { text: 'A late message' })).status, 404);
  assert.equal(fs.existsSync(log), false);
  assert.equal(fs.existsSync(files), false);
});
