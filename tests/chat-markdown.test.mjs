import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const previous=globalThis.document;globalThis.document={querySelector:()=>null};
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'ov-md-cache-'));
const vite=await createServer({configFile:false,root:process.cwd()+'/engine/client',cacheDir:cache,logLevel:'silent',server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
const {Markdown,copyText}=await vite.ssrLoadModule('/src/ui/Markdown.tsx');
const {setState}=await vite.ssrLoadModule('/src/store.ts');setState({vorldId:'demo'});
test.after(async()=>{await vite.close();fs.rmSync(cache,{recursive:true,force:true});if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
const render=text=>renderToStaticMarkup(React.createElement(Markdown,{text,thread:'thread-1'}));

test('chat renders clickable named/bare links, nested formatting, tables, tasks and highlighted code',()=>{
  const html=render('## Release\n\n[Take **A**](https://suno.com/song/example) and https://example.com/test.\n\n1. First\n   - Nested **item**\n2. Next\n\n- [x] Shipped\n- [ ] Reviewed\n\n| File | State |\n| --- | --- |\n| `app.ts` | Ready |\n\n```js\nconst ready = true;\n```');
  assert.match(html,/<h2 dir="auto">Release<\/h2>/);
  assert.match(html,/<a href="https:\/\/suno.com\/song\/example"[^>]*>Take <strong>A<\/strong><\/a>/);
  assert.match(html,/href="https:\/\/example.com\/test"/);
  assert.match(html,/<ol dir="auto">[\s\S]*<ul dir="auto">[\s\S]*Nested <strong>item<\/strong>/);
  assert.match(html,/type="checkbox"[^>]*checked/);
  assert.match(html,/<th>File<\/th>/);assert.match(html,/<td dir="auto">Ready<\/td>/);
  assert.match(html,/class="hljs-keyword">const/);assert.match(html,/>Copy<\/button>/);
});

test('chat prose detects direction by block while code keeps its own direction', () => {
  const html = render('سلام! اوضاع **YBee** چطوره؟\n\nEnglish with עברית inside.\n\n> سلام با `npm test`\n\n- פריט ראשון\n\n```js\nconsole.log("سلام");\n```');
  assert.match(html, /<p dir="auto">سلام! اوضاع <strong>YBee<\/strong> چطوره؟<\/p>/);
  assert.match(html, /<p dir="auto">English with עברית inside\.<\/p>/);
  assert.match(html, /<blockquote dir="auto">\s*<p>سلام با <code dir="ltr">npm test<\/code>/);
  assert.match(html, /<ul dir="auto">\s*<li>פריט ראשון<\/li>/);
  assert.match(html, /<div class="code-block" dir="ltr">/);
});

test('chat escapes HTML, blocks executable URLs and serves local file links through the authenticated conversation route',()=>{
  const html=render('[bad](javascript:alert%281%29) ![bad](data:text/html,bad)\n\n<script>alert(1)</script>\n\n[Source](</Users/test/My Project/app.ts:12>)');
  assert.doesNotMatch(html,/<script|href="javascript:|src="data:/);
  assert.match(html,/href="\/api\/vorlds\/demo\/threads\/thread-1\/file\?path=%2FUsers%2Ftest%2FMy%20Project%2Fapp.ts"/);
});

test('renderable code blocks offer previews and local artifact links open as previewable files',()=>{
  const html=render('```html\n<h1>Report</h1>\n```\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```\n\n[Open report](</tmp/My Project/report.html>)\n\n```csv\nName,Count\nAda,3\n```');
  assert.equal((html.match(/>Preview<\/button>/g)??[]).length,3);
  assert.equal((html.match(/>Expand preview<\/button>/g)??[]).length,3);
  assert.match(html,/title="Preview file"/);assert.match(html,/path=%2Ftmp%2FMy%20Project%2Freport.html/);
  assert.doesNotMatch(html,/<h1>Report<\/h1>/,'HTML stays isolated from the chat document');
});

test('copy uses the Clipboard API and falls back to a selection copy when it is missing or denied',async t=>{
  const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator'),page=globalThis.document;
  t.after(()=>{globalThis.document=page;if(saved)Object.defineProperty(globalThis,'navigator',saved);else delete globalThis.navigator;});
  const browser=clipboard=>Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard}});
  const log=[];let works=true;
  const area={style:{},select:()=>log.push('select'),remove:()=>log.push('remove')};
  globalThis.document={querySelector:()=>null,activeElement:{focus:()=>log.push('focus')},createElement:tag=>(log.push(tag),area),body:{appendChild:()=>log.push('append')},execCommand:command=>(log.push(command+':'+area.value),works)};
  const written=[];browser({writeText:async text=>{written.push(text);}});
  await copyText('npm test');assert.deepEqual(written,['npm test']);assert.deepEqual(log,[]);
  browser({writeText:async()=>{throw new DOMException('Write permission denied.','NotAllowedError');}});
  await copyText('one\ntwo');assert.deepEqual(log,['textarea','append','select','copy:one\ntwo','remove','focus']);assert.equal(area.readOnly,true);
  log.length=0;browser(undefined);   // plain http on a LAN host: no navigator.clipboard at all
  await copyText('three');assert.ok(log.includes('copy:three'));
  log.length=0;works=false;
  await assert.rejects(copyText('four'),/Could not copy/);assert.deepEqual(log.slice(-2),['remove','focus']);
});
