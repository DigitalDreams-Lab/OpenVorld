// Quests: workflows the crew runs step by step. Results hand off, the Seal waits for the founder, a writ request
// pauses the quest, and the companion can draft one from a chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVorld, saveVorld } from './helpers/vorld.mjs';
import { startServer, call, newVorld } from './helpers/server.mjs';

const Q = await import('../engine/server/quests.mjs');
const { readEvents, listThreads } = await import('../engine/server/threads.mjs');
const { gameFor } = await import('../engine/server/game.mjs');

const CREW = [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }];
const sse = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timed out'); };
/** A vorld whose crew thinks with a mocked OpenAI-compatible model. */
function apiVorld() {
  const ctx = makeVorld({ crew: CREW, brain: { provider: 'openai-compatible', model: 'm', name: 'local' } });
  return saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', name: 'local', base_url: 'http://local.test/v1' }]; });
}

test('a quest is validated: a title, at least one step, every step for someone on the crew', () => {
  const ctx = makeVorld({ crew: CREW });
  assert.throws(() => Q.saveQuest(ctx, { title: '', steps: [{ agent: 'ada', task: 'x' }] }), /title/);
  assert.throws(() => Q.saveQuest(ctx, { title: 'T', steps: [] }), /at least one step/);
  assert.throws(() => Q.saveQuest(ctx, { title: 'T', steps: [{ agent: 'nobody', task: 'x' }] }), /nobody called/);
  const q = Q.saveQuest(ctx, { title: 'Post', goal: 'A post', steps: [{ agent: 'Ada', task: 'Write it' }, { agent: 'editor', task: 'Edit it', seal: true }] });
  assert.deepEqual(q.steps.map((s) => [s.agent, s.seal]), [['ada', false], ['bo', true]], 'members by name or job title');
  assert.equal(q.status, 'draft');
  assert.ok(gameFor(ctx).s.events['quest.created']);
});

test('steps run in order, each result is handed to the next, and the seal waits for the founder', async (t) => {
  const ctx = apiVorld();
  const prompts = [];
  t.mock.method(globalThis, 'fetch', async (_u, init) => {
    const body = JSON.parse(init.body), last = body.messages.at(-1).content;
    prompts.push(last);
    if (last.includes('sent your result back')) return sse('Draft v2 about green tea.');
    return sse(prompts.length === 1 ? 'Draft about tea.' : 'Edited: tea is great.');
  });
  const sent = [];
  const q = Q.saveQuest(ctx, { title: 'Post', goal: 'One post', steps: [{ agent: 'ada', task: 'Write a draft' }, { agent: 'bo', task: 'Edit the draft', seal: true }] });
  Q.startQuest(ctx, q.id, (e) => sent.push(e));
  const waiting = await until(() => { const x = Q.getQuest(ctx, q.id); return x.status === 'waiting' && x; });
  assert.equal(waiting.run.waiting, 'seal');
  assert.equal(waiting.run.step, 1);
  assert.match(prompts[1], /Step 1: Ada \(Writer\)[\s\S]*Draft about tea\./, 'the editor sees the writer\'s result');
  assert.match(prompts[1], /Goal of the whole quest: One post/);
  assert.ok(sent.some((e) => e.type === 'command' && e.role === 'ada' && e.commands.some((c) => c.do === 'walk_to')), 'the member walks to the quest board');

  // sent back with a note: the same member redoes the step in the same thread, then it waits again
  await Q.seal(ctx, q.id, { approve: false, note: 'Make it about green tea' }, () => {});
  const again = await until(() => { const x = Q.getQuest(ctx, q.id); return x.status === 'waiting' && x.run.outputs[1]?.includes('v2') && x; });
  assert.equal(again.run.threads.length, 2);
  assert.ok(readEvents(ctx, again.run.threads[1]).some((e) => e.type === 'founder.message' && /green tea/.test(e.text)));

  const done = await Q.seal(ctx, q.id, { approve: true }, (e) => sent.push(e));
  assert.equal(done.status, 'done');
  assert.ok(readEvents(ctx, done.run.threads[1]).some((e) => e.type === 'sealed'));
  const game = gameFor(ctx);
  assert.equal(game.s.events['quest.done'], 1); assert.equal(game.s.events['step.done'], 2);
  assert.ok(game.s.deeds.first_run && game.s.deeds.first_seal && game.s.deeds.sent_back);
  assert.equal(listThreads(ctx, null, 'quest').length, 2, 'one thread per step');
  await assert.rejects(Q.seal(ctx, q.id, { approve: true }, () => {}), /not waiting/);
});

