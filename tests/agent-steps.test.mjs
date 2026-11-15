// Agent turns: one transcript shape for every brain, engine-run tools for API brains bounded by writs,
// and the OpenAI-compatible tool loop (mocked HTTP, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPacks, packRoots } from '../tools/lib/packs.mjs';
import { home, makeVorld, saveVorld } from './helpers/vorld.mjs';

const { engineTools, argvOf } = await import('../engine/server/agents/tools.mjs');
const { Transcript } = await import('../engine/server/agents/steps.mjs');
const openai = await import('../engine/server/agents/drivers/openai.mjs');
const { createThread, readEvents } = await import('../engine/server/threads.mjs');
const { runTurn } = await import('../engine/server/agents/runner.mjs');

const packs = loadPacks(packRoots(home));
const fakeCtx = (dir) => ({ dir, packs });

/** A streamed chat/completions response (SSE) from a list of delta objects. */
function sse(deltas) {
  const body = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('engine tools stay inside writs: roots, never-lists, exact command patterns, no shell features', async () => {
  const vorld = fs.mkdtempSync(path.join(home, 'vorld-'));
  const ws = path.join(vorld, 'workspaces', 'scribe'); fs.mkdirSync(ws, { recursive: true });
  const project = fs.mkdtempSync(path.join(home, 'project-'));
  fs.writeFileSync(path.join(project, 'notes.md'), 'hello\nvorld\n');
  fs.writeFileSync(path.join(project, '.env'), 'SECRET=1');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-outside-'));
  fs.writeFileSync(path.join(outside, 'x.txt'), 'nope');
  const read = engineTools({ ctx: fakeCtx(vorld), role: 'scribe', cwd: ws, readRoots: [project] });
  assert.ok(!read.specs.some((s) => s.function.name === 'run_command' || s.function.name === 'fetch_url'), 'no command or web tools without those writs');
  assert.match((await read.run('read_file', { path: path.join(project, 'notes.md') })).output, /1 {2}hello/);
  assert.equal((await read.run('read_file', { path: path.join(outside, 'x.txt') })).ok, false, 'outside the writs');
  assert.equal((await read.run('read_file', { path: path.join(project, '.env') })).ok, false, 'never-list');
  assert.equal((await read.run('read_file', { path: '../../../' + path.basename(outside) })).ok, false, 'no escaping with ..');
  assert.equal((await read.run('write_file', { path: path.join(project, 'a.txt'), content: 'x' })).ok, false, 'a read writ is not a write writ');
  assert.equal((await read.run('write_file', { path: 'scratch.txt', content: 'x' })).ok, true, 'the private workspace is always writable');
  assert.equal((await read.run('run_command', { command: 'echo hi' })).ok, false, 'tools not offered are refused');
  fs.symlinkSync(outside, path.join(project, 'link'));
  assert.equal((await read.run('read_file', { path: path.join(project, 'link', 'x.txt') })).ok, false, 'symlinks cannot lead outside');
  assert.match((await read.run('search', { pattern: 'vor', path: project })).output, /notes\.md:2: vorld/);

  const work = engineTools({ ctx: fakeCtx(vorld), role: 'scribe', cwd: ws, writeRoots: [project], commands: ['echo *'] });
  assert.ok(work.specs.some((s) => s.function.name === 'edit_file') && work.specs.some((s) => s.function.name === 'run_command'));
  assert.equal((await work.run('write_file', { path: 'draft.md', content: 'one two' })).ok, true, 'own workspace is writable');
  assert.equal((await work.run('edit_file', { path: path.join(project, 'notes.md'), old_string: 'vorld', new_string: 'there' })).ok, true);
  assert.equal(fs.readFileSync(path.join(project, 'notes.md'), 'utf8'), 'hello\nthere\n');
  assert.equal((await work.run('edit_file', { path: path.join(project, 'notes.md'), old_string: 'absent', new_string: 'x' })).ok, false);
  const echo = await work.run('run_command', { command: 'echo "a b"' });
  assert.equal(echo.ok, true); assert.match(echo.output, /^a b/);
  assert.equal((await work.run('run_command', { command: 'echo hi; cat /etc/passwd' })).ok, false, 'no shell chaining');
  assert.equal((await work.run('run_command', { command: 'ls /' })).ok, false, 'only granted command patterns');
  assert.deepEqual(argvOf(`git commit -m 'two words'`), ['git', 'commit', '-m', 'two words']);
  const audit = fs.readFileSync(path.join(vorld, 'audit.log'), 'utf8');
  assert.match(audit, /"tool":"run_command".*"ok":false/);
  fs.rmSync(outside, { recursive: true, force: true });
});

test('the transcript keeps order, joins streamed text, pairs results by id and strips the reply envelope', () => {
  const tr = new Transcript({ output_chars: 10 });
  tr.text('Let me '); tr.text('look.'); tr.thinking('hmm');
  tr.tool({ id: 'a', kind: 'tool.read', name: 'Read', target: 'x' });
  tr.tool({ id: 'b', kind: 'tool.run', name: 'Bash', target: 'npm test' });
  tr.result({ id: 'b', ok: false, output: '0123456789abcdef' });
  tr.result({ id: 'a', ok: true, output: 'ok' });
  tr.plan([{ text: 'one', status: 'completed' }]);
  tr.text('Done.\n```ov\n{"options":["x"]}\n```');
  const steps = tr.final((t) => t.replace(/```ov[\s\S]*$/, ''));
  assert.deepEqual(steps.map((s) => s.t), ['text', 'thinking', 'tool', 'tool', 'plan', 'text']);
  assert.equal(steps[0].text, 'Let me look.');
  assert.equal(steps[2].status, 'ok'); assert.equal(steps[3].status, 'error');
  assert.match(steps[3].output, /^0123456789\n… \(6 more/);
  assert.equal(steps[5].text, 'Done.');
});

test('API brains run a tool loop: stream text, call a tool, read the result, answer', async (t) => {
  const ws = fs.mkdtempSync(path.join(home, 'ws-'));
  const tools = engineTools({ ctx: fakeCtx(ws), role: 'x', cwd: ws, writeRoots: [ws] });
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) return sse([{ content: 'Writing it down.' }, { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"plan.md",' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"content":"# Plan"}' } }] }]);
    return sse([{ reasoning: 'saved' }, { content: 'Saved **plan.md**.' }]);
  });
  const events = [];
  const r = await openai.run({ system: 's', prompt: 'make a plan', model: 'm', cfg: { base_url: 'http://local.test/v1' }, tools, onEvent: (e) => events.push(e) });
  assert.equal(fs.readFileSync(path.join(ws, 'plan.md'), 'utf8'), '# Plan');
  assert.deepEqual(events.map((e) => e.type), ['delta', 'tool', 'tool_result', 'thinking', 'delta', 'delta']);
  assert.equal(events[1].kind, 'tool.write'); assert.equal(events[1].detail.write, '# Plan');
  assert.ok(bodies[0].tools.some((s) => s.function.name === 'write_file'), 'tools are offered');
  assert.equal(bodies[1].messages.at(-1).role, 'tool'); assert.equal(bodies[1].messages.at(-1).tool_call_id, 'c1');
  assert.equal(r.text, 'Writing it down.\n\nSaved **plan.md**.');
});

test('a model that cannot call tools still answers (tools dropped once)', async (t) => {
  const ws = fs.mkdtempSync(path.join(home, 'ws-'));
  const tools = engineTools({ ctx: fakeCtx(ws), role: 'x', cwd: ws });
  let n = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    n++;
    if (JSON.parse(init.body).tools) return new Response('{"error":"tools are not supported by this model"}', { status: 400 });
    return sse([{ content: 'Hello.' }]);
  });
  const r = await openai.run({ system: 's', prompt: 'hi', model: 'tiny', cfg: { base_url: 'http://local.test/no-tools' }, tools, onEvent: () => {} });
  assert.equal(r.text, 'Hello.'); assert.equal(n, 2);
});

test('the runner stores each turn as ordered steps and streams them as events', async (t) => {
  let ctx = makeVorld({ brain: { provider: 'openai-compatible', model: 'm', name: 'local' } });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', name: 'local', base_url: 'http://local.test/v1' }]; });
  const role = ctx.companionId;
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => (++call === 1
    ? sse([{ content: 'Let me note that.' }, { tool_calls: [{ index: 0, id: 'w1', function: { name: 'write_file', arguments: '{"path":"note.md","content":"tea"}' } }] }])
    : sse([{ content: 'Noted.\n```ov\n{"options":["Thanks"],"mood":"happy"}\n```' }])));
  const thread = createThread(ctx, { role });
  const sent = [];
  await runTurn(ctx, thread.id, 'remember tea', (e) => sent.push(e));
  const kinds = sent.filter((e) => e.type === 'thread.event').map((e) => e.ev.type);
  assert.deepEqual(kinds.filter((k) => k !== 'delta'), ['turn.start', 'tool', 'tool_result', 'turn.done']);
  const reply = readEvents(ctx, thread.id).find((e) => e.type === 'agent.text');
  assert.deepEqual(reply.steps.map((s) => s.t), ['text', 'tool', 'text']);
  assert.equal(reply.steps[1].status, 'ok'); assert.equal(reply.steps[2].text, 'Noted.');
  assert.deepEqual(reply.meta.options, ['Thanks']);
  assert.equal(fs.readFileSync(path.join(ctx.dir, 'workspaces', role, 'note.md'), 'utf8'), 'tea', 'the private workspace is always writable');
});
