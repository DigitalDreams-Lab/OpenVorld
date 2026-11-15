import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as codex from '../engine/server/agents/drivers/codex.mjs';
import * as claude from '../engine/server/agents/drivers/claude.mjs';
import * as openai from '../engine/server/agents/drivers/openai.mjs';
import {imagesOf} from '../engine/server/agents/steps.mjs';

test('Codex and Claude receive native image attachments on new and resumed conversations',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-driver-files-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const oldPath=process.env.PATH,oldLog=process.env.SF_ATTACHMENT_DRIVER_LOG;
  process.env.PATH=dir+path.delimiter+oldPath;process.env.SF_ATTACHMENT_DRIVER_LOG=path.join(dir,'log.json');
  t.after(()=>{process.env.PATH=oldPath;if(oldLog===undefined)delete process.env.SF_ATTACHMENT_DRIVER_LOG;else process.env.SF_ATTACHMENT_DRIVER_LOG=oldLog;});
  const script=`#!${process.execPath}\nimport fs from 'node:fs';let stdin='';for await(const chunk of process.stdin)stdin+=chunk;fs.writeFileSync(process.env.SF_ATTACHMENT_DRIVER_LOG,JSON.stringify({args:process.argv.slice(2),stdin}));if(process.argv[1].endsWith('codex')){console.log(JSON.stringify({type:'thread.started',thread_id:'session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'I see the image'}}));}else console.log(JSON.stringify({type:'result',result:'I see the image'}));`;
  // No model calls: these tiny executables capture the real driver's process input.
  for(const name of ['codex','claude'])fs.writeFileSync(path.join(dir,name),script,{mode:0o700});
  const image={path:path.join(dir,'reference.png'),type:'image/png',data:'aW1hZ2U='};
  for(const sessionId of [null,'old-session']){
    await codex.run({system:'guide',prompt:'Review the files',images:[image],sessionId,cwd:dir,onEvent(){}});
    const c=JSON.parse(fs.readFileSync(process.env.SF_ATTACHMENT_DRIVER_LOG));
    assert.equal(c.args[c.args.indexOf('--image')+1],image.path);assert.match(c.stdin,/Review the files/);
    assert.equal(c.args.includes('resume'),!!sessionId);
    await claude.run({system:'guide',prompt:'Review the files',images:[image],sessionId,cwd:dir,onEvent(){}});
    const a=JSON.parse(fs.readFileSync(process.env.SF_ATTACHMENT_DRIVER_LOG));
    assert.equal(a.args[a.args.indexOf('--input-format')+1],'stream-json');
    const input=JSON.parse(a.stdin);assert.equal(input.message.content[1].source.data,image.data);assert.equal(input.message.content[1].source.media_type,'image/png');
    assert.equal(a.args.includes('--resume'),!!sessionId);
  }
});

test('API brains receive image content blocks, and tool result images are preserved',async t=>{
  let sent;t.mock.method(globalThis,'fetch',async(_u,options)=>{sent=JSON.parse(options.body);return new Response('data: {"choices":[{"delta":{"content":"Looks good"}}]}\n\ndata: [DONE]\n\n');});
  await openai.run({system:'guide',prompt:'Describe',images:[{type:'image/png',data:'aW1hZ2U='}],model:'vision-test',cfg:{base_url:'https://example.invalid/v1'},onEvent(){}});
  assert.deepEqual(sent.messages.at(-1).content,[{type:'text',text:'Describe'},{type:'image_url',image_url:{url:'data:image/png;base64,aW1hZ2U='}}]);
  assert.deepEqual(imagesOf([{type:'image',data:'aW1hZ2U=',mimeType:'image/png'},{type:'text',text:'done'}]),[{data:'aW1hZ2U=',type:'image/png'}]);
  assert.deepEqual(imagesOf([{type:'image',source:{type:'base64',data:'aW1hZ2U=',media_type:'image/webp'}}]),[{data:'aW1hZ2U=',type:'image/webp'}]);
});
