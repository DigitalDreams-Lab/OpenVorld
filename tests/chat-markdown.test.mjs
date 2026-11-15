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
const {Markdown}=await vite.ssrLoadModule('/src/ui/Markdown.tsx');
const {setState}=await vite.ssrLoadModule('/src/store.ts');setState({vorldId:'demo'});
test.after(async()=>{await vite.close();fs.rmSync(cache,{recursive:true,force:true});if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
const render=text=>renderToStaticMarkup(React.createElement(Markdown,{text,thread:'thread-1'}));

test('chat renders clickable named/bare links, nested formatting, tables, tasks and highlighted code',()=>{
  const html=render('## Release\n\n[Take **A**](https://suno.com/song/example) and https://example.com/test.\n\n1. First\n   - Nested **item**\n2. Next\n\n- [x] Shipped\n- [ ] Reviewed\n\n| File | State |\n| --- | --- |\n| `app.ts` | Ready |\n\n```js\nconst ready = true;\n```');
  assert.match(html,/<h2>Release<\/h2>/);
  assert.match(html,/<a href="https:\/\/suno.com\/song\/example"[^>]*>Take <strong>A<\/strong><\/a>/);
  assert.match(html,/href="https:\/\/example.com\/test"/);
  assert.match(html,/<ol>[\s\S]*<ul>[\s\S]*Nested <strong>item<\/strong>/);
  assert.match(html,/type="checkbox"[^>]*checked/);
  assert.match(html,/<th>File<\/th>/);assert.match(html,/<td>Ready<\/td>/);
  assert.match(html,/class="hljs-keyword">const/);assert.match(html,/>Copy<\/button>/);
});

test('chat escapes HTML, blocks executable URLs and serves local file links through the authenticated conversation route',()=>{
  const html=render('[bad](javascript:alert%281%29) ![bad](data:text/html,bad)\n\n<script>alert(1)</script>\n\n[Source](</Users/test/My Project/app.ts:12>)');
  assert.doesNotMatch(html,/<script|href="javascript:|src="data:/);
  assert.match(html,/href="\/api\/vorlds\/demo\/threads\/thread-1\/file\?path=%2FUsers%2Ftest%2FMy%20Project%2Fapp.ts"/);
});
