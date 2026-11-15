import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createThread, appendEvent, history } from '../engine/server/threads.mjs';
import { saveAttachment, getAttachment, resolveAttachments, attachmentPrompt, replyFile, allowReplyFile, threadAttachments, MAX_FILE, addReferences } from '../engine/server/attachments.mjs';
import {engineTools} from '../engine/server/agents/tools.mjs';
import { loadPacks, packRoots } from '../tools/lib/packs.mjs';
import { grant, grantsOf, BOOT } from '../engine/server/gate.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');

test('uploads belong to one chat, keep original names, and survive a fresh context',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ov-files-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ctx={dir,id:'demo',packs:loadPacks(packRoots(dir))}, a=createThread(ctx,{role:'guide'}), b=createThread(ctx,{role:'smith'});
  const image=saveAttachment(ctx,a.id,'../../photo.png',png), notes=saveAttachment(ctx,a.id,'plan.json',Buffer.from('{"goal":"Ship"}'));
  assert.equal(image.name,'photo.png');assert.equal(image.type,'image/png');
  assert.equal(fs.readFileSync(getAttachment({...ctx},a.id,notes.id).path,'utf8'),'{"goal":"Ship"}');
  assert.equal(fs.statSync(getAttachment(ctx,a.id,image.id).path).mode&0o777,0o600);
  assert.throws(()=>getAttachment(ctx,b.id,image.id),/not found/);
  assert.throws(()=>getAttachment(ctx,a.id,'../../vorld.yaml'),/not found/);
  assert.throws(()=>resolveAttachments(ctx,b.id,[image.id]),/not found/);
  const spoof=saveAttachment(ctx,a.id,'fake.png',Buffer.from('<script>alert(1)</script>'));
  assert.equal(spoof.type,'application/octet-stream','MIME labels do not turn arbitrary bytes into inline images');
  appendEvent(ctx,a.id,{type:'founder.message',text:'Review',attachments:[image,notes]});
  assert.equal(threadAttachments({...ctx},a.id).length,2);
  assert.equal(history(ctx,a.id)[0].attachments[0].id,image.id);
  const files=resolveAttachments(ctx,a.id,[image.id,notes.id]);
  const prompt=attachmentPrompt('Review',files);
  assert.ok(prompt.includes(files[0].path)&&prompt.includes(files[1].path));
  assert.doesNotMatch(prompt,/"goal":"Ship"/);
  assert.ok(!prompt.includes(png.toString('base64')));
});

test('local reply links respect conversation folder access and reject symlink escapes and secrets',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ov-links-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ctx={dir,id:'demo',packs:loadPacks(packRoots(dir))}, thread=createThread(ctx,{role:'guide'});
  fs.writeFileSync(path.join(dir,'grants.yaml'),'grants: []\n');
  const workspace=path.join(dir,'workbenches/guide');fs.mkdirSync(workspace,{recursive:true});
  fs.writeFileSync(path.join(workspace,'preview.png'),png);
  fs.writeFileSync(path.join(dir,'secret.txt'),'outside');
  fs.writeFileSync(path.join(workspace,'.env'),'KEY=secret');
  fs.symlinkSync(path.join(dir,'secret.txt'),path.join(workspace,'escape.txt'));
  assert.equal(replyFile(ctx,thread.id,'preview.png').type,'image/png');
  assert.throws(()=>replyFile(ctx,thread.id,'../../secret.txt'),/outside/);
  assert.throws(()=>replyFile(ctx,thread.id,'escape.txt'),/outside/);
  assert.throws(()=>replyFile(ctx,thread.id,'.env'),/outside/);
  fs.writeFileSync(path.join(dir,'project','brief.md'),'Shared');
  assert.equal(replyFile(ctx,thread.id,path.join(dir,'project','brief.md')).data.toString(),'Shared','the vorld project folder is open to the whole crew');
  const project=path.join(dir,'granted');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'report.md'),'Ready');
  grant(ctx,{role:'guide',capability:'fs.read',scope:project+'/**'});
  assert.equal(replyFile(ctx,thread.id,path.join(project,'report.md')).data.toString(),'Ready');
});

