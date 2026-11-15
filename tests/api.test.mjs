import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';

test('a restarted server renews its token and retries rejected requests without reloading', async t => {
  const previous=Object.fromEntries(['document','DOMParser','fetch','location'].map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
  const meta={content:'old-token'}, calls=[];
  globalThis.document={querySelector:()=>meta};
  globalThis.location={reload(){assert.fail('onboarding must stay on the current page');}};
  globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>({content:'new-token'})};}};
  globalThis.fetch=async (url,options)=>{
    calls.push({url,options});
    if(url==='/')return {ok:true,text:async()=>'<meta name="ov-token" content="new-token">'};
    if(options.headers['x-ov-token']==='old-token')return {status:401};
    return {status:200,ok:true,json:async()=>({ok:true,title:'Lantern'})};
  };
  const {api}=await clientModule('engine/client/src/api.ts',{},true);
  const [vorld,boot]=await Promise.all([api('/vorlds',{body:{name:'Lantern'}}),api('/boot')]);
  assert.equal(vorld.title,'Lantern');assert.equal(boot.ok,true);
  assert.equal(meta.content,'new-token');
  assert.equal(calls.filter(c=>c.url==='/').length,1,'concurrent requests share token renewal');
  assert.equal(calls.filter(c=>c.url==='/api/vorlds').length,2);
  assert.equal(calls.findLast(c=>c.url==='/api/vorlds').options.body,JSON.stringify({name:'Lantern'}));
});

test('a stopped local server gives an actionable error and never repeats a possibly accepted write', async t => {
  const previous=Object.fromEntries(['document','fetch'].map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
  globalThis.document={querySelector:()=>({content:'token'})};
  let attempts=0;globalThis.fetch=async()=>{attempts++;throw new TypeError('Failed to fetch');};
  const {api}=await clientModule('engine/client/src/api.ts',{},true);
  await assert.rejects(api('/vorlds',{body:{answers:{}}}),/Cannot reach the local openVorld server/);
  assert.equal(attempts,1);
});

test('websocket uses the page token and cancels pending retries on cleanup', async t => {
  const previous = Object.fromEntries(['document','location','WebSocket'].map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(previous)) if(v===undefined) delete globalThis[k]; else globalThis[k]=v;});
  globalThis.document = {querySelector:()=>({content:'page token'})};
  globalThis.location = {protocol:'http:',host:'localhost:5173'};
  const sockets = [];
  globalThis.WebSocket = class {
    constructor(url) { this.url=url; sockets.push(this); }
    close() { this.onclose?.(); }
  };
  t.mock.timers.enable({apis:['setTimeout']});
  const {connect} = await clientModule('engine/client/src/api.ts', {}, true);
  const close = connect('old vorld',()=>{});
  assert.equal(sockets[0].url,'ws://localhost:5173/ws?t=page%20token&vorld=old%20vorld');
  sockets[0].onclose();
  close();
  t.mock.timers.tick(10000);
  assert.equal(sockets.length,1,'a departed game must not reopen its socket');
});

test('reconnection renews the token and asks the game to reload saved chats without reloading the page', async t => {
  const keys=['document','location','WebSocket','fetch','DOMParser'];
  const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
  const meta={content:'before-restart'}, sockets=[], messages=[];
  globalThis.document={querySelector:()=>meta};
  globalThis.location={protocol:'http:',host:'localhost:5185',reload(){assert.fail('keep the open chat');}};
  globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>({content:'after-restart'})};}};
  globalThis.fetch=async()=>({ok:true,text:async()=>'<meta>'});
  globalThis.WebSocket=class {constructor(url){this.url=url;sockets.push(this);}close(){this.onclose?.();}};
  t.mock.timers.enable({apis:['setTimeout']});
  const {connect}=await clientModule('engine/client/src/api.ts',{},true);
  const close=connect('w1',m=>messages.push(m));
  sockets[0].onopen();assert.deepEqual(messages,[]);
  sockets[0].onclose();t.mock.timers.tick(1000);
  sockets[1].onclose();t.mock.timers.tick(2000);
  sockets[2].onclose();t.mock.timers.tick(4000);
  sockets[3].onclose();
  for(let i=0;i<10;i++)await Promise.resolve();
  t.mock.timers.tick(8000);
  assert.ok(sockets[4].url.includes('t=after-restart'));
  sockets[4].onopen();
  assert.deepEqual(messages,[{type:'connection.restored'}]);
  close();
});
