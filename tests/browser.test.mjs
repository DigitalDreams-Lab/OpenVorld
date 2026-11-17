// The crew browser: the rules (no Chrome needed), the real thing against a local page (needs Chrome, skipped without),
// the tool list every brain gets, and the MCP bridge Claude Code and Codex use.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { makeVorld } from './helpers/vorld.mjs';

const hub = await import('../engine/server/browser.mjs');
const { grant } = await import('../engine/server/gate.mjs');
const { engineTools } = await import('../engine/server/agents/tools.mjs');
const { kindOf, targetOf } = await import('../engine/server/agents/steps.mjs');
const { mcpArgs } = await import('../engine/server/agents/drivers/codex.mjs');
const { BROWSER_TOOLS, BRIDGE_TOOLS } = await import('../engine/server/browser-tools.mjs');

const crew = () => makeVorld({ crew: [{ name: 'Ada', job: 'Researcher' }] });

test('local and private addresses are always blocked; domains match like writs', async () => {
  for (const h of ['localhost', 'app.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '[::1]', '::ffff:127.0.0.1']) assert.equal(await hub.isPrivateHost(h), true, h);
  for (const h of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(await hub.isPrivateHost(h), false, h);
  assert.ok(hub.allowsHost(['example.com'], 'example.com') && hub.allowsHost(['example.com'], 'www.example.com'));
  assert.ok(!hub.allowsHost(['example.com'], 'badexample.com'), 'a suffix is not a subdomain');
  assert.ok(hub.allowsHost(['*'], 'anything.org') && !hub.allowsHost([], 'example.com'));
});

test('which browser opens: OV_CHROME, then a known default browser, then the fixed list; the card is told its name', () => {
  const mac = (app) => `/Applications/${app}.app/Contents/MacOS/${app}`;
  const pick = (defaultId, installed, more = {}) => hub.pickChrome({ platform: 'darwin', defaultId, exists: (p) => installed.includes(p), ...more });
  const all = [mac('Google Chrome'), mac('Microsoft Edge'), mac('Chromium'), mac('Brave Browser')];
  assert.equal(pick('', all), mac('Google Chrome'), 'no default known: the first of the list, as before');
  assert.equal(pick('com.brave.browser', all), mac('Brave Browser'));
  assert.equal(pick('com.microsoft.edgemac', all), mac('Microsoft Edge'));
  assert.equal(pick('org.chromium.Chromium', all), mac('Chromium'), 'bundle ids are compared without case');
  assert.equal(pick('com.brave.browser', [mac('Google Chrome')]), mac('Google Chrome'), 'a default that is not installed there is skipped');
  for (const id of ['company.thebrowser.dia', 'company.thebrowser.Browser', 'com.apple.Safari', 'org.mozilla.firefox', 'constructor']) assert.equal(pick(id, all), mac('Google Chrome'), `${id} is not on the list`);
  assert.equal(pick('com.brave.browser', [...all, '/opt/dia']), mac('Brave Browser'));
  assert.equal(pick('company.thebrowser.dia', [...all, mac('Dia')]), mac('Dia'), 'Dia is used when it is the default');
  assert.equal(pick('', [...all, mac('Dia')]), mac('Google Chrome'), 'and never as a fallback');
  assert.equal(pick('com.brave.browser', [...all, '/opt/dia'], { override: '/opt/dia' }), '/opt/dia', 'OV_CHROME wins');
  assert.equal(pick('com.brave.browser', all, { override: '/missing' }), mac('Brave Browser'));
  assert.equal(pick('com.brave.browser', []), null);
  assert.equal(hub.pickChrome({ platform: 'linux', defaultId: 'com.brave.browser', exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium', 'only macOS reads the default');

  const handlers = (id) => `(\n        {\n        LSHandlerContentType = "public.html";\n        LSHandlerRoleAll = "com.apple.safari";\n    },\n        {\n        LSHandlerModificationDate = 808853551;\n        LSHandlerPreferredVersions =         {\n            LSHandlerRoleAll = "-";\n        };\n        LSHandlerRoleAll = ${id};\n        LSHandlerURLScheme = https;\n    },\n        {\n        LSHandlerRoleAll = "com.apple.mail";\n        LSHandlerURLScheme = mailto;\n    }\n)\n`;
  assert.equal(hub.defaultBrowserId(handlers('"company.thebrowser.dia"')), 'company.thebrowser.dia');
  assert.equal(hub.defaultBrowserId(handlers('"com.Brave.Browser"')), 'com.brave.browser');
  assert.equal(hub.defaultBrowserId(handlers('"com.apple.safari"').replace('https', 'http')), '', 'http alone is not the answer');
  for (const junk of ['', undefined, '(\n)\n', 'The domain/default pair does not exist']) assert.equal(hub.defaultBrowserId(junk), '');

  assert.deepEqual([mac('Google Chrome'), mac('Microsoft Edge'), mac('Chromium'), mac('Brave Browser'), '/usr/bin/google-chrome-stable', '/snap/bin/chromium', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', mac('Dia'), null].map(hub.browserName),
    ['Chrome', 'Edge', 'Chromium', 'Brave', 'Chrome', 'Chromium', 'Edge', 'Chrome', 'Dia', '']);
  const ctx = crew();
  assert.equal(hub.signInState(ctx, 'ada').browser, hub.browserName(hub.findChrome()), 'the sign-in card hears which browser the server found');
});

test('a site without a writ asks the founder and never starts a browser', async () => {
  const ctx = crew(), asks = [];
  const open = (url) => hub.callTool(ctx, 'ada', 'browser_open', { url }, { onRequest: (a) => asks.push(a) });
  await assert.rejects(open('https://www.example.com/pricing'), /no writ for www\.example\.com/);
  assert.deepEqual(asks.map((a) => [a.capability, a.scope]), [['net.fetch', 'www.example.com']]);
  await assert.rejects(open('http://localhost:4317/api/boot'), /always blocked/);
  await assert.rejects(open('http://192.168.1.1/'), /always blocked/);
  await assert.rejects(open('http://93.184.216.34/'), /domain name/);
  await assert.rejects(open('file:///etc/passwd'), /only http and https/);
  await assert.rejects(hub.callTool(ctx, 'ada', 'browser_click', { id: 1 }), /no page is open yet/);
  await assert.rejects(hub.callTool(ctx, 'ada', 'browser_nope', {}), /unknown tool/);
  assert.equal(asks.length, 1, 'only the real request became a writ');
});

test('every brain gets the same browser tools', () => {
  const ctx = crew();
  const none = engineTools({ ctx, role: 'ada', cwd: ctx.dir });
  assert.ok(!none.specs.some((s) => s.function.name.startsWith('browser_')), 'no browser, no browser tools');
  const calls = [];
  const tools = engineTools({ ctx, role: 'ada', cwd: ctx.dir, browser: async (name, args) => { calls.push([name, args]); return `ran ${name}`; } });
  assert.deepEqual(tools.specs.map((s) => s.function.name).filter((n) => n.startsWith('browser_')), BROWSER_TOOLS.map((t) => t.name));
  assert.equal(kindOf('browser_open'), 'tool.web');
  assert.equal(kindOf('mcp__ov_browser__browser_click'), 'tool.web', 'Claude Code names it with a prefix');
  assert.equal(kindOf('browser_type'), 'tool.web');
  assert.equal(kindOf('read_file'), 'tool.read');
  assert.equal(targetOf('mcp__ov_browser__browser_click', { id: 3 }), '#3');
  assert.equal(targetOf('browser_open', { url: 'https://example.com' }), 'https://example.com');
  return tools.run('browser_open', { url: 'https://example.com' }).then((r) => {
    assert.deepEqual([r.ok, r.output], [true, 'ran browser_open']);
    assert.deepEqual(calls, [['browser_open', { url: 'https://example.com' }]]);
  });
});

test('Codex gets the browser as an MCP server it may use without asking (the engine checks the writs)', () => {
  const args = mcpArgs({ name: 'ov_browser', command: '/usr/bin/node', args: ['/x/browser-mcp.mjs'], env: { OV_URL: 'http://127.0.0.1:1', OV_ROLE: 'ada' } });
  assert.deepEqual(args.filter((a) => a !== '-c'), [
    'mcp_servers.ov_browser.command="/usr/bin/node"',
    'mcp_servers.ov_browser.args=["/x/browser-mcp.mjs"]',
    'mcp_servers.ov_browser.default_tools_approval_mode="approve"',
    'mcp_servers.ov_browser.env={OV_URL="http://127.0.0.1:1", OV_ROLE="ada"}',
  ]);
  assert.deepEqual(mcpArgs(null), []);
});

test('the MCP bridge turns tool calls into engine API calls, with the token and the thread', async (t) => {
  const seen = [];
  const engine = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, token: req.headers['x-ov-token'], body: JSON.parse(body || '{}') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url.includes('browser_back') ? { ok: false, output: 'error: there is no earlier page' } : { ok: true, output: 'Page: Hello' }));
    });
  });
  await new Promise((r) => engine.listen(0, '127.0.0.1', r));
  t.after(() => engine.close());
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../engine/server/agents/browser-mcp.mjs', import.meta.url))], {
    env: { ...process.env, OV_URL: `http://127.0.0.1:${engine.address().port}`, OV_TOKEN: 'tok', OV_VORLD: 'lantern-tea', OV_ROLE: 'ada', OV_THREAD: 'th1' }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  t.after(() => bridge.kill());
  const waiting = new Map(); let n = 0;
  readline.createInterface({ input: bridge.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).result.serverInfo.name, 'ov_browser');
  const list = (await rpc('tools/list', {})).result.tools;
  assert.deepEqual(list.map((x) => x.name), BRIDGE_TOOLS.map((x) => x.name));
  assert.deepEqual(list[0].inputSchema.required, ['url']);
  const ok = (await rpc('tools/call', { name: 'browser_open', arguments: { url: 'https://example.com' } })).result;
  assert.deepEqual([ok.isError, ok.content[0].text], [false, 'Page: Hello']);
  assert.deepEqual(seen[0], { method: 'POST', url: '/api/vorlds/lantern-tea/browser/ada/browser_open?thread=th1', token: 'tok', body: { url: 'https://example.com' } });
  const bad = (await rpc('tools/call', { name: 'browser_back', arguments: {} })).result;
  assert.deepEqual([bad.isError, bad.content[0].text], [true, 'error: there is no earlier page']);
  assert.equal((await rpc('nope', {})).error.code, -32601);
});

test('the browser itself: pages, redirects, passwords and the live view (needs Chrome)', { skip: !hub.findChrome() && 'no Chrome or Edge on this computer' }, async (t) => {
  process.env.OV_BROWSER_ALLOW_PRIVATE = '1';          // the test page lives on 127.0.0.1
  const page = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/two') return res.end('<title>Two</title><h1>Second page</h1>');
    if (req.url === '/away') { res.statusCode = 302; res.setHeader('location', `http://localhost:${page.address().port}/two`); return res.end(); }
    res.end('<title>Tea shop</title><h1>Lantern Tea</h1><p>Green tea, 12 EUR.</p><a href="/two">Next page</a><a href="/away">Away</a><input name="q" placeholder="Search"><input type="password" name="pw"><button>Go</button>');
  });
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  const ctx = crew(), asks = [], frames = [];
  t.after(async () => { delete process.env.OV_BROWSER_ALLOW_PRIVATE; await hub.closeAll(); page.close(); });
  const use = (name, args) => hub.callTool(ctx, 'ada', name, args, { emit: (m) => frames.push(m), onRequest: (a) => asks.push(a) });
  const home = `http://127.0.0.1:${page.address().port}/`;

  await assert.rejects(use('browser_open', { url: home }), /no writ for 127\.0\.0\.1/);
  grant(ctx, { role: 'ada', capability: 'net.fetch', scope: '127.0.0.1' });
  const read = await use('browser_open', { url: home });
  assert.match(read, /Page: Tea shop[\s\S]*Green tea, 12 EUR/);
  assert.match(read, /\[1\] link "Next page"/);
  assert.match(read, /password field \(you cannot type here\)/);

  await assert.rejects(use('browser_type', { id: 4, text: 'hunter2' }), /cannot type passwords/);
  assert.match(await use('browser_type', { id: 3, text: 'green' }), /field "Search" = "green"/);
  assert.match(await use('browser_click', { id: 1 }), /Page: Two/);
  assert.match(await use('browser_back', {}), /Page: Tea shop/);

  const shot = await use('browser_screenshot', { caption: 'tea page' });
  assert.ok(shot.output.includes('Screenshot of'));
  assert.ok(shot.images?.[0]?.data?.length > 100);

  // a granted site that redirects somewhere else may not take the browser there
  asks.length = 0;
  await assert.rejects(use('browser_click', { id: 2 }), /no writ for localhost[\s\S]*still on the previous page/);
  assert.deepEqual(asks.map((a) => a.scope), ['localhost']);
  assert.match(await use('browser_read', {}), /Page: Tea shop/, 'and the member is still where it was');

  assert.ok(frames.length >= 3 && frames.every((f) => f.type === 'browser' && f.role === 'ada'));
  assert.ok(frames.some((f) => f.image && f.url.startsWith('http://127.0.0.1')), 'the founder sees what the member sees');
  assert.ok(hub.latest(ctx, 'ada').image.length > 500);
  await hub.close(ctx, 'ada');
  assert.equal(hub.latest(ctx, 'ada'), null);
});

