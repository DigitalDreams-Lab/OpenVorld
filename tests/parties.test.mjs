// Parties: a name, a goal and members; one shared room where the members take turns, hand work to each other with
// @mentions, join the founder and stay nearby when the job is done (mocked HTTP, no network).
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeVorld, saveVorld, vorldCtx } from './helpers/vorld.mjs';

const P = await import('../engine/server/parties.mjs');
const { readEvents, getThread } = await import('../engine/server/threads.mjs');
const { createVorld } = await import('../engine/server/vorld.mjs');

const sse = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);

function crewOf(brain = { provider: 'openai-compatible', model: 'party-test' }) {
  let ctx = makeVorld({ name: 'Party Test', brain, crew: [{ name: 'Ada', job: 'Writer', function: 'writes' }, { name: 'Bo Li', job: 'Editor' }, { name: 'Cy', job: 'Checker' }] });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const [ada, bo, cy] = ctx.crew.filter((c) => c.role === 'agent').map((c) => c.id);
  return { ctx, ada, bo, cy };
}

test('a party has a name, a goal and one or more members; the first leads', () => {
  const { ctx, ada, bo } = crewOf();
  assert.throws(() => P.saveParty(ctx, { name: '', members: [ada] }), /needs a name/);
  assert.throws(() => P.saveParty(ctx, { name: 'Empty', members: ['nobody'] }), /at least one member/);
  const p = P.saveParty(ctx, { name: 'Launch', goal: 'Ship the post', members: [bo, ada, ada, 'nobody'] });
  assert.deepEqual(p.members, [bo, ada], 'duplicates and strangers are dropped, order is kept (the first leads)');
  assert.equal(P.getParty(ctx, p.id).goal, 'Ship the post');
  const edited = P.saveParty(ctx, { name: 'Launch 2', goal: 'x', members: [ada] }, p.id);
  assert.deepEqual([edited.name, edited.members], ['Launch 2', [ada]]);
  assert.equal(P.listParties(ctx).length, 1);
  P.removeFromParties(ctx, ada);
  assert.deepEqual(P.getParty(ctx, p.id).members, []);
  P.deleteParty(ctx, p.id);
  assert.throws(() => P.getParty(ctx, p.id), /unknown party/);
});

test('templates start with a party made of their crew', () => {
  const { id } = createVorld({ name: 'Starter Shop', template: 'software' });
  const ctx = vorldCtx(id, { fresh: true });
  assert.equal(ctx.crew.filter((c) => c.role === 'agent').length, 3);
  assert.equal(P.listParties(ctx).length, 0, 'createVorld only returns the starters; the server saves them');
  const { starters } = createVorld({ name: 'Starter Shop Two', template: 'software' });
  assert.equal(starters.length, 1);
  assert.equal(starters[0].members.length, 3);
});

test('an @mention picks the next speaker: names and first names, never yourself, never inside code', () => {
  const { ctx, ada, bo, cy } = crewOf();
  const all = [ada, bo, cy];
  assert.equal(P.mentionOf(ctx, 'Over to @Bo Li please', all, ada), bo);
  assert.equal(P.mentionOf(ctx, 'ping @bo and @Cy', all, ada), bo, 'the first mention wins');
  assert.equal(P.mentionOf(ctx, '@Ada I am done', all, ada), null, 'not yourself');
  assert.equal(P.mentionOf(ctx, 'run `@Cy` or ```\n@Cy\n``` in code', all, ada), null, 'code is not a mention');
  assert.equal(P.mentionOf(ctx, 'hello @Cynthia', all, ada), null, 'a longer word is not a name');
  assert.equal(P.mentionOf(ctx, '@Cy first, @Bo later', all), cy);
});

