// Messages written while a member works: Enter-style sends interrupt (the turn stops, what was written stays, the message runs
// next); queued ones wait and run one after another; each can be edited, deleted or sent now (mocked model API, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer, call, newVorld } from './helpers/server.mjs';
import { saveVorld, vorldCtx } from './helpers/vorld.mjs';

const { readEvents, getThread } = await import('../engine/server/threads.mjs');
const P = await import('../engine/server/parties.mjs');
const enc = new TextEncoder();
const chunk = (text) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);

/** A model that starts a reply for every request, hangs on the first `hang` of them until `release()` or until the turn is stopped, and finishes the rest at once. */
function slowModel(t, { hang = 1 } = {}) {
  const asked = []; let calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  t.mock.method(globalThis, 'fetch', async (_url, { body, signal }) => {
    const messages = JSON.parse(body).messages, text = String(messages.at(-1).content);
    const n = ++calls, hangs = n <= hang;
    asked.push(text);
    return new Response(new ReadableStream({
      async start(c) {
        c.enqueue(chunk(hangs ? 'Working on it. ' : `Done: ${text.slice(0, 20)}`));
        if (hangs) await Promise.race([gate, new Promise((_, no) => signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))]).catch((e) => { c.error(e); throw e; });
        c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
      },
    }).pipeThrough(new TransformStream()), { status: 200 });
  });
  return { asked, release };
}
async function setup(t, input = {}) {
  await startServer(t);
  const { id, root } = await newVorld({ brain: { provider: 'openai-compatible', model: 'queue-test' }, crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }], ...input });
  let ctx = vorldCtx(id, { fresh: true });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const ada = ctx.crew.find((c) => c.name === 'Ada').id;
  const chat = (await call('POST', `${root}/threads`, { role: ada })).data;
  return { id, root, ctx: vorldCtx(id), ada, tid: chat.id, url: `${root}/threads/${chat.id}` };
}
const until = async (check, what = 'condition') => { for (let i = 0; i < 400; i++) { if (await check()) return; await delay(10); } assert.fail(`timed out waiting for ${what}`); };
const idle = (s) => until(async () => (await call('GET', s.url)).data.thread.state !== 'working' && !(await call('GET', s.url)).data.thread.queued?.length, 'the chat to be idle');
const working = (s) => until(() => readEvents(s.ctx, s.tid).length > 0 && s.ctx && (call('GET', s.url).then((r) => r.data.thread.state === 'working')), 'the member to be working');
const thread = async (s) => (await call('GET', s.url)).data.thread;
const say = (s, text, mode) => call('POST', `${s.url}/messages`, { text, ...(mode ? { mode } : {}) });
const story = (s) => readEvents(s.ctx, s.tid).filter((e) => ['founder.message', 'agent.text', 'turn.error'].includes(e.type)).map((e) => (e.type === 'founder.message' ? `founder: ${e.text}` : e.type === 'turn.error' ? `${e.stopped ? 'stopped' : 'error'}` : `${e.partial ? 'partial' : 'agent'}: ${e.text.slice(0, 30)}`));

test('a message sent while the member works stops the turn, keeps what was written and runs next', async (t) => {
  const model = slowModel(t), s = await setup(t);
  assert.equal((await say(s, 'first job')).status, 200);
  await working(s); await delay(30);
  const r = await say(s, 'change of plan');
  assert.equal(r.status, 200); assert.equal(r.data.queued, true, 'the message waits for the stopped turn to end, then runs');
  await idle(s);
  assert.deepEqual(story(s), ['founder: first job', 'partial: Working on it.', 'stopped', 'founder: change of plan', 'agent: Done: change of plan']);
  assert.equal(model.asked.length, 2);
  const stopped = readEvents(s.ctx, s.tid).find((e) => e.type === 'turn.error');
  assert.equal(stopped.stopped, true, 'a stopped turn is marked, so the chat shows it as a quiet note and not as a failure');
  assert.equal((await thread(s)).queued, undefined);
});

