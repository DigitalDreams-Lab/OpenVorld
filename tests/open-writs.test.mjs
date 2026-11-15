import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, call, newVorld } from './helpers/server.mjs';
import { createThread, appendEvent } from '../engine/server/threads.mjs';

test('open writs: every request still waiting for the founder, across threads, gone once answered', async (t) => {
  await startServer(t);
  const { id, root } = await newVorld();
  const ctx = (await import('../engine/server/vorld.mjs')).vorldCtx(id);
  assert.deepEqual((await call('GET', `${root}/writs/open`)).data, []);
  const a = createThread(ctx, { role: ctx.companionId }), b = createThread(ctx, { role: ctx.companionId });
  const ask = (thread, scope) => appendEvent(ctx, thread.id, { type: 'writ.request', id: `w-${scope}`, role: ctx.companionId, capability: 'net.fetch', scope, why: 'to look it up', risk: 'low' });
  ask(a, 'example.com'); ask(b, 'example.org');
  const open = (await call('GET', `${root}/writs/open`)).data;
  assert.deepEqual(open.map((w) => [w.id, w.thread, w.role, w.scope, w.why]).sort(), [['w-example.com', a.id, ctx.companionId, 'example.com', 'to look it up'], ['w-example.org', b.id, ctx.companionId, 'example.org', 'to look it up']]);
  assert.equal((await call('POST', `${root}/threads/${a.id}/writs/w-example.com`, { answer: 'once', continue: false })).status, 200);
  assert.deepEqual((await call('GET', `${root}/writs/open`)).data.map((w) => w.id), ['w-example.org']);
});