test('the room: the leader answers, hands over with @Name, the teammate answers, and the job ends when nobody is mentioned', async (t) => {
  const { ctx, ada, bo, cy } = crewOf();
  const party = P.saveParty(ctx, { name: 'Launch', goal: 'Ship the post', members: [ada, bo, cy] });
  const chat = P.createPartyChat(ctx, party.id);
  const prompts = [];
  const replies = { [ada]: ['Outline ready. @Bo Li please edit it.', 'Final: all done.'], [bo]: ['Edited it. @Ada over to you for the final.'] };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    const who = [ada, bo, cy].find((id) => JSON.stringify(body.messages).includes(`You are ${ctx.member(id).name} in the party`));
    prompts.push([who, JSON.stringify(body.messages)]);
    return sse(replies[who].shift());
  });
  const events = [];
  await P.runParty(ctx, chat.id, 'Write a launch post', [], (e) => events.push(e));

  const room = readEvents(ctx, chat.id);
  assert.deepEqual(room.filter((e) => e.type === 'founder.message' || e.type === 'agent.text').map((e) => [e.role ?? 'founder', e.text]), [
    ['founder', 'Write a launch post'], [ada, 'Outline ready. @Bo Li please edit it.'], [bo, 'Edited it. @Ada over to you for the final.'], [ada, 'Final: all done.'],
  ]);
  assert.deepEqual(prompts.map((p) => p[0]), [ada, bo, ada]);
  assert.ok(prompts[0][1].includes('Ship the post') && prompts[0][1].includes('leader'), 'a member is told the goal and who leads');
  assert.ok(prompts[1][1].includes('Outline ready.'), 'the teammate sees what was said before');
  assert.ok(prompts[1][1].includes('Founder: Write a launch post'));

  assert.deepEqual(events.filter(e => e.type === 'party.gather').map(e => e.members), [[ada, bo, cy]], 'the party joins the founder once for the whole conversation');
  assert.ok(!events.some(e => e.type === 'command' && e.commands.some(c => c.do === 'go_home' || c.to?.kind === 'plaza')), 'sending a message never forces the party away to the hall or home');
  assert.ok(events.some((e) => e.type === 'party.idle'));
  const th = getThread(ctx, chat.id);
  assert.equal(th.state, 'waiting');
  assert.equal(th.speaker, null);
  assert.equal(th.title, 'Write a launch post');
  assert.ok(vorldCtx(ctx.id, { fresh: true }) && P.partyBusy(chat.id) === false);
});

test('an @mention from the founder picks who speaks first, and the turn cap stops a ping-pong', async (t) => {
  const { ctx, ada, bo } = crewOf();
  ctx.interactions.party = { max_turns: 4 };
  const party = P.saveParty(ctx, { name: 'Pingers', goal: 'argue', members: [ada, bo] });
  const chat = P.createPartyChat(ctx, party.id);
  const spoke = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const who = [ada, bo].find((id) => JSON.stringify(JSON.parse(options.body).messages).includes(`You are ${ctx.member(id).name} in the party`));
    spoke.push(who);
    return sse(who === ada ? '@Bo Li your turn' : '@Ada your turn');
  });
  await P.runParty(ctx, chat.id, '@Bo Li start us off', [], () => {});
  assert.deepEqual(spoke, [bo, ada, bo, ada], 'the mentioned member starts; four turns at most');
  const room = readEvents(ctx, chat.id);
  assert.ok(room.some((e) => e.type === 'party.paused'), 'the room says it paused');
});

test('a writ request pauses the room; the answer picks it up with the same member', async (t) => {
  const { ctx, ada, bo } = crewOf();
  const party = P.saveParty(ctx, { name: 'Gate', goal: 'g', members: [ada, bo] });
  const chat = P.createPartyChat(ctx, party.id);
  const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-notes-'));
  const lang = ctx.interactions.envelope?.block_lang ?? 'ov';
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    n++;
    if (n === 1) return sse('I need to read your notes.\n\n```' + lang + '\n{"access":[{"capability":"fs.read","scope":' + JSON.stringify(notes) + ',"why":"read notes"}]}\n```');
    return sse('Read them. @Bo Li continue.');
  });
  const events = [];
  await P.runParty(ctx, chat.id, 'go', [], (e) => events.push(e));
  assert.equal(readEvents(ctx, chat.id).filter((e) => e.type === 'writ.request').length, 1);
  assert.equal(n, 1, 'the room stopped at the writ');
  assert.ok(!events.some((e) => e.type === 'command' && e.commands[0].do === 'go_home'), 'the party stays gathered while it waits');
});