test('queued messages wait, show on the chat, and run one after another in order', async (t) => {
  const model = slowModel(t), s = await setup(t);
  await say(s, 'long job'); await working(s);
  assert.equal((await say(s, 'then this', 'queue')).data.queued, true);
  await say(s, 'and then that', 'queue');
  const waiting = (await thread(s)).queued;
  assert.deepEqual(waiting.map((m) => m.text), ['then this', 'and then that']);
  assert.equal(readEvents(s.ctx, s.tid).filter((e) => e.type === 'founder.message').length, 1, 'queued messages are not in the chat yet');
  assert.equal(model.asked.length, 1, 'and they do not interrupt');
  model.release();
  await idle(s);
  assert.deepEqual(story(s), ['founder: long job', 'agent: Working on it.', 'founder: then this', 'agent: Done: then this', 'founder: and then that', 'agent: Done: and then that']);
  assert.deepEqual(model.asked.slice(1), ['then this', 'and then that']);
});

test('a queued message can be edited, deleted or sent now, ahead of the rest', async (t) => {
  const model = slowModel(t), s = await setup(t);
  await say(s, 'long job'); await working(s);
  for (const text of ['one', 'two', 'three', 'four']) await say(s, text, 'queue');
  let [one, two, three, four] = (await thread(s)).queued;
  assert.equal((await call('PUT', `${s.url}/queue/${two.id}`, { text: 'two, edited' })).status, 200);
  assert.equal((await call('PUT', `${s.url}/queue/${two.id}`, { text: '  ' })).status, 400);
  assert.equal((await call('DELETE', `${s.url}/queue/${one.id}`)).status, 200);
  assert.equal((await call('DELETE', `${s.url}/queue/${one.id}`)).status, 404, 'it is gone');
  assert.deepEqual((await thread(s)).queued.map((m) => m.text), ['two, edited', 'three', 'four']);
  assert.equal((await call('POST', `${s.url}/queue/${four.id}/send`, {})).status, 200);   // send now: stops the long job, runs "four" next
  await idle(s);
  assert.deepEqual(story(s), ['founder: long job', 'partial: Working on it.', 'stopped', 'founder: four', 'agent: Done: four', 'founder: two, edited', 'agent: Done: two, edited', 'founder: three', 'agent: Done: three']);
});

test('messages that interrupt keep the order they were sent in, ahead of the queue', async (t) => {
  const model = slowModel(t, { hang: 2 }), s = await setup(t);
  await say(s, 'long job'); await working(s);
  await say(s, 'later', 'queue');
  await say(s, 'now 1'); await until(async () => model.asked.length === 2, 'now 1 to start'); await say(s, 'now 2');
  await idle(s);
  assert.deepEqual(model.asked, ['long job', 'now 1', 'now 2', 'later']);
});

test('Stop pauses the queue until the founder resumes it; writing again resumes it too', async (t) => {
  const model = slowModel(t, { hang: 1 }), s = await setup(t);
  await say(s, 'long job'); await working(s);
  await say(s, 'after', 'queue');
  await call('POST', `${s.url}/stop`, {});
  await until(async () => (await thread(s)).state !== 'working', 'the stop');
  await delay(50);
  let th = await thread(s);
  assert.equal(th.queue_paused, true); assert.deepEqual(th.queued.map((m) => m.text), ['after']);
  assert.equal(model.asked.length, 1, 'what the founder stopped is not followed by the queue');
  await call('POST', `${s.url}/queue/resume`, {});
  await idle(s);
  assert.deepEqual(model.asked, ['long job', 'after']);

  const m2 = slowModel(t, { hang: 1 }), s2 = await setup(t);
  await say(s2, 'long job'); await working(s2);
  await say(s2, 'waits', 'queue'); await call('POST', `${s2.url}/stop`, {});
  await until(async () => (await thread(s2)).state !== 'working', 'the stop');
  await say(s2, 'a new message');
  await idle(s2);
  assert.deepEqual(m2.asked, ['long job', 'a new message', 'waits'], 'writing again carries the waiting queue on after this message');
});

