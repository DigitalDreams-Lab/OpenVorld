// Brains a pack adds: any agent CLI or harness through the generic command driver, a known CLI found at a full path, and the
// message the founder copies to an AI that was not found (no network; the "harness" is a tiny Node script).
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { home, makeVorld } from './helpers/vorld.mjs';

const node = process.execPath.split(path.sep).join('/');
// a stand-in harness: reads the prompt on its input and answers with the founder's last line and a note to remember
const harness = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const last=s.trim().split('\\n').pop();console.log('Got: '+last+'\\n\`\`\`ov\\n'+JSON.stringify({remember:['Founder says '+last]})+'\\n\`\`\`')})`;
fs.mkdirSync(path.join(home, 'packs'), { recursive: true });
fs.writeFileSync(path.join(home, 'packs', 'my-brain.yaml'), `kind: providers
version: 1
providers:
  echo-brain:
    label: Echo Harness
    drivers:
      command:
        detect: ["${node}", "--version"]
        run: ["${node}", "-e", ${JSON.stringify(harness)}]
        model_args: ["--model={model}"]
  codex:
    drivers: { cli: { detect: ["${node}", "--version"] } }
`);

const V = await import('../engine/server/vorld.mjs');
const { brainOf, runTurn } = await import('../engine/server/agents/runner.mjs');
const { commandFor } = await import('../engine/server/agents/drivers/command.mjs');
const { createThread } = await import('../engine/server/threads.mjs');
const M = await import('../engine/server/memory.mjs');

test('a brain added in a user pack is found, with any driver that has a detect command', () => {
  const found = V.detected(true).map((d) => d.id);
  assert.ok(found.includes('echo-brain'), 'the generic command driver');
  assert.ok(found.includes('codex'), 'a known CLI found at a full path');
});

test('a known CLI runs the command its pack names, so a full path works when it is not on the PATH', () => {
  const ctx = makeVorld({ crew: [{ name: 'Ada', job: 'Writer', brain: { provider: 'codex' } }] });
  const ada = ctx.crew.find((c) => c.role === 'agent').id;
  assert.equal(brainOf(ctx, ada).bin, node);
});

test('the command driver fills {model} and {cwd}, and adds model_args only when a model is picked', () => {
  const spec = { run: ['tool', '--in={cwd}'], model_args: ['-m', '{model}'] };
  assert.deepEqual(commandFor(spec, { cwd: '/w' }), { cmd: 'tool', args: ['--in=/w'] });
  assert.deepEqual(commandFor(spec, { cwd: '/w', model: 'big' }), { cmd: 'tool', args: ['--in=/w', '-m', 'big'] });
  assert.throws(() => commandFor({}, {}), /no "run" command/);
});

test('a harness brain answers a turn: the prompt goes in, its output is the reply, and its ov block works', async () => {
  const ctx = makeVorld({ crew: [{ name: 'Bo', job: 'Editor', brain: { provider: 'echo-brain' } }] });
  const bo = ctx.crew.find((c) => c.role === 'agent').id;
  const r = await runTurn(ctx, createThread(ctx, { role: bo }).id, 'ship on Friday', () => {});
  assert.equal(r.ok, true, r.error);
  assert.equal(r.shown, 'Got: ship on Friday');
  assert.deepEqual(r.meta.noted, ['Founder says ship on Friday']);
  assert.deepEqual(M.notes(ctx, bo).map((n) => n.text), ['Founder says ship on Friday']);
});

test('the add-yourself message names this computer, the user pack folder and the brains OpenVorld knows', () => {
  const text = V.addYourselfMessage();
  assert.ok(text.includes(`${path.join(home, 'packs').split(path.sep).join('/')}/my-brain.yaml`));
  assert.match(text, /antigravity: Antigravity, looks for "agy"/);
  assert.match(text, /Echo Harness/, 'brains found now');
  assert.match(text, /"--model", "\{model\}"/, 'placeholders meant for the pack stay as they are');
  assert.doesNotMatch(text, /\{(platform|packs_dir|found|known)\}/);
});