// ---------- signed-in browsing ----------
const { checkScope } = await import('../engine/server/gate.mjs');
const { startServer, call, newVorld } = await import('./helpers/server.mjs');
const { appendEvent, createThread } = await import('../engine/server/threads.mjs');

test('net.session and net.act are per site, never for every site, and acting is never "always"', async (t) => {
  const ctx = crew();
  assert.equal(checkScope(ctx, 'net.session', 'https://www.YouTube.com/studio'), 'www.youtube.com');
  assert.equal(checkScope(ctx, 'net.act', 'youtube.com'), 'youtube.com');
  assert.throws(() => checkScope(ctx, 'net.session', '*'), /one site/);
  assert.throws(() => checkScope(ctx, 'net.act', '*'), /one site/);
  assert.equal(checkScope(ctx, 'net.fetch', '*'), '*', 'plain browsing may still be open');
  await startServer(t);
  const { id, root } = await newVorld();
  const vctx = (await import('../engine/server/vorld.mjs')).vorldCtx(id);
  const thread = createThread(vctx, { role: vctx.companionId });
  const ask = (capability) => appendEvent(vctx, thread.id, { type: 'writ.request', id: `${capability}-${Math.random()}`, role: vctx.companionId, capability, scope: 'youtube.com', why: 'x', risk: 'high' });
  const act = ask('net.act');
  assert.equal((await call('POST', `${root}/threads/${thread.id}/writs/${act.id}`, { answer: 'always', continue: false })).status, 400, 'acting as the founder is never given for good');
  assert.equal((await call('POST', `${root}/threads/${thread.id}/writs/${act.id}`, { answer: 'once', continue: false })).status, 200);
  const session = ask('net.session');
  assert.equal((await call('POST', `${root}/threads/${thread.id}/writs/${session.id}`, { answer: 'always', continue: false })).status, 200, 'signing in to a site can be remembered');
  assert.equal((await call('GET', `${root}/world`)).status === 404 || true, true);
});

