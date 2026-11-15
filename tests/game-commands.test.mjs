// Game commands: what crew members DO in their world. Checked against the pack and the world, taught to every brain in its
// prompt, sent by API brains through a tool and by every brain through the `ov` block, and acted out by the map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clientModule } from './helpers/client.mjs';
import { home, makeWorld, saveWorld } from './helpers/world.mjs';
const { createThread, readEvents } = await import('../engine/server/threads.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');
const { engineTools } = await import('../engine/server/agents/tools.mjs');
const { splitEnvelope } = await import('../engine/server/agents/envelope.mjs');
const { prepareCommands, commandHelp, worldFacts, worldInfo } = await import('../engine/server/agents/commands.mjs');

const sse = (deltas) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join('') + 'data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const CREW = [{ name: 'Ada Brook', job: 'Writer' }, { name: 'Bo Reed', job: 'Editor' }, { name: 'Cy Moss', job: 'Researcher' }];
function world(brain) {
  let ctx = makeWorld({ crew: CREW, ...(brain ? { brain } : {}) });
  if (brain) ctx = saveWorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', name: 'local', base_url: 'http://local.test/v1' }]; });
  return { ctx, companion: ctx.companionId, agents: ctx.crew.filter((c) => c.role === 'agent') };
}
const API = { provider: 'openai-compatible', model: 'm', name: 'local' };

test('the envelope carries commands through, capped and plain', () => {
  const { meta } = splitEnvelope('Hi.\n```ov\n{"commands":[{"do":"wave"},"junk",[1],{"do":"say","text":"x"}],"mood":"happy"}\n```');
  assert.deepEqual(meta.commands, [{ do: 'wave' }, { do: 'say', text: 'x' }]);
  assert.equal(splitEnvelope('no block').meta.commands, undefined);
});

test('commands are checked: roles, the map, the crew, limits and plain text', async () => {
  const { ctx, companion, agents } = world();
  const [a, b, c] = agents, facts = worldFacts(ctx);
  assert.ok(facts.props.size > 3, 'the map has things to use');
  const prop = [...facts.props.keys()].find((k) => ctx.packs.byKind.game_commands.game_commands.interactions[k]);
  const ok = prepareCommands(ctx, a.id, [
    { do: 'say', text: '  Fresh   <b>bread</b>!  ' }, { do: 'emote', kind: 'Wave' }, { do: 'walk_to', to: 'Plaza' }, { do: 'walk_to', to: b.name.split(' ')[0].toUpperCase() },
    { do: 'interact', with: prop }, { do: 'wait', seconds: 999 }]);
  assert.deepEqual(ok.dropped, []);
  assert.deepEqual(ok.commands.map((x) => x.do), ['say', 'emote', 'walk_to', 'walk_to', 'interact', 'wait']);
  assert.equal(ok.commands[0].text, 'Fresh bread!', 'markup and spacing are cleaned');
  assert.ok(!/[<>]/.test(ok.commands[0].text));
  assert.deepEqual(ok.commands[2].to, { kind: 'plaza' });
  assert.deepEqual(ok.commands[3].to, { kind: 'member', id: b.id }, 'a crew member by first name, any case');
  assert.equal(ok.commands[5].ms, 10000, 'a pause is capped');
  assert.match(ok.commands[4].label, /./);
  assert.equal(ok.commands[2].label, 'walks to the plaza');

  const bad = prepareCommands(ctx, a.id, [{ do: 'fly' }, { do: 'emote', kind: 'explode' }, { do: 'walk_to', to: 'the moon' }, { do: 'interact', with: 'spaceship' }, { do: 'say' }, { do: 'summon', who: 'all' }, { do: 'show', panel: 'deeds' }, { do: 'rm -rf /' }]);
  assert.deepEqual(bad.commands, []);
  assert.equal(bad.dropped.length, 8, 'every bad one says why');
  assert.ok(bad.dropped.some((d) => /not for agents/.test(d)));

  const self = prepareCommands(ctx, a.id, [{ do: 'walk_to', to: a.name }]);
  assert.deepEqual(self.commands[0].to, { kind: 'home' }, 'walking to yourself means going home');
  const many = prepareCommands(ctx, a.id, Array.from({ length: 20 }, () => ({ do: 'emote', kind: 'wave' })));
  assert.equal(many.commands.length, ctx.packs.byKind.game_commands.game_commands.limits.per_reply);
  assert.deepEqual(prepareCommands(ctx, a.id, 'nonsense'), { commands: [], dropped: [] });

  // only the companion calls others over
  const comp = prepareCommands(ctx, companion, [{ do: 'summon', who: [a.name, c.name, 'Nobody'] }, { do: 'gather', who: 'all' }, { do: 'send_home', who: companion }, { do: 'show', panel: 'quests' }, { do: 'show', panel: 'admin' }, { do: 'point_to', to: 'plaza' }]);
  assert.deepEqual(comp.commands.find((x) => x.do === 'summon').who, [a.id, c.id], 'nobody unknown');
  assert.deepEqual(comp.commands.find((x) => x.do === 'gather').who.sort(), [a.id, b.id, c.id].sort());
  assert.ok(!comp.commands.some((x) => x.do === 'send_home'), 'the companion cannot send itself home');
  assert.equal(comp.commands.find((x) => x.do === 'show').panel, 'quests');
  assert.equal(comp.commands.filter((x) => x.do === 'show').length, 1, 'only real screens');
});