test('when the member is idle a message just runs, and Ctrl+Enter style queueing starts at once', async (t) => {
  const model = slowModel(t, { hang: 0 }), s = await setup(t);
  assert.equal((await say(s, 'plain')).data.queued, undefined);
  await idle(s);
  assert.equal((await say(s, 'queued but idle', 'queue')).status, 200);
  await idle(s);
  assert.deepEqual(model.asked, ['plain', 'queued but idle']);
  assert.equal((await say(s, '   ')).status, 400);
  assert.equal((await call('POST', `${s.url}/queue/nope/send`, {})).status, 404);
});

test('an interrupt goes after earlier interrupts and before the plain queue', async () => {
  const { afterInterrupts } = await import('../engine/server/threads.mjs');
  assert.equal(afterInterrupts([]), 0);
  assert.equal(afterInterrupts([{ id: 'a' }, { id: 'b' }]), 0);
  assert.equal(afterInterrupts([{ id: 'n1', now: true }, { id: 'n2', now: true }, { id: 'a' }]), 2);
});

test('a chat holds at most 20 waiting messages', async (t) => {
  slowModel(t); const s = await setup(t);
  await say(s, 'long job'); await working(s);
  for (let i = 0; i < 20; i++) assert.equal((await say(s, `m${i}`, 'queue')).status, 200);
  assert.equal((await say(s, 'one too many', 'queue')).status, 409);
  await call('POST', `${s.url}/stop`, {});
});

test('in a party room, a queued message runs when the room goes quiet and an interrupting one stops the turn', async (t) => {
  const model = slowModel(t), s = await setup(t);
  const members = s.ctx.crew.filter((c) => c.role === 'agent').map((c) => c.id);
  const party = P.saveParty(s.ctx, { name: 'Duo', goal: 'Write', members });
  const room = (await call('POST', `${s.root}/parties/${party.id}/chats`, {})).data, url = `${s.root}/threads/${room.id}`;
  const rs = { ...s, tid: room.id, url };
  await say(rs, 'draft it'); await until(async () => (await thread(rs)).state === 'working', 'the room to work');
  await say(rs, 'queued note', 'queue');
  assert.equal((await thread(rs)).queued.length, 1);
  model.release();
  await idle(rs);
  assert.equal(readEvents(s.ctx, room.id).filter((e) => e.type === 'founder.message').map((e) => e.text).join('|'), 'draft it|queued note');

  const m2 = slowModel(t), r2 = (await call('POST', `${s.root}/parties/${party.id}/chats`, {})).data, rs2 = { ...s, tid: r2.id, url: `${s.root}/threads/${r2.id}` };
  await say(rs2, 'first'); await until(async () => (await thread(rs2)).state === 'working', 'the room to work');
  await say(rs2, 'interrupt');
  await idle(rs2);
  assert.deepEqual(readEvents(s.ctx, r2.id).filter((e) => e.type === 'founder.message').map((e) => e.text), ['first', 'interrupt']);
  assert.ok(readEvents(s.ctx, r2.id).some((e) => e.type === 'turn.error' && e.stopped));
});

test('a paused queue (as an app that was closed leaves it) waits until it is resumed', async (t) => {
  slowModel(t, { hang: 0 }); const s = await setup(t);
  const { setQueue } = await import('../engine/server/threads.mjs');
  setQueue(s.ctx, s.tid, [{ id: 'a', text: 'old', attachments: [] }], true);
  const r = await call('POST', `${s.url}/queue/resume`, {});
  assert.equal(r.status, 200);
  await idle(s);
  assert.deepEqual(readEvents(s.ctx, s.tid).filter((e) => e.type === 'founder.message').map((e) => e.text), ['old']);
});
