import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer,call,newWorld} from './helpers/server.mjs';

test('the authenticated upload/download/message routes keep files in their own chat and retain them in history',async t=>{
  const {home}=await startServer(t);
  const {id,root}=await newWorld();
  const {worldCtx}=await import('../engine/server/world.mjs');const ctx=worldCtx(id);
  const thread=(await call('POST',root+'/threads',{role:ctx.companionId})).data;
  const other=(await call('POST',root+'/threads',{role:ctx.companionId})).data;
  const upload=root+`/threads/${thread.id}/attachments`;
  const original=path.join(home,'original.txt');fs.writeFileSync(original,'Original reference');
  const reference=await call('POST',root+`/threads/${thread.id}/references`,{paths:[original]});
  assert.equal(reference.status,200);assert.equal(reference.data[0].kind,'reference');
  assert.equal((await call('GET',reference.data[0].url)).data.toString(),'Original reference','reference previews stream the original file');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  assert.equal((await call('POST',upload,bytes,{},false)).status,401);
  const saved=await call('POST',upload,bytes,{'x-file-name':encodeURIComponent('画面.png')});
  assert.equal(saved.status,200);assert.equal(saved.data.name,'画面.png');assert.equal(saved.data.type,'image/png');
  const fetched=await call('GET',saved.data.url);assert.equal(fetched.status,200);assert.deepEqual(fetched.data,bytes);assert.match(fetched.headers['content-disposition'],/^inline/);
  assert.equal((await call('GET',saved.data.url,undefined,{},false)).status,401);
  assert.equal((await call('GET',root+`/threads/${other.id}/attachments/${saved.data.id}`)).status,404);
  assert.equal((await call('POST',root+`/threads/${other.id}/messages`,{text:'wrong chat',attachments:[saved.data.id]})).status,404);
  assert.equal((await call('POST',root+`/threads/${thread.id}/messages`,{text:'',attachments:[saved.data.id]})).status,200);
  for(let i=0;i<300;i++){const state=await call('GET',root+`/threads/${thread.id}`);if(state.data.thread.state!=='working')break;await delay(10);}
  const loaded=(await call('GET',root+`/threads/${thread.id}`)).data;
  assert.equal(loaded.events.find(e=>e.type==='founder.message').attachments[0].id,saved.data.id);
  assert.ok(loaded.events.some(e=>e.type==='agent.text'));
  assert.equal((await call('GET',root+`/threads/${thread.id}/file?path=${encodeURIComponent('/etc/passwd')}`)).status,403);
  assert.equal((await call('GET',saved.data.url)).status,200,'chats keep their files');
});