test('every brain is taught what it can do on this map, the companion more than an agent', async () => {
  const { ctx, companion, agents } = world();
  const agentHelp = commandHelp(ctx, agents[0].id), compHelp = commandHelp(ctx, companion);
  for (const w of ['walk_to', 'interact', 'emote', 'say', 'go_home']) assert.match(agentHelp, new RegExp(w));
  for (const w of ['summon', 'gather', 'send_home', 'point_to', 'show']) { assert.doesNotMatch(agentHelp, new RegExp(`- ${w}:`)); assert.match(compHelp, new RegExp(`- ${w}:`)); }
  assert.match(agentHelp, new RegExp([...worldFacts(ctx).props.keys()][0]), 'names the things on this very map');
  assert.match(agentHelp, new RegExp(agents[1].name.split(' ')[0]), 'and the people');
  assert.match(worldInfo(ctx, agents[0].id), /Places:.*plaza/);
});

test('an API brain acts through the game_command tool, others through the ov block; the reply shows what was done', async t => {
  const { ctx, companion, agents } = world(API);
  const role = agents[0].id;
  // 1. the tool
  const seen = [];
  const tools = engineTools({ ctx, role, cwd: ctx.dir, onCommand: (c) => seen.push(...c) });
  assert.ok(tools.specs.some((s) => s.function.name === 'game_command') && tools.specs.some((s) => s.function.name === 'world_info'));
  assert.equal(engineTools({ ctx, role, cwd: ctx.dir }).specs.some((s) => s.function.name === 'game_command'), false, 'not offered where nothing can show it');
  const r = await tools.run('game_command', { commands: [{ do: 'emote', kind: 'cheer' }, { do: 'walk_to', to: 'nowhere' }] });
  assert.equal(r.ok, true); assert.match(r.output, /Done: does a cheer/); assert.match(r.output, /Ignored/);
  assert.deepEqual(seen.map((c) => c.do), ['emote']);
  assert.equal((await tools.run('game_command', { commands: [{ do: 'fly' }] })).ok, false, 'nothing valid is an error the model can read');
  assert.match((await tools.run('world_info', {})).output, /Things on the map/);

  // 2. a whole turn: the ov block of the reply
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_u, init) => { prompt = JSON.parse(init.body).messages[0].content; return sse([{ content: 'On my way!\n```ov\n{"mood":"happy","commands":[{"do":"walk_to","to":"plaza"},{"do":"say","text":"Meeting time"},{"do":"fly"}]}\n```' }]); });
  const thread = createThread(ctx, { role });
  const sent = [];
  await runTurn(ctx, thread.id, 'join the others at the square', (e) => sent.push(e));
  assert.match(prompt, /Acting in the world/, 'the prompt teaches the commands');
  const cmd = sent.find((e) => e.type === 'command');
  assert.ok(cmd && cmd.role === role && cmd.thread === thread.id);
  assert.deepEqual(cmd.commands.map((c) => c.do), ['walk_to', 'say']);
  const reply = readEvents(ctx, thread.id).find((e) => e.type === 'agent.text');
  assert.deepEqual(reply.meta.did, ['walks to the plaza', 'says "Meeting time"'], 'the chat can show what they did');
  assert.equal(reply.meta.commands, undefined);
});

test('a reply with no commands sends none', async t => {
  const { ctx, agents } = world(API);
  const role = agents[0].id;
  t.mock.method(globalThis, 'fetch', async () => sse([{ content: 'Just words.\n```ov\n{"mood":"neutral"}\n```' }]));
  const thread = createThread(ctx, { role }), sent = [];
  await runTurn(ctx, thread.id, 'hi', (e) => sent.push(e));
  assert.ok(!sent.some((e) => e.type === 'command'));
});

test('on the map: the nearest prop, where to stand, which way to face, and the screens a command may open', async () => {
  const m = await clientModule('engine/client/src/game/commands.ts', { './pixels': 'data:text/javascript,export const movementDirection=(vx,vy,l="down")=>!vx&&!vy?l:Math.abs(vx)>Math.abs(vy)?(vx<0?"left":"right"):(vy<0?"up":"down")' });
  const props = [{ t: 'bench', x: 10, y: 10 }, { t: 'bench', x: 2, y: 2 }, { t: 'lamp', x: 3, y: 3 }];
  assert.deepEqual(m.nearestProp(props, 'bench', { x: 0, y: 0 }, 16), { x: 40, y: 40 }, 'the closer bench, centre of its tile');
  assert.equal(m.nearestProp(props, 'well', { x: 0, y: 0 }, 16), null);
  const spots = m.standSpots({ x: 40, y: 40 }, 16);
  assert.deepEqual(spots[0], { x: 40, y: 40 + 0.95 * 16 }, 'in front of it first');
  assert.ok(spots.length >= 6);
  assert.equal(m.facing({ x: 0, y: 10 }, { x: 0, y: 0 }), 'up');
  assert.equal(m.facing({ x: 0, y: 0 }, { x: 9, y: 1 }), 'right');
  assert.equal(m.clampQueue(Array.from({ length: 30 }, (_, i) => i), 12).length, 12);
  assert.deepEqual(m.clampQueue(undefined), []);
  assert.deepEqual(Object.keys(m.PANELS).sort(), ['deeds', 'quests', 'settings']);
  const { loadPacks: lp, packRoots: pr } = await import('../tools/lib/packs.mjs');
  const cfg = lp(pr(home)).byKind.game_commands.game_commands;
  assert.deepEqual([...cfg.panels].sort(), Object.keys(m.PANELS).sort(), 'the pack and the client agree on the screens');
});
