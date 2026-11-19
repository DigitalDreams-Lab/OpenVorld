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
// a stand-in harness that reports what it was given: the browser instructions in its prompt and the bridge's config file in its environment
const seeing = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({ told: s.includes('private web browser'), config: !!process.env.OV_MCP_CONFIG })))`;
process.env.OV_CHROME = process.execPath;      // a browser is "installed", so the crew browser's instructions are in play
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
  quiet-brain:
    label: Quiet Harness
    drivers: { command: { detect: ["${node}", "--version"], run: ["${node}", "-e", ${JSON.stringify(seeing)}, "--"] } }
  tooled-brain:
    label: Tooled Harness
    drivers: { command: { detect: ["${node}", "--version"], run: ["${node}", "-e", ${JSON.stringify(seeing)}, "--"], mcp_args: ["--mcp-config", "{mcp_config}"] } }
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

test('the command driver fills {model}, {cwd} and {mcp_config}, and adds model_args/mcp_args only when present', () => {
  const spec = { run: ['tool', '--in={cwd}'], model_args: ['-m', '{model}'], mcp_args: ['--mcp-config', '{mcp_config}'] };
  assert.deepEqual(commandFor(spec, { cwd: '/w' }), { cmd: 'tool', args: ['--in=/w'] });
  assert.deepEqual(commandFor(spec, { cwd: '/w', model: 'big' }), { cmd: 'tool', args: ['--in=/w', '-m', 'big'] });
  assert.deepEqual(commandFor(spec, { cwd: '/w', model: 'big', mcpConfig: '/tmp/mcp.json' }), { cmd: 'tool', args: ['--in=/w', '-m', 'big', '--mcp-config', '/tmp/mcp.json'] });
  assert.throws(() => commandFor({}, {}), /no "run" command/);
});

test('a third-party command brain receives ov_browser via mcp_args and OV_MCP_CONFIG, then cleans up the temp file', { skip: process.platform === 'win32' }, async () => {
  const { run } = await import('../engine/server/agents/drivers/command.mjs');
  const out = path.join(home, 'cmd-mcp-seen.json');
  const inspector = `const fs=require('fs');const a=process.argv.slice(2);const f=a[a.indexOf('--mcp-config')+1];fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({args:a,file:f,envFile:process.env.OV_MCP_CONFIG,url:process.env.OV_URL,secret:process.env.MY_KEY,cfg:JSON.parse(fs.readFileSync(f,'utf8')),mode:fs.statSync(f).mode&0o777}));console.log('ok');`;
  const mcp = { name: 'ov_browser', command: process.execPath, args: ['/app/browser-mcp.mjs'], env: { OV_URL: 'http://127.0.0.1:4317', OV_TOKEN: 't1', OV_TOOLS: 'browser_open,recall' } };
  const r = await run({
    spec: { run: [process.execPath, '-e', inspector, '--'], mcp_args: ['--mcp-config', '{mcp_config}'] },
    system: 'S', prompt: 'P', cwd: home, mcp, env: { MY_KEY: 'k1' }, onEvent: () => {},
  });
  assert.equal(r.text.trim(), 'ok');
  const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(seen.file, seen.envFile);
  assert.equal(seen.url, 'http://127.0.0.1:4317');
  assert.equal(seen.secret, 'k1');
  assert.equal(seen.mode, 0o600);
  assert.deepEqual(seen.cfg.mcpServers.ov_browser, { command: mcp.command, args: mcp.args, env: mcp.env });
  assert.equal(fs.existsSync(seen.file), false, 'temp MCP config file is removed after the turn');
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

test('a command harness is told about the crew browser, and given the bridge, only when its pack asks for tools (mcp_args)', async () => {
  const seen = async (provider) => {
    const ctx = makeVorld({ crew: [{ name: 'Di', job: 'Checker', brain: { provider } }] });
    const di = ctx.crew.find((c) => c.role === 'agent').id;
    const r = await runTurn(ctx, createThread(ctx, { role: di }).id, 'hello', () => {});
    assert.equal(r.ok, true, r.error);
    return JSON.parse(r.shown);
  };
  assert.deepEqual(await seen('quiet-brain'), { told: false, config: false }, 'no tools asked for: nothing promised, no bridge config handed over');
  assert.deepEqual(await seen('tooled-brain'), { told: true, config: true });
});
