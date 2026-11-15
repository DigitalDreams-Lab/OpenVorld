// Vorlds, the crew, XP and deeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { home, makeVorld, saveVorld } from './helpers/vorld.mjs';
import { startServer, call, newVorld } from './helpers/server.mjs';

const { parse, evaluate } = await import('../tools/lib/dsl.mjs');
const { gameFor, xpFor } = await import('../engine/server/game.mjs');
const { atlasFor } = await import('../engine/server/art.mjs');
const { projectOf } = await import('../engine/server/benches.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');
const { createThread } = await import('../engine/server/threads.mjs');

test('the deed language: events, counts, counters, all/any', () => {
  const ctx = { events: { 'quest.done': 3 }, counters: { 'crew.agents': 2 } };
  assert.equal(evaluate(parse('event:quest.done'), ctx), true);
  assert.equal(evaluate(parse('count(event:quest.done) >= 3'), ctx), true);
  assert.equal(evaluate(parse('crew.agents >= 3'), ctx), false);
  assert.equal(evaluate(parse('any(crew.agents >= 3, event:quest.done)'), ctx), true);
  assert.equal(evaluate(parse('all(crew.agents >= 3, event:quest.done)'), ctx), false);
  assert.throws(() => parse('rm -rf'), /cannot read/);
});

test('a new vorld: its folder, its crew, ids that never clash, and the founding deed', () => {
  const ctx = makeVorld({ name: 'Tea & Co', crew: [{ name: 'Ada' }, { name: 'Ada' }, { name: '' }] });
  assert.ok(fs.existsSync(path.join(home, 'vorlds', ctx.id, 'vorld.yaml')));
  assert.deepEqual(ctx.crew.map((c) => [c.id, c.role]), [['buzz', 'companion'], ['ada', 'agent'], ['ada-2', 'agent']], 'nameless members are skipped');
  const game = gameFor(ctx);
  assert.ok(game.s.deeds.vorld_founded);
  assert.equal(game.s.level, 1);
});

test('XP: chat is capped per day, finished work is not, levels follow the curve', () => {
  const ctx = makeVorld();
  const game = gameFor(ctx), notes = [];
  for (let i = 0; i < 100; i++) game.xp('chat_message', notes);
  assert.equal(game.s.chat.xp, ctx.interactions.xp.chat_per_day, 'chat stops at the daily cap');
  game.xp('quest_done', notes).check(notes);
  assert.ok(notes.some((n) => n.type === 'level'));
  assert.ok(game.s.xp >= xpFor(game.s.level, ctx.interactions.levels) && game.s.xp < xpFor(game.s.level + 1, ctx.interactions.levels));
});

test('every crew member has sprites on the default sheets', () => {
  const ctx = makeVorld({ crew: [{ name: 'Ada' }, { name: 'Bo' }] });
  const atlas = atlasFor(ctx);
  const frames = Object.assign({}, ...atlas.sheets.map((s) => s.frames));
  for (const id of ['founder', ...ctx.crew.map((c) => c.id)]) {
    assert.ok(frames[`c_${id.replace(/-/g, '_')}_down_2`], `${id} can walk`);
    assert.ok(frames[`c_${id.replace(/-/g, '_')}_portrait`], `${id} has a portrait`);
  }
  assert.ok(frames.t_ground_0 && frames.p_tree_0_0 && frames.i_trophy, 'tiles, props and icons');
});

