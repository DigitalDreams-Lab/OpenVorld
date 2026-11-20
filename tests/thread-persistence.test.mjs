import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
