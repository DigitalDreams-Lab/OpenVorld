// Worlds, the crew, XP and deeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { home, makeWorld } from './helpers/world.mjs';
import { startServer, call, newWorld } from './helpers/server.mjs';

const { parse, evaluate } = await import('../tools/lib/dsl.mjs');
const { gameFor, xpFor } = await import('../engine/server/game.mjs');
const { atlasFor } = await import('../engine/server/art.mjs');

test('the deed language: events, counts, counters, all/any', () => {
  const ctx = { events: { 'quest.done': 3 }, counters: { 'crew.agents': 2 } };
  assert.equal(evaluate(parse('event:quest.done'), ctx), true);
  assert.equal(evaluate(parse('count(event:quest.done) >= 3'), ctx), true);
  assert.equal(evaluate(parse('crew.agents >= 3'), ctx), false);
  assert.equal(evaluate(parse('any(crew.agents >= 3, event:quest.done)'), ctx), true);
  assert.equal(evaluate(parse('all(crew.agents >= 3, event:quest.done)'), ctx), false);
  assert.throws(() => parse('rm -rf'), /cannot read/);
});

test('a new world: its folder, its crew, ids that never clash, and the founding deed', () => {
  const ctx = makeWorld({ name: 'Tea & Co', crew: [{ name: 'Ada' }, { name: 'Ada' }, { name: '' }] });
  assert.ok(fs.existsSync(path.join(home, 'worlds', ctx.id, 'world.yaml')));
  assert.deepEqual(ctx.crew.map((c) => [c.id, c.role]), [['buzz', 'companion'], ['ada', 'agent'], ['ada-2', 'agent']], 'nameless members are skipped');
  const game = gameFor(ctx);
  assert.ok(game.s.deeds.world_founded);
  assert.equal(game.s.level, 1);
});

test('XP: chat is capped per day, finished work is not, levels follow the curve', () => {
  const ctx = makeWorld();
  const game = gameFor(ctx), notes = [];
  for (let i = 0; i < 100; i++) game.xp('chat_message', notes);
  assert.equal(game.s.chat.xp, ctx.interactions.xp.chat_per_day, 'chat stops at the daily cap');
  game.xp('quest_done', notes).check(notes);
  assert.ok(notes.some((n) => n.type === 'level'));
  assert.ok(game.s.xp >= xpFor(game.s.level, ctx.interactions.levels) && game.s.xp < xpFor(game.s.level + 1, ctx.interactions.levels));
});

test('every crew member has sprites on the default sheets', () => {
  const ctx = makeWorld({ crew: [{ name: 'Ada' }, { name: 'Bo' }] });
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
  const { root } = await newWorld();
  const added = await call('POST', `${root}/crew`, { name: 'Ada', job: 'Writer', function: 'Writes posts' });
  assert.equal(added.status, 200);
  assert.equal(added.data.crew.length, 2);
  assert.equal(added.data.added, 'ada');
  const edited = await call('PUT', `${root}/crew/ada`, { job: 'Editor', brain: { provider: 'claude-code', model: 'sonnet' } });
  const ada = edited.data.crew.find((c) => c.id === 'ada');
  assert.equal(ada.job, 'Editor'); assert.deepEqual(ada.brain, { provider: 'claude-code', model: 'sonnet' });
  const companion = edited.data.crew.find((c) => c.role === 'companion');
  assert.equal((await call('DELETE', `${root}/crew/${companion.id}`)).status, 400);
  assert.equal((await call('DELETE', `${root}/crew/ada`)).data.crew.length, 1);
  assert.equal((await call('GET', '/api/boot', undefined, {}, false)).status, 401, 'every API call needs the launch token');
  const boot = (await call('GET', '/api/boot')).data;
  assert.ok(boot.templates.some((x) => x.id === 'blank') && boot.worlds.length >= 1);
  const sheet = await call('GET', '/api/art/world.png');
  assert.equal(sheet.status, 200); assert.equal(sheet.headers['content-type'], 'image/png');
  assert.equal((await call('GET', '/api/art/..%2Fsecrets')).status, 404);
});