test('the crew API: add, edit, brain, remove; the companion stays', async (t) => {
  await startServer(t);
  const { root } = await newVorld();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-add-ws-')); t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const added = await call('POST', `${root}/crew`, { name: 'Ada', job: 'Writer', function: 'Writes posts', brain: { provider: 'claude-code', model: 'opus' }, bench: ws });
  assert.equal(added.status, 200);
  assert.equal(added.data.crew.length, 2);
  assert.equal(added.data.added, 'ada');
  const addedAda = added.data.crew.find((c) => c.id === 'ada');
  assert.deepEqual(addedAda.brain, { provider: 'claude-code', model: 'opus' });
  assert.deepEqual(addedAda.benches.map((b) => [b.id, b.path, b.chosen]), [['main', ws, true]]);
  const edited = await call('PUT', `${root}/crew/ada`, { job: 'Editor', brain: { provider: 'claude-code', model: 'sonnet' } });
  const ada = edited.data.crew.find((c) => c.id === 'ada');
  assert.equal(ada.job, 'Editor'); assert.deepEqual(ada.brain, { provider: 'claude-code', model: 'sonnet' });
  const companion = edited.data.crew.find((c) => c.role === 'companion');
  assert.equal((await call('DELETE', `${root}/crew/${companion.id}`)).status, 400);
  assert.equal((await call('DELETE', `${root}/crew/ada`)).data.crew.length, 1);
  assert.equal((await call('GET', '/api/boot', undefined, {}, false)).status, 401, 'every API call needs the launch token');
  const boot = (await call('GET', '/api/boot')).data;
  assert.ok(boot.templates.some((x) => x.id === 'blank') && boot.vorlds.length >= 1);
  const sheet = await call('GET', '/api/art/world.png');
  assert.equal(sheet.status, 200); assert.equal(sheet.headers['content-type'], 'image/png');
  assert.equal((await call('GET', '/api/art/..%2Fsecrets')).status, 404);
});

test('a vorld has one project folder the whole crew reads; changing it needs a writ', async (t) => {
  const own = makeVorld();
  assert.equal(projectOf(own).path, path.join(own.dir, 'project'), 'without a choice the vorld keeps its own project folder');
  assert.ok(fs.existsSync(path.join(own.dir, 'project')));

  const repo = fs.mkdtempSync(path.join(home, 'repo-'));
  fs.writeFileSync(path.join(repo, 'README.md'), 'Lantern Tea sells green tea.');
  let ctx = makeVorld({ project: repo, crew: [{ name: 'Ada', job: 'Writer' }], brain: { provider: 'openai-compatible', model: 'm', name: 'local' } });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', name: 'local', base_url: 'http://local.test/v1' }]; });
  assert.equal(projectOf(ctx).path, repo);
  assert.throws(() => makeVorld({ project: path.join(home, 'missing') }), /not a folder/);
  assert.throws(() => makeVorld({ project: os.homedir() }), /too broad/);

  const sse = (d) => new Response(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
  const call = (id, name, args) => sse({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] });
  let n = 0;
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    n++;
    if (n === 1) return call('r1', 'read_file', { path: path.join(repo, 'README.md') });
    if (n === 2) return call('w1', 'write_file', { path: path.join(repo, 'README.md'), content: 'changed' });
    return sse({ content: 'Read it.' });
  });
  await runTurn(ctx, createThread(ctx, { role: 'ada' }).id, 'what do we sell?', () => {});
  const results = bodies.flatMap((b) => b.messages.filter((m) => m.role === 'tool'));
  assert.match(results[0].content, /green tea/, 'every member can read the project');
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'Lantern Tea sells green tea.', 'but not change it without a writ');
  assert.match(bodies[0].messages[0].content, new RegExp(`project folder, shared by the whole crew, is ${repo.replace(/[/.]/g, '\\$&')}`));
});

test('the project folder can be changed from settings', async (t) => {
  await startServer(t);
  const { root } = await newVorld();
  const repo = fs.mkdtempSync(path.join(home, 'repo-'));
  const set = await call('PUT', root, { project: repo });
  assert.equal(set.status, 200);
  assert.equal(set.data.vorld.project.path, repo);
  assert.equal(set.data.vorld.project.chosen, true);
  assert.equal((await call('PUT', root, { project: path.join(os.homedir(), '.ssh') })).status, 400, 'never-listed folders cannot be the project');
  const back = await call('PUT', root, { project: null });
  assert.equal(back.data.vorld.project.chosen, false);
});
