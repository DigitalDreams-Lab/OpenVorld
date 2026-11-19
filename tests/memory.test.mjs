// Crew memory: the notebook a member keeps between chats, the summary of each chat, and the recall tool that looks back
// at older chats (mocked HTTP, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVorld, saveVorld } from './helpers/vorld.mjs';

const M = await import('../engine/server/memory.mjs');
const P = await import('../engine/server/parties.mjs');
const { createThread, appendEvent, readEvents } = await import('../engine/server/threads.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');
const { splitEnvelope } = await import('../engine/server/agents/envelope.mjs');
const { engineTools } = await import('../engine/server/agents/tools.mjs');
const { setSecret } = await import('../engine/server/house.mjs');
const { browserFor } = await import('../engine/server/agents/browse.mjs');

const sse = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
function crew() {
  let ctx = makeVorld({ name: 'Memory Test', brain: { provider: 'openai-compatible', model: 'memory-test' }, crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }] });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const [ada, bo] = ctx.crew.filter((c) => c.role === 'agent').map((c) => c.id);
  return { ctx, ada, bo };
}

test('the ov block carries notes to keep, notes to drop and where the chat stands', () => {
  const { meta } = splitEnvelope('Done.\n```ov\n{"remember":["Founder likes 60 fps", 3],"forget":["a1b2c3"],"summary":"Set up the export."}\n```');
  assert.deepEqual([meta.remember, meta.forget, meta.summary], [['Founder likes 60 fps'], ['a1b2c3'], 'Set up the export.']);
  assert.deepEqual(splitEnvelope('Plain.').meta, {});
});

test('the notebook keeps short facts once, up to its size, hides secrets, and forgets by id', () => {
  const { ctx, ada } = crew();
  ctx.interactions.agent.memory = { ...ctx.interactions.agent.memory, notes_max: 3 };
  setSecret(ctx, ada, 'YT_KEY', 'sk-very-secret-value');
  assert.deepEqual(M.applyMemory(ctx, ada, 't1', { remember: ['Shorts are 60 fps', 'shorts are 60 FPS', 'Key is sk-very-secret-value'] }), ['Shorts are 60 fps', 'Key is $YT_KEY']);
  M.applyMemory(ctx, ada, 't1', { remember: ['Posts go out at 9', 'One too many'] });
  const list = M.notes(ctx, ada);
  assert.deepEqual(list.map((n) => n.text), ['Shorts are 60 fps', 'Key is $YT_KEY', 'Posts go out at 9'], 'a full notebook takes nothing new');
  M.applyMemory(ctx, ada, 't1', { forget: [list[1].id], remember: ['Now there is room'] });
  assert.deepEqual(M.notes(ctx, ada).map((n) => n.text), ['Shorts are 60 fps', 'Posts go out at 9', 'Now there is room']);
  assert.deepEqual(M.notes(ctx, 'nobody-else'), [], 'every member has their own notebook');
  assert.equal(M.editNote(ctx, ada, list[0].id, '  Shorts are   30 fps ')[0].text, 'Shorts are 30 fps');
  assert.equal(M.dropNote(ctx, ada, list[0].id).length, 2);
});

test('a new chat starts with the notebook and the latest other chats; a resumed one gets the notebook only', () => {
  const { ctx, ada } = crew();
  const a = createThread(ctx, { role: ada, title: 'Launch plan' }), b = createThread(ctx, { role: ada, title: 'Pricing' });
  M.applyMemory(ctx, ada, a.id, { remember: ['Launch is Friday'], summary: 'Drafted the launch plan; the date is open.' });
  M.applyMemory(ctx, ada, a.id, { summary: 'Launch plan done; it ships Friday.' });
  const fresh = M.memoryContext(ctx, ada, b.id);
  assert.match(fresh, /Launch is Friday/);
  assert.match(fresh, /"Launch plan" \([\d-]+\): Launch plan done; it ships Friday\./, 'the newest summary replaces the old one');
  assert.doesNotMatch(fresh, /date is open/);
  assert.doesNotMatch(M.memoryContext(ctx, ada, a.id), /Your latest other chats/, 'a chat is not listed in itself');
  assert.doesNotMatch(M.memoryContext(ctx, ada, b.id, { recent: false }), /Your latest other chats/);
  assert.equal(M.dropChat(ctx, ada, a.id).length, 0);
  ctx.interactions.agent.memory = { ...ctx.interactions.agent.memory, enabled: false };
  assert.equal(M.memoryContext(ctx, ada, b.id), '');
  assert.deepEqual(M.applyMemory(ctx, ada, b.id, { remember: ['x'] }), []);
});