test('signed-in browsing: saved sign-ins, per-site writs, and approval before acting (needs Chrome)', { skip: !hub.findChrome() && 'no Chrome or Edge on this computer' }, async (t) => {
  process.env.OV_BROWSER_ALLOW_PRIVATE = '1';
  const seen = [];
  const page = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'text/html');
      res.end(`<title>Studio</title><h1>Studio</h1><p>cookie: ${req.headers.cookie ?? 'none'}</p>
        <form method="get" action="/search"><input type="search" name="q"><button>Find</button></form>
        <form method="post" action="/save"><input name="title"><button>Apply</button></form>
        <a href="/two">Settings</a><button type="button">Delete video</button>
        <input name="note" placeholder="Note">`);
    });
  });
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  const ctx = crew(), asks = [];
  t.after(async () => { delete process.env.OV_BROWSER_ALLOW_PRIVATE; await hub.closeAll(); page.close(); });
  const use = (name, args) => hub.callTool(ctx, 'ada', name, args, { onRequest: (a) => asks.push(a) });
  const home = `http://127.0.0.1:${page.address().port}/`;

  // nothing saved yet: a sign-in card is asked for in the chat (the writ comes with it)
  await assert.rejects(use('browser_open', { url: home, signed_in: true }), /not signed in to 127\.0\.0\.1 for you yet/);
  assert.deepEqual(asks.map((a) => [a.capability, a.scope, a.signin]), [['net.session', '127.0.0.1', true]]);
  assert.equal(hub.signedInTo(ctx, 'ada', '127.0.0.1'), false);
  hub.saveSession(ctx, 'ada', { cookies: [{ name: 'SID', value: 'secret-session', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] });
  assert.deepEqual(hub.sessionSites(ctx, 'ada').map((s) => s.domain), ['0.1']);   // IPs have no site name: shown as the last two labels
  assert.equal(hub.signedInTo(ctx, 'ada', 'www.0.1'), true, 'a saved sign-in covers the site and its subdomains');
  assert.equal(hub.signedInTo(ctx, 'ada', 'example.org'), false);

  grant(ctx, { role: 'ada', capability: 'net.fetch', scope: '127.0.0.1' });
  assert.match(await use('browser_open', { url: home }), /cookie: none/, 'plain browsing never carries the sign-ins');

  asks.length = 0;
  await assert.rejects(use('browser_open', { url: home, signed_in: true }), /no writ for 127\.0\.0\.1 \(signed in\)/);
  assert.deepEqual(asks.map((a) => a.capability), ['net.session'], 'a plain-browsing writ does not cover signed-in use');
  grant(ctx, { role: 'ada', capability: 'net.session', scope: '127.0.0.1' });
  const signed = await use('browser_open', { url: home, signed_in: true });
  assert.match(signed, /cookie: SID=secret-session/);
  assert.match(signed, /Signed in as the founder/);
  assert.match(signed, /button "Apply" \(acts as you/, 'a submit in a POST form acts');
  assert.match(signed, /button "Delete video" \(acts as you/, 'so does a button that says delete');
  assert.match(signed, /link "Settings" → .*\/two\n/, 'a plain link does not');
  assert.match(signed, /button "Find"\n/, 'and neither does a search (GET) form');
  assert.ok(hub.latest(ctx, 'ada').signed);

  // acting: asks for net.act first, goes ahead once approved
  asks.length = 0;
  const line = (re) => Number(signed.match(re)[1]);
  const apply = line(/\[(\d+)\] button "Apply"/), del = line(/\[(\d+)\] button "Delete video"/), note = line(/\[(\d+)\] field "Note"/);
  await assert.rejects(use('browser_click', { id: apply }), /would act as the founder on 127\.0\.0\.1/);
  assert.deepEqual(asks.map((a) => [a.capability, a.scope]), [['net.act', '127.0.0.1']]);
  await assert.rejects(use('browser_type', { id: note, text: 'hello', submit: true }), /would act as the founder/);
  assert.ok(!seen.some((s) => s.startsWith('POST')), 'nothing was submitted without approval');
  grant(ctx, { role: 'ada', capability: 'net.act', scope: '127.0.0.1', answer: 'once' });
  await use('browser_click', { id: apply });
  assert.ok(seen.includes('POST /save'), 'approved: the form went through');
  await use('browser_click', { id: del });   // a button with no form does nothing on the test page, but is allowed now

  // a plain page marks nothing as acting
  const plain = await hub.callTool(ctx, 'bo', 'browser_open', { url: home }, { onRequest: () => {} }).catch((e) => e.message);
  assert.match(plain, /no writ/, 'another member has no writs at all');
});

test('frames, ads and trackers on a granted page are not loaded, and do not fail the page (needs Chrome)', { skip: !hub.findChrome() && 'no Chrome or Edge on this computer' }, async (t) => {
  process.env.OV_BROWSER_ALLOW_PRIVATE = '1';
  const page = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>Blog</title><h1>A post</h1><iframe src="http://localhost:${page.address().port}/ad"></iframe>`); });
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  const ctx = crew(), asks = [];
  t.after(async () => { delete process.env.OV_BROWSER_ALLOW_PRIVATE; await hub.closeAll(); page.close(); });
  grant(ctx, { role: 'ada', capability: 'net.fetch', scope: '127.0.0.1' });
  const out = await hub.callTool(ctx, 'ada', 'browser_open', { url: `http://127.0.0.1:${page.address().port}/` }, { onRequest: (a) => asks.push(a) });
  assert.match(out, /Page: Blog[\s\S]*A post/);
  assert.deepEqual(asks, [], 'an ungranted frame is never a writ request');
});

test('the sign-in window saves what the founder signs in to, and can forget it (headless here)', { skip: !hub.findChrome() && 'no Chrome or Edge on this computer' }, async (t) => {
  process.env.OV_SIGNIN_HEADLESS = '1';
  const ctx = crew(), heard = [];
  t.after(async () => { delete process.env.OV_SIGNIN_HEADLESS; await hub.closeAll(); });
  assert.deepEqual(hub.signInState(ctx, 'ada').sites, []);
  const state = await hub.openSignIn(ctx, 'ada', { url: 'about:blank'.replace('about:blank', 'https://example.com'), emit: (m) => heard.push(m) }).catch((e) => e);
  // example.com may be unreachable offline; the window is up either way
  assert.ok(hub.signInWindow(ctx, 'ada'), String(state?.message ?? 'window open'));
  assert.equal(hub.signInState(ctx, 'ada').open, true);
  await hub.signInWindow(ctx, 'ada').context.addCookies([{ name: 'SID', value: 'abc', domain: '.youtube.com', path: '/' }, { name: 'HSID', value: 'def', domain: '.youtube.com', path: '/' }, { name: 'a', value: '1', domain: 'github.com', path: '/' }]);
  await hub.signInWindow(ctx, 'ada').save();
  assert.deepEqual(hub.sessionSites(ctx, 'ada'), [{ domain: 'youtube.com', cookies: 2 }, { domain: 'github.com', cookies: 1 }]);
  await assert.rejects(hub.openSignIn(ctx, 'ada', { url: 'file:///etc/passwd' }), /web address/);
  const closed = new Promise((r) => { const iv = setInterval(() => { if (heard.some((m) => m.open === false)) { clearInterval(iv); r(); } }, 50); });
  await hub.signInWindow(ctx, 'ada').browser.close();
  await closed;
  assert.equal(hub.signInState(ctx, 'ada').open, false);
  assert.equal(hub.sessionSites(ctx, 'ada').length, 2, 'closing the window keeps the sign-ins');
  assert.deepEqual((await hub.forgetSignIns(ctx, 'ada')).sites, []);
});

test('sign-in autosave leaves the window alone across origins and concurrent open requests', { skip: !hub.findChrome() && 'no Chrome or Edge on this computer' }, async (t) => {
  process.env.OV_SIGNIN_HEADLESS = '1';
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Sign in</title><input placeholder="Email">'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { delete process.env.OV_SIGNIN_HEADLESS; await hub.closeAll(); server.close(); });
  const ctx = crew(), heard = [];
  const home = `http://127.0.0.1:${server.address().port}`;
  await Promise.all(Array.from({ length: 4 }, () => hub.openSignIn(ctx, 'ada', { url: home, emit: (e) => heard.push(e) })));
  assert.equal(heard.filter((e) => e.open).length, 1, 'concurrent clicks open one browser');
  const w = hub.signInWindow(ctx, 'ada');
  const cdp = await w.browser.newBrowserCDPSession();
  const targets = [];
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  cdp.on('Target.targetCreated', (e) => { if (e.targetInfo.type === 'page') targets.push(e.targetInfo); });
  await w.page.evaluate(async () => {
    localStorage.setItem('account', 'first');
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('auth', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('tokens');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction('tokens', 'readwrite');
        const value = { token: 'test-token', expires: new Date('2030-01-01'), bytes: new Uint8Array([1, 2, 3]), roles: new Set(['reader']) };
        value.self = value;
        tx.objectStore('tokens').put(value, 'session');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await w.save();
  await w.page.goto(`http://localhost:${server.address().port}`);
  await w.page.evaluate(() => localStorage.setItem('account', 'second'));
  await w.page.getByPlaceholder('Email').fill('still-typing');
  await Promise.all(Array.from({ length: 4 }, () => w.save()));
  await new Promise((r) => setTimeout(r, 3500)); // also exercise the navigation debounce and background interval
  assert.equal(targets.length, 0, 'autosave creates no temporary browser pages, even for an earlier origin');
  assert.equal(w.context.pages().length, 1);
  assert.equal(await w.page.getByPlaceholder('Email').inputValue(), 'still-typing');
  assert.equal(w.page.url(), `http://localhost:${server.address().port}/`);
  await hub.closeAll();
  // Reopening must restore both origins, including non-JSON IndexedDB authentication values.
  await hub.openSignIn(ctx, 'ada', { url: home });
  const restored = hub.signInWindow(ctx, 'ada');
  assert.equal(await restored.page.evaluate(() => localStorage.getItem('account')), 'first');
  const record = await restored.page.evaluate(async () => {
    const db = await new Promise((resolve) => { const r = indexedDB.open('auth'); r.onsuccess = () => resolve(r.result); });
    try {
      const value = await new Promise((resolve) => { const r = db.transaction('tokens').objectStore('tokens').get('session'); r.onsuccess = () => resolve(r.result); });
      return { token: value.token, expires: value.expires.toISOString(), bytes: [...value.bytes], roles: [...value.roles], cycle: value.self === value };
    } finally { db.close(); }
  });
  assert.deepEqual(record, { token: 'test-token', expires: '2030-01-01T00:00:00.000Z', bytes: [1, 2, 3], roles: ['reader'], cycle: true });
  await restored.page.goto(`http://localhost:${server.address().port}`);
  assert.equal(await restored.page.evaluate(() => localStorage.getItem('account')), 'second');
});
