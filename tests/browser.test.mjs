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
const { BROWSER_TOOLS } = await import('../engine/server/browser-tools.mjs');

const crew = () => makeVorld({ crew: [{ name: 'Ada', job: 'Researcher' }] });

test('local and private addresses are always blocked; domains match like writs', async () => {
  for (const h of ['localhost', 'app.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '[::1]', '::ffff:127.0.0.1']) assert.equal(await hub.isPrivateHost(h), true, h);
  for (const h of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(await hub.isPrivateHost(h), false, h);
  assert.ok(hub.allowsHost(['example.com'], 'example.com') && hub.allowsHost(['example.com'], 'www.example.com'));
  assert.ok(!hub.allowsHost(['example.com'], 'badexample.com'), 'a suffix is not a subdomain');
  assert.ok(hub.allowsHost(['*'], 'anything.org') && !hub.allowsHost([], 'example.com'));
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
  assert.deepEqual(list.map((x) => x.name), BROWSER_TOOLS.map((x) => x.name));
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