test('the API: form a party, open a chat, write in it, and the room answers', async (t) => {
  const { startServer, call, newVorld } = await import('./helpers/server.mjs');
  await startServer(t);
  const { id, root } = await newVorld({ template: 'blank', crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo', job: 'Editor' }], brain: { provider: 'openai-compatible', model: 'party-test' } });
  const ctx = vorldCtx(id, { fresh: true });
  saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const [ada, bo] = ctx.crew.filter((c) => c.role === 'agent').map((c) => c.id);

  assert.equal((await call('POST', `${root}/parties`, { name: '', members: [ada] })).status, 400);
  const made = await call('POST', `${root}/parties`, { name: 'Duo', goal: 'Write a poem', members: [ada, bo] });
  assert.equal(made.status, 200);
  assert.deepEqual(made.data.parties.map((p) => [p.name, p.members]), [['Duo', [ada, bo]]]);
  const pid = made.data.added;
  const chat = (await call('POST', `${root}/parties/${pid}/chats`, {})).data;
  assert.equal(chat.kind, 'party');
  assert.deepEqual((await call('GET', `${root}/parties/${pid}/chats`)).data.map((c) => c.id), [chat.id]);
  assert.equal((await call('POST', `${root}/parties/nope-nope/chats`, {})).status, 404);

  t.mock.method(globalThis, 'fetch', async () => sse('Roses. @Bo polish it.'));
  assert.equal((await call('POST', `${root}/threads/${chat.id}/messages`, { text: 'Write a poem' })).status, 200);
  for (let i = 0; i < 100 && (P.partyBusy(chat.id) || readEvents(ctx, chat.id).filter((e) => e.type === 'agent.text').length < 2); i++) await new Promise((r) => setTimeout(r, 20));
  const said = readEvents(ctx, chat.id).filter((e) => e.type === 'agent.text').map((e) => e.role);
  assert.deepEqual(said.slice(0, 2), [ada, bo], 'the leader answered and the teammate she mentioned answered next');
  assert.ok(said.length <= 12, 'the room stopped by itself');
  while (P.partyBusy(chat.id)) await new Promise((r) => setTimeout(r, 20));

  const removed = await call('DELETE', `${root}/parties/${pid}`);
  assert.deepEqual(removed.data.parties, []);
});

test('answering a writ while the member is still mid-turn still carries the work on (chat and party)', async (t) => {
  const { startServer, call, newVorld } = await import('./helpers/server.mjs');
  await startServer(t);
  const { id, root } = await newVorld({ template: 'blank', crew: [{ name: 'Ada', job: 'Writer' }], brain: { provider: 'openai-compatible', model: 'party-test' } });
  const ctx = vorldCtx(id, { fresh: true });
  saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const ada = ctx.crew.find((c) => c.role === 'agent').id;

  for (const kind of ['chat', 'party']) {
    let n = 0;
    t.mock.restoreAll?.();
    t.mock.method(globalThis, 'fetch', async () => { n++; await new Promise((r) => setTimeout(r, 400)); return sse('Thanks, carrying on.'); });
    let tid;
    if (kind === 'chat') tid = (await call('POST', `${root}/threads`, { role: ada })).data.id;
    else { const p = (await call('POST', `${root}/parties`, { name: 'Solo', goal: 'g', members: [ada] })).data; tid = (await call('POST', `${root}/parties/${p.added}/chats`, {})).data.id; }
    await call('POST', `${root}/threads/${tid}/messages`, { text: 'go' });
    // the member asks for a secret through the tool bridge (as Claude Code and Codex do) while its turn is still running
    const key = kind === 'chat' ? 'CHAT_KEY' : 'PARTY_KEY';
    await call('POST', `${root}/browser/${ada}/secret_ask?thread=${tid}`, { name: key, why: 'test' });
    const ask = readEvents(ctx, tid).find((e) => e.type === 'writ.request');
    assert.ok(ask, `${kind}: the request appeared`);
    assert.ok(P.partyBusy(tid), `${kind}: the turn is still running when the founder answers`);
    assert.equal((await call('POST', `${root}/threads/${tid}/writs/${ask.id}`, { answer: 'always', value: 'abcdef-123456' })).status, 200);
    for (let i = 0; i < 200 && n < 2; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(n, 2, `${kind}: the member was asked to continue`);
    for (let i = 0; i < 200 && (P.partyBusy(tid) || getThread(ctx, tid).state === 'working'); i++) await new Promise((r) => setTimeout(r, 25));
  }
});