test('a link to a file outside the chat\u2019s folders can be allowed for this session, that one file only',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ov-outside-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ctx={dir,id:'demo',packs:loadPacks(packRoots(dir))}, thread=createThread(ctx,{role:'guide'});
  fs.writeFileSync(path.join(dir,'grants.yaml'),'grants: []\n');
  const away=path.join(dir,'elsewhere');fs.mkdirSync(away);
  const pic=path.join(away,'made.png'),next=path.join(away,'other.png');fs.writeFileSync(pic,png);fs.writeFileSync(next,png);
  let err;try{replyFile(ctx,thread.id,pic);}catch(e){err=e;}
  assert.equal(err.status,403);assert.equal(err.code,'outside','the chat can tell this apart and offer to allow it');assert.equal(err.path,fs.realpathSync(pic));
  const r=allowReplyFile(ctx,thread.id,pic);
  assert.deepEqual(r.roles,['guide']);
  assert.equal(replyFile(ctx,thread.id,pic).type,'image/png','allowed now');
  assert.throws(()=>replyFile(ctx,thread.id,next),/outside/,'the neighbouring file stays closed');
  const g=grantsOf(ctx,'guide').find(x=>x.capability==='fs.read');
  assert.equal(g.scope,fs.realpathSync(pic));assert.equal(g.answer,'session');assert.equal(g.session,BOOT,'it ends when the game closes');
  allowReplyFile(ctx,thread.id,pic);assert.equal(grantsOf(ctx,'guide').filter(x=>x.capability==='fs.read').length,1,'asking twice does not stack grants');
  // what can never be shared, and what is not a file
  fs.mkdirSync(path.join(dir,'sshlike'));
  fs.writeFileSync(path.join(away,'.env'),'KEY=1');
  let never;try{replyFile(ctx,thread.id,path.join(away,'.env'));}catch(e){never=e;}
  assert.equal(never.status,403);assert.equal(never.code,undefined,'a secret is not offered');
  assert.throws(()=>allowReplyFile(ctx,thread.id,path.join(away,'.env')),/never be shared/);
  assert.throws(()=>allowReplyFile(ctx,thread.id,away),/not found/i,'a folder is not a file');
  assert.throws(()=>allowReplyFile(ctx,thread.id,path.join(away,'missing.png')),/not found/i);
});

test('original-path references have no upload size/count cap and do not copy or grant neighboring files',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-original-refs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ctx={dir,id:'demo',packs:loadPacks(packRoots(dir))},thread=createThread(ctx,{role:'guide'});
  fs.writeFileSync(path.join(dir,'grants.yaml'),'grants: []\n');
  const source=path.join(dir,'originals');fs.mkdirSync(source);
  const huge=path.join(source,'large-dataset.bin'),fd=fs.openSync(huge,'w');fs.ftruncateSync(fd,1024**3);fs.closeSync(fd);
  const paths=[huge,...Array.from({length:20},(_,i)=>{const file=path.join(source,`notes-${i}.txt`);fs.writeFileSync(file,`original ${i}`);return file;})];
  const refs=addReferences(ctx,thread.id,paths);
  assert.equal(refs.length,21);assert.equal(refs[0].size,1024**3);assert.equal(refs[0].kind,'reference');
  assert.equal(fs.readdirSync(path.join(dir,'threads',thread.id+'.files')).filter(p=>!p.endsWith('.json')).length,0,'only metadata is stored');
  const files=resolveAttachments(ctx,thread.id,refs.map(f=>f.id));assert.equal(files.length,21);
  assert.equal(getAttachment({...ctx},thread.id,refs[0].id).path,fs.realpathSync(huge));
  assert.ok(attachmentPrompt('Review',files).includes(fs.realpathSync(huge)));
  fs.writeFileSync(paths[1],'Updated original');assert.equal(fs.readFileSync(getAttachment(ctx,thread.id,refs[1].id).path,'utf8'),'Updated original');
  const workspace=path.join(dir,'workbenches/guide');fs.mkdirSync(workspace,{recursive:true});
  const reader=engineTools({ctx,role:'guide',cwd:workspace,readRoots:[files[1].path]});
  assert.equal((await reader.run('read_file',{path:files[1].path})).ok,true);
  assert.equal((await reader.run('read_file',{path:files[2].path})).ok,false,'one reference does not grant the parent folder');
  const badFile=path.join(source,'.env');fs.writeFileSync(badFile,'SECRET=1');
  assert.throws(()=>addReferences(ctx,thread.id,[badFile]),/access policy/);
  assert.throws(()=>addReferences(ctx,thread.id,['relative.txt']),/absolute/);
  const outside=createThread(ctx,{role:'other'});assert.throws(()=>getAttachment(ctx,outside.id,refs[0].id),/not found/);
});