test('a step that asks for access pauses the quest until the writ is answered', async (t) => {
  const ctx = apiVorld();
  t.mock.method(globalThis, 'fetch', async () => sse('I need the notes.\n```ov\n{"access":[{"capability":"net.fetch","scope":"example.com","why":"read the brief"}]}\n```'));
  const q = Q.saveQuest(ctx, { title: 'Research', steps: [{ agent: 'ada', task: 'Read the brief' }] });
  Q.startQuest(ctx, q.id, () => {});
  const w = await until(() => { const x = Q.getQuest(ctx, q.id); return x.status === 'waiting' && x; });
  assert.equal(w.run.waiting, 'writ');
  assert.ok(readEvents(ctx, w.run.threads[0]).some((e) => e.type === 'writ.request' && e.capability === 'net.fetch'));
  const stopped = Q.stopQuest(ctx, q.id, () => {});
  assert.equal(stopped.status, 'stopped');
});

test('a failed step stops the quest with its reason, and can be retried', async (t) => {
  const ctx = apiVorld();
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => (++n === 1 ? new Response('down', { status: 500 }) : sse('Fine now.')));
  const q = Q.saveQuest(ctx, { title: 'Flaky', steps: [{ agent: 'ada', task: 'Try' }] });
  Q.startQuest(ctx, q.id, () => {});
  const failed = await until(() => { const x = Q.getQuest(ctx, q.id); return x.status === 'failed' && x; });
  assert.ok(failed.run.error);
  Q.retry(ctx, q.id, () => {});
  const done = await until(() => { const x = Q.getQuest(ctx, q.id); return x.status === 'done' && x; });
  assert.equal(done.run.outputs[0], 'Fine now.');
});

test('the companion drafts a quest from a chat, and only the companion can', async (t) => {
  await startServer(t);
  const { id, root } = await newVorld({ crew: CREW, brain: { provider: 'openai-compatible', model: 'm', name: 'local' } });
  const { vorldCtx } = await import('../engine/server/vorld.mjs');
  saveVorld(vorldCtx(id), (d) => { d.providers = [{ id: 'openai-compatible', name: 'local', base_url: 'http://local.test/v1' }]; });
  const draft = { title: 'Weekly post', goal: 'A post a week', steps: [{ agent: 'Ada', task: 'Write' }, { agent: 'Bo', task: 'Edit', seal: true }, { agent: 'Ghost', task: 'Haunt' }] };
  t.mock.method(globalThis, 'fetch', async () => sse(`Here is a plan.\n\`\`\`ov\n${JSON.stringify({ quest: draft })}\n\`\`\``));
  const vorld = (await call('GET', `${root}/vorld`)).data;
  const companion = vorld.crew.find((c) => c.role === 'companion').id;
  for (const role of [companion, 'ada']) {
    const thread = (await call('POST', `${root}/threads`, { role })).data;
    assert.equal((await call('POST', `${root}/threads/${thread.id}/messages`, { text: 'make me a weekly post workflow' })).status, 200);
    await until(() => readEvents(vorldCtx(id), thread.id).some((e) => e.type === 'agent.text'));
    await new Promise((r) => setTimeout(r, 30));
  }
  const quests = (await call('GET', `${root}/quests`)).data;
  assert.equal(quests.length, 1, 'an agent\'s reply never creates a quest');
  assert.deepEqual(quests[0].steps.map((s) => s.agent), ['ada', 'bo'], 'unknown members are dropped');
  assert.equal(quests[0].status, 'draft');
});

test('templates start a vorld with its crew and starter quests', async (t) => {
  await startServer(t);
  const { root } = await newVorld({ template: 'content' });
  const vorld = (await call('GET', `${root}/vorld`)).data;
  assert.deepEqual(vorld.crew.map((c) => c.job), ['Guide', 'Researcher', 'Writer', 'Editor']);
  const quests = (await call('GET', `${root}/quests`)).data;
  assert.equal(quests.length, 1);
  assert.deepEqual(quests[0].steps.map((s) => vorld.crew.find((c) => c.id === s.agent).job), ['Researcher', 'Writer', 'Editor']);
});

test('a member on a running quest cannot be removed until it stops', async (t) => {
  await startServer(t);
  const { root } = await newVorld({ template: 'content' });
  const vorld = (await call('GET', `${root}/vorld`)).data;
  const [quest] = (await call('GET', `${root}/quests`)).data;
  const started = await call('POST', `${root}/quests/${quest.id}/start`);
  assert.equal(started.status, 200);
  const writer = vorld.crew.find((c) => c.job === 'Writer');
  assert.equal((await call('DELETE', `${root}/crew/${writer.id}`)).status, 409);
  assert.equal((await call('POST', `${root}/quests/${quest.id}/stop`)).status, 200);
  assert.equal((await call('DELETE', `${root}/crew/${writer.id}`)).status, 200);
});
