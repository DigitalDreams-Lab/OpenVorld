// A chat can switch brains. The old brain's session id must never be handed to the new one, and a lost session must not end the chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/vorld.mjs';
const { sessionFor, catchUp, SESSION_LOST } = await import('../engine/server/agents/runner.mjs');

test('a session is resumed only by the brain it came from', () => {
  const claude = { provider: 'claude-code' }, codex = { provider: 'codex' };
  const thread = { session_id: 'abc', session_provider: 'claude-code' };
  assert.equal(sessionFor(thread, claude, false), 'abc');
  assert.equal(sessionFor(thread, codex, false), null, 'Codex is never given a Claude Code session id');
  assert.equal(sessionFor({ session_id: 'old' }, codex, false), 'old', 'chats saved before the brain was recorded are tried (and fall back if it is gone)');
  assert.equal(sessionFor({}, codex, false), null);
  assert.equal(sessionFor(thread, claude, true), null, 'a party room keeps no session');
});

test('what Codex and others say when a session is gone is recognised', () => {
  for (const msg of ['thread/resume: thread/resume failed: no rollout found for thread id f7bdda5d-ea4d-4f59-a1ea-d15af65aa906 (code -32600)', 'No conversation found with session ID: 123', 'session abc not found']) assert.match(msg, SESSION_LOST, msg);
  for (const msg of ['rate limit reached', 'the model is overloaded', 'permission denied']) assert.doesNotMatch(msg, SESSION_LOST, msg);
});

test('a fresh brain is told the conversation so far, newest turns kept within the limit', () => {
  const turns = [{ role: 'user', content: 'make a report' }, { role: 'assistant', content: 'on it' }, { role: 'user', content: 'in an image please' }];
  const text = catchUp(turns);
  assert.match(text, /Founder: make a report\n\nYou: on it\n\nFounder: in an image please/);
  assert.match(text, /The founder's new message:\n$/);
  assert.equal(catchUp([]), '', 'a brand new chat needs no catch-up');
  const long = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: `message ${i} ${'x'.repeat(500)}` }));
  const cut = catchUp(long, 2000);
  assert.ok(cut.includes('message 49') && !cut.includes('message 0 '), 'the newest are kept, the oldest dropped');
});

// the same thing end to end, with a fake `codex` on PATH: resuming fails like the real one did, and the chat carries on
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeVorld } from './helpers/vorld.mjs';
const { runTurn } = await import('../engine/server/agents/runner.mjs');
const { createThread, appendEvent, getThread, readEvents } = await import('../engine/server/threads.mjs');

function fakeCodex(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-codex-')), log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh
echo "ARGS: $*" >> "${log}"
cat >> "${log}"
case "$*" in
  *"resume 01a1e148-new-session"*) echo '{"type":"thread.started","thread_id":"01a1e148-new-session"}'; echo '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"You are welcome."}}'; echo '{"type":"turn.completed"}';;
  *" resume "*) echo '{"type":"thread.started","thread_id":"x"}'; echo "Error: thread/resume: thread/resume failed: no rollout found for thread id f7bdda5d-ea4d-4f59-a1ea-d15af65aa906 (code -32600)" >&2; exit 1;;
  *) echo '{"type":"thread.started","thread_id":"01a1e148-new-session"}'; echo '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"Here is the image report."}}'; echo '{"type":"turn.completed"}';;
esac
`, { mode: 0o755 });
  const old = process.env.PATH; process.env.PATH = `${dir}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; fs.rmSync(dir, { recursive: true, force: true }); });
  return log;
}

test('a chat that switched to Codex starts a fresh session instead of failing, and is told the conversation so far', async (t) => {
  const log = fakeCodex(t);
  const ctx = makeVorld({ brain: { provider: 'codex' }, crew: [{ name: 'Stella', job: 'Analyzer', brain: { provider: 'codex' } }] });
  const stella = ctx.crew.find((c) => c.name === 'Stella').id;
  // a chat begun with Claude Code (its session id is stored, with no provider: like chats saved before it was recorded)
  const thread = createThread(ctx, { role: stella, kind: 'chat', bench: 'main', session_id: 'f7bdda5d-ea4d-4f59-a1ea-d15af65aa906' });
  appendEvent(ctx, thread.id, { type: 'founder.message', text: 'Stella create a report for me now' });
  appendEvent(ctx, thread.id, { type: 'agent.text', role: stella, text: 'Report written to report.md' });
  const emitted = [];
  const r = await runTurn(ctx, thread.id, 'create the latest report in a generated image', (m) => emitted.push(m));
  assert.equal(r.ok, true, r.error);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /ARGS: exec resume f7bdda5d/, 'the old id was tried first (an old chat has no provider recorded)');
  assert.match(calls, /Founder: Stella create a report for me now/, 'the fresh run was told what was said before');
  assert.match(calls, /create the latest report in a generated image/);
  const now = getThread(ctx, thread.id);
  assert.equal(now.session_id, '01a1e148-new-session'); assert.equal(now.session_provider, 'codex');
  assert.equal(readEvents(ctx, thread.id).some((e) => e.type === 'turn.error'), false, 'no error is shown');

  // next message: the new Codex session is resumed as normal, with no catch-up
  fs.writeFileSync(log, '');
  await runTurn(ctx, thread.id, 'thanks', () => {});
  const second = fs.readFileSync(log, 'utf8');
  assert.match(second, /ARGS: exec resume 01a1e148-new-session/);
  assert.doesNotMatch(second, /picking it up with a fresh mind/);
});

test('a chat recorded with another brain never offers its id to Codex', async (t) => {
  const log = fakeCodex(t);
  const ctx = makeVorld({ brain: { provider: 'codex' }, crew: [{ name: 'Stella', job: 'Analyzer', brain: { provider: 'codex' } }] });
  const stella = ctx.crew.find((c) => c.name === 'Stella').id;
  const thread = createThread(ctx, { role: stella, kind: 'chat', bench: 'main', session_id: 'claude-session', session_provider: 'claude-code' });
  appendEvent(ctx, thread.id, { type: 'founder.message', text: 'hello' });
  assert.equal((await runTurn(ctx, thread.id, 'again', () => {})).ok, true);
  const calls = fs.readFileSync(log, 'utf8');
  assert.doesNotMatch(calls, /resume/, 'no resume was attempted');
  assert.match(calls, /Founder: hello/);
});