test('recall finds a member\'s own chats and the party rooms they spoke in, and reads one back', () => {
  const { ctx, ada, bo } = crew();
  const mine = createThread(ctx, { role: ada, title: 'Newsletter' });
  appendEvent(ctx, mine.id, { type: 'founder.message', text: 'Write the newsletter about the pricing change' });
  appendEvent(ctx, mine.id, { type: 'agent.text', role: ada, text: 'Here is a draft about the new pricing.' });
  const theirs = createThread(ctx, { role: bo, title: 'Secret pricing' });
  appendEvent(ctx, theirs.id, { type: 'founder.message', text: 'pricing for Bo only' });
  const party = P.saveParty(ctx, { name: 'Crew', goal: 'x', members: [bo, ada] });
  const room = P.createPartyChat(ctx, party.id);
  appendEvent(ctx, room.id, { type: 'founder.message', text: 'Plan the pricing page' });
  appendEvent(ctx, room.id, { type: 'agent.text', role: ada, text: 'I will write the pricing copy.' });
  M.applyMemory(ctx, ada, mine.id, { summary: 'Newsletter draft on pricing, waiting for review.' });

  const found = M.recall(ctx, ada, { query: 'pricing newsletter' });
  assert.ok(found.indexOf(mine.id) >= 0 && found.indexOf(mine.id) < found.indexOf(room.id), 'the best match comes first');
  assert.match(found, /waiting for review/);
  assert.ok(!found.includes(theirs.id), 'never another member\'s own chat');
  assert.match(M.recall(ctx, ada, { query: 'zebra' }), /Nothing in your past chats matches/);
  const read = M.recall(ctx, ada, { chat: room.id });
  assert.match(read, /Founder: Plan the pricing page\n\nYou: I will write the pricing copy\./);
  assert.match(M.recall(ctx, ada, { chat: theirs.id }), /No chat/);
  assert.ok(!M.recall(ctx, bo, {}).includes(room.id), 'a party room counts once the member spoke in it');
  assert.ok(engineTools({ ctx, role: ada, cwd: ctx.dir }).specs.some((s) => s.function.name === 'recall'), 'API brains get the recall tool');
  ctx.interactions.agent.browser = { ...ctx.interactions.agent.browser, enabled: false };
  const bridge = browserFor(ctx, ada, mine.id, {});
  assert.equal(bridge.call, null);
  assert.equal(bridge.mcp.env.OV_TOOLS, 'secret_ask,recall', 'Claude Code and Codex get recall over the bridge, even with no browser');
});

test('a turn keeps what the member asked to remember, shows it in the chat, and the next chat starts with it', async (t) => {
  const { ctx, ada } = crew();
  const systems = [];
  const replies = ['Noted.\n```ov\n{"remember":["Founder posts at 9 am"],"summary":"Agreed on the posting time.","title":"Schedule"}\n```', 'Sure.'];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { systems.push(JSON.parse(options.body).messages[0].content); return sse(replies.shift()); });
  const first = createThread(ctx, { role: ada });
  const r = await runTurn(ctx, first.id, 'I always post at 9 am', () => {});
  assert.deepEqual(r.meta.noted, ['Founder posts at 9 am']);
  assert.ok(!('remember' in r.meta) && !('summary' in r.meta), 'memory fields are not shown as chat meta');
  assert.deepEqual(readEvents(ctx, first.id).find((e) => e.type === 'agent.text').meta.noted, ['Founder posts at 9 am']);
  await runTurn(ctx, createThread(ctx, { role: ada }).id, 'When do I post?', () => {});
  assert.match(systems[1], /Founder posts at 9 am/);
  assert.match(systems[1], /"Schedule" \([\d-]+\): Agreed on the posting time\./);
});
