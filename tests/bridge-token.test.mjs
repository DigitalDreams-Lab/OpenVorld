// The tool bridge's token: a brain can often read what it is given (a config file, its command line, its environment), so the
// bridge never gets the launch token. It gets one for one member's one turn that opens only that member's own tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVorld, saveVorld } from './helpers/vorld.mjs';

const B = await import('../engine/server/bridge-token.mjs');
const { browserFor } = await import('../engine/server/agents/browse.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');
const { createThread } = await import('../engine/server/threads.mjs');

const LAUNCH = 'launch-token';
const at = (path, q = '?thread=t1') => new URL(`http://127.0.0.1:4317${path}${q}`);
const own = '/api/vorlds/lantern/browser/ada';

test('the launch token opens everything; a bridge token opens only its own member\'s tools in its own thread', () => {
  const token = B.mintBridgeToken('lantern', 'ada', 't1');
  const ok = (t, method, url) => B.apiAuthorized(t, LAUNCH, method, url);
  assert.ok(ok(LAUNCH, 'GET', at('/api/boot', '')) && ok(LAUNCH, 'POST', at('/api/vorlds/lantern/threads/t1/writs/w1', '')));
  for (const tool of ['browser_open', 'browser_read', 'browser_click', 'browser_type', 'browser_back', 'browser_screenshot', 'secret_ask', 'recall']) assert.ok(ok(token, 'POST', at(`${own}/${tool}`)), tool);

  const denied = [
    ['another member', 'POST', at('/api/vorlds/lantern/browser/bo/browser_open')],
    ['another vorld', 'POST', at('/api/vorlds/other/browser/ada/browser_open')],
    ['another thread', 'POST', at(`${own}/browser_open`, '?thread=t2')],
    ['no thread', 'POST', at(`${own}/browser_open`, '')],
    ['an unknown tool', 'POST', at(`${own}/delete_everything`)],
    ['a read of the frame', 'GET', at(own, '')],
    ['closing the browser', 'DELETE', at(own, '')],
    ['answering a writ', 'POST', at('/api/vorlds/lantern/threads/t1/writs/w1')],
    ['sending a message', 'POST', at('/api/vorlds/lantern/threads/t1/messages')],
    ['changing the crew', 'PUT', at('/api/vorlds/lantern/crew/ada')],
    ['a path that only looks like it', 'POST', at(`/api/vorlds/lantern/browser/ada/browser_open/../../threads`)],
    ['the boot call', 'GET', at('/api/boot', '')],
  ];
  for (const [what, method, url] of denied) assert.equal(ok(token, method, url), false, what);
  assert.equal(ok(undefined, 'POST', at(`${own}/browser_open`)), false, 'no token');
  assert.equal(ok('guess', 'POST', at(`${own}/browser_open`)), false, 'a guess');
  assert.equal(B.apiAuthorized('', '', 'GET', at('/api/boot', '')), false, 'an empty token never matches an empty launch token');
  B.revokeBridgeToken(token);
  assert.equal(ok(token, 'POST', at(`${own}/browser_open`)), false, 'a token ends when it is revoked');
});

test('browserFor hands the bridge its own token, never the launch token, and releases it', () => {
  const ctx = makeVorld({ name: 'Lantern', crew: [{ name: 'Ada', job: 'Writer' }] });
  const ada = ctx.crew.find((c) => c.role === 'agent').id;
  process.env.OV_TOKEN = 'the-launch-token';
  const before = B.liveBridgeTokens();
  const web = browserFor(ctx, ada, 'th1', { emit: () => {}, onRequest: () => {} });
  const token = web.mcp.env.OV_TOKEN;
  assert.notEqual(token, 'the-launch-token');
  assert.ok(!JSON.stringify(web).includes('the-launch-token'), 'the launch token is nowhere in what a brain is given');
  const url = at(`/api/vorlds/${ctx.id}/browser/${ada}/recall`, '?thread=th1');
  assert.equal(B.apiAuthorized(token, 'the-launch-token', 'POST', url), true);
  assert.equal(B.liveBridgeTokens(), before + 1);
  web.release();
  assert.equal(B.apiAuthorized(token, 'the-launch-token', 'POST', url), false, 'released with the turn');
  assert.equal(B.liveBridgeTokens(), before);
});

test('a turn releases its bridge token when it ends, even when it fails', async (t) => {
  let ctx = makeVorld({ name: 'Lantern Two', brain: { provider: 'openai-compatible', model: 'm' }, crew: [{ name: 'Ada', job: 'Writer' }] });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const ada = ctx.crew.find((c) => c.role === 'agent').id;
  const before = B.liveBridgeTokens();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network is down'); });
  const r = await runTurn(ctx, createThread(ctx, { role: ada }).id, 'hello', () => {});
  assert.equal(r.ok, false);
  assert.equal(B.liveBridgeTokens(), before, 'no token is left behind');
});
