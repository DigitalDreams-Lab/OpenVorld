import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {home,makeWorld,saveWorld} from './helpers/world.mjs';
const {createThread,readEvents}=await import('../engine/server/threads.mjs');
const {saveAttachment,resolveAttachments}=await import('../engine/server/attachments.mjs');
const {runTurn}=await import('../engine/server/agents/runner.mjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function setup(name,provider) {
  let ctx=makeWorld({name,brain:{provider,model:'reference-test'}});
  ctx=saveWorld(ctx,d=>{d.providers=[{id:'openai-compatible',base_url:'https://example.invalid/v1'}];});
  const role=ctx.companionId;
  const thread=createThread(ctx,{role}), image=saveAttachment(ctx,thread.id,'screen.png',png), notes=saveAttachment(ctx,thread.id,'notes.md',Buffer.from('Only load this sentence when requested.'));
  return {ctx,role,thread,files:resolveAttachments(ctx,thread.id,[image.id,notes.id])};
}
const sse=deltas=>new Response(deltas.map(delta=>'data: '+JSON.stringify({choices:[{delta}]})+'\n\n').join('')+'data: [DONE]\n\n');

test('API turns start with references and load text/images only through requested tools',async t=>{
  const {ctx,thread,files}=await setup('API References','openai-compatible');let round=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const body=JSON.parse(options.body);round++;
    if(round===1||round===3){
      const serialized=JSON.stringify(body.messages);
      assert.ok(serialized.includes('notes.md')&&serialized.includes('screen.png'));
      assert.ok(!serialized.includes(png.toString('base64')));
      assert.ok(!serialized.includes('Only load this sentence'));
      assert.ok(body.messages.every(m=>typeof m.content==='string'));
    }
    if(round===1)return sse([{tool_calls:[
      {index:0,id:'text',function:{name:'read_file',arguments:JSON.stringify({path:files[1].path})}},
      {index:1,id:'image',function:{name:'read_image',arguments:JSON.stringify({path:files[0].path})}},
    ]}]);
    if(round===2){
      const calls=body.messages.filter(m=>m.role==='tool');assert.equal(calls.length,2);
      assert.match(calls[0].content,/Only load this sentence/);
      assert.equal(body.messages.at(-1).content[1].image_url.url,'data:image/png;base64,'+png.toString('base64'));
    }
    return sse([{content:'Reviewed the references.'}]);
  });
  await runTurn(ctx,thread.id,'Review these',()=>{},files);
  const reply=readEvents(ctx,thread.id).find(e=>e.type==='agent.text');
  assert.equal(reply.steps.find(s=>s.name==='read_image').attachments[0].id,files[0].id,'the opened image reuses its saved reference');
  await runTurn(ctx,thread.id,'What next?',()=>{});
  assert.equal(round,3,'a later turn does not resend earlier file contents');
});

test('local CLI agents receive saved paths without automatic native image inputs or excerpts',async t=>{
  const bin=path.join(home,'bin');fs.mkdirSync(bin);const log=path.join(bin,'calls.jsonl');
  const oldPath=process.env.PATH;process.env.PATH=bin+path.delimiter+oldPath;t.after(()=>{process.env.PATH=oldPath;});
  const script=`#!${process.execPath}\nimport fs from 'node:fs';let text='';for await(const chunk of process.stdin)text+=chunk;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),text})+'\\n');if(process.argv[1].endsWith('codex')){console.log(JSON.stringify({type:'thread.started',thread_id:'session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Reference noted'}}));}else console.log(JSON.stringify({type:'result',result:'Reference noted'}));`;
  for(const name of ['codex','claude'])fs.writeFileSync(path.join(bin,name),script,{mode:0o700});
  for(const provider of ['codex','claude-code']){
    const {ctx,thread,files}=await setup('References '+provider,provider);
    await runTurn(ctx,thread.id,'Keep these references',()=>{},files);
    await runTurn(ctx,thread.id,'Review this reference now',()=>{},files);
    const calls=fs.readFileSync(log,'utf8').trim().split('\n').slice(-2).map(JSON.parse);
    for(const c of calls){
      assert.ok(!c.args.includes('--image'));assert.ok(!c.args.includes('--input-format'));
      assert.ok(c.text.includes(files[0].path)&&c.text.includes(files[1].path));
      assert.ok(!c.text.includes('Only load this sentence'));assert.ok(!c.text.includes(png.toString('base64')));
    }
    assert.ok(calls[1].args.includes(provider==='codex'?'resume':'--resume'));
  }
});
