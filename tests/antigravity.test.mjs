// Antigravity as a CLI mind (`agy -p`): provider pack registration, command flags, stream-json event folding, and error reporting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readYaml } from '../tools/lib/packs.mjs';
import { argsFor, run } from '../engine/server/agents/drivers/antigravity.mjs';
import { home, makeVorld } from './helpers/vorld.mjs';
import { createThread, readEvents } from '../engine/server/threads.mjs';
import { runTurn } from '../engine/server/agents/runner.mjs';

const providers = readYaml('packs/core/providers.yaml');

test('antigravity is a configured CLI provider, headless with a sandbox and a resumable conversation', () => {
  assert.ok(providers.bin_dirs.includes('~/.gemini/bin'));
  const p = providers.providers.antigravity;
  assert.equal(p.label, 'Antigravity');
  assert.deepEqual(p.drivers.cli.detect, ['agy', '--version']);
  assert.equal(p.models.source, 'command');
  assert.deepEqual(p.models.command, ['agy', 'models']);

  assert.deepEqual(
    argsFor({ system: 'S', prompt: 'P', model: 'gemini-4-argon-medium' }),
    ['-p', 'S\n\n---\n\nP', '--output-format', 'stream-json', '--sandbox', '--model', 'gemini-4-argon-medium'],
  );
  assert.deepEqual(argsFor({ system: 'S', prompt: 'P', sessionId: 'c1' }), ['-p', 'P', '--output-format', 'stream-json', '--sandbox', '--conversation', 'c1']);
  assert.ok(!argsFor({ system: 'S', prompt: 'P' }).includes('--dangerously-skip-permissions'));
  assert.deepEqual(
    argsFor({ system: 'S', prompt: 'P', addDirs: ['/w'], writable: true }).slice(5, 9),
    ['--mode', 'accept-edits', '--add-dir', '/w'],
  );
});

test('the driver folds agy stream-json into deltas, tool steps and the conversation id', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'agy');
  const ev = (event, body) => ({ event, [event]: body });
  const lines = [
    ev('init', { cwd: '/x', conversation_id: 'conv-9' }),
    ev('step_update', {
      step_index: 1,
      state: 'RUNNING',
      step_type: 'tool',
      tool_call: { tool_name: 'read_file', arguments: '/a/b.txt' },
    }),
    ev('step_update', {
      step_index: 1,
      state: 'DONE',
      step_type: 'tool',
      tool_call: { tool_name: 'read_file', arguments: '/a/b.txt', result: 'hello' },
    }),
    ev('step_update', { step_index: 2, state: 'RUNNING', step_type: 'agent_response', text_delta: 'Hi ' }),
    ev('step_update', { step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'there' }),
    ev('result', { status: 'SUCCESS', conversation_id: 'conv-9', response: 'Hi there' }),
  ];
  fs.writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${lines.map((l) => JSON.stringify(l)).join('\n')}\nEOF\n`, { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  const events = [];
  const r = await run({ system: 's', prompt: 'p', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'Hi there');
  assert.equal(r.sessionId, 'conv-9');
  assert.deepEqual(events.map((e) => e.type), ['tool', 'tool_result', 'delta', 'delta']);
  assert.equal(events[0].name, 'read_file');
  assert.equal(events[0].kind, 'tool.read');
  assert.equal(events[0].target, '/a/b.txt');
  assert.equal(events[1].ok, true);
  assert.equal(events[1].output, 'hello');
});

test('a failed agy run throws an error when no response text was emitted', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-err-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'agy'),
    `#!/bin/sh\necho '{"event":"result","result":{"status":"ERROR","error":"authentication required"}}'\n`,
    { mode: 0o755 },
  );
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  await assert.rejects(run({ system: 's', prompt: 'p', cwd: dir, onEvent() {} }), /authentication required/);
});

test('runner dispatches antigravity crew members and persists the conversation id', async (t) => {
  const bin = path.join(home, 'agy-bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(bin, 'args.json');
  const script = `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ event: 'init', init: { conversation_id: 'agy-conv-1' } }));\nconsole.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', conversation_id: 'agy-conv-1', response: 'Ready.' } }));\n`;
  fs.writeFileSync(path.join(bin, 'agy'), script, { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  const ctx = makeVorld({ name: 'Antigravity Dispatch', brain: { provider: 'antigravity', model: 'gemini-4-argon-medium' } });
  const thread = createThread(ctx, { role: ctx.companionId });
  const r = await runTurn(ctx, thread.id, 'Hello Antigravity', () => {});
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, 'agy-conv-1');
  const args = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(args.includes('gemini-4-argon-medium'));
  assert.ok(args.includes('--settings'), 'runner passes session settings to allow ov_browser MCP tools');
  assert.ok(args.includes('--add-dir'), 'runner adds the temporary MCP config dir');
  const events = readEvents(ctx, thread.id);
  assert.equal(events.find((e) => e.type === 'agent.text')?.text, 'Ready.');
});

test('antigravity attaches ov_browser via a private temp MCP config and session allow-rule, then cleans it up', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'agy');
  const out = path.join(dir, 'seen.json');
  const ev = (event, body) => ({ event, [event]: body });
  const stream = [
    ev('init', { cwd: dir, conversation_id: 'conv-mcp' }),
    ev('step_update', {
      step_index: 4,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'ov_browser', ToolName: 'browser_open', Arguments: { url: 'https://example.com' } } },
    }),
    ev('step_update', {
      step_index: 4,
      state: 'DONE',
      step_type: 'tool',
      tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'ov_browser', ToolName: 'browser_open', Arguments: { url: 'https://example.com' } }, output: 'Example Domain' },
    }),
    ev('step_update', {
      step_index: 5,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'ov_browser', ToolName: 'browser_click', Arguments: { id: 3 } } },
    }),
    ev('step_update', {
      step_index: 5,
      state: 'ERROR',
      step_type: 'tool',
      tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'ov_browser', ToolName: 'browser_click', Arguments: { id: 3 } }, error: { type: 'TOOL_ERROR', message: 'not found' } },
    }),
    ev('result', { status: 'SUCCESS', conversation_id: 'conv-mcp', response: 'Opened.' }),
  ];
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const addDirs = [];
for (let i = 0; i < a.length; i++) if (a[i] === '--add-dir') addDirs.push(a[i + 1]);
const mcpDir = addDirs.at(-1);
const mcpFile = path.join(mcpDir, '.agents', 'mcp_config.json');
const settingsFile = a[a.indexOf('--settings') + 1];
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({
  args: a,
  mcpDir,
  mcpConfig: JSON.parse(fs.readFileSync(mcpFile, 'utf8')),
  mcpMode: fs.statSync(mcpFile).mode & 0o777,
  settings: JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
  settingsMode: fs.statSync(settingsFile).mode & 0o777,
  secret: process.env.YT_TOKEN,
}));
for (const line of ${JSON.stringify(stream)}) console.log(JSON.stringify(line));
`, { mode: 0o755 });

  const mcp = { name: 'ov_browser', command: process.execPath, args: ['/app/browser-mcp.mjs'], env: { OV_URL: 'http://127.0.0.1:4317', OV_TOKEN: 'tok', OV_TOOLS: 'browser_open,recall' } };
  const events = [];
  const r = await run({ bin, system: 'S', prompt: 'P', cwd: dir, mcp, env: { YT_TOKEN: 'sec-1' }, onEvent: (e) => events.push(e) });

  assert.equal(r.text, 'Opened.');
  const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(!seen.args.includes('--dangerously-skip-permissions'));
  assert.deepEqual(seen.mcpConfig.mcpServers.ov_browser, { command: mcp.command, args: mcp.args, env: mcp.env });
  assert.equal(seen.mcpMode, 0o600);
  assert.deepEqual(seen.settings, { permissions: { allow: ['mcp(ov_browser/*)'] } });
  assert.equal(seen.settingsMode, 0o600);
  assert.equal(seen.secret, 'sec-1');
  assert.equal(fs.existsSync(seen.mcpDir), false, 'temp MCP config dir is removed after the turn');

  assert.deepEqual(events.map((e) => [e.type, e.name, e.kind ?? e.ok, e.target]), [
    ['tool', 'ov_browser.browser_open', 'tool.web', 'https://example.com'],
    ['tool_result', 'ov_browser.browser_open', true, 'https://example.com'],
    ['tool', 'ov_browser.browser_click', 'tool.web', '#3'],
    ['tool_result', 'ov_browser.browser_click', false, '#3'],
  ]);
  assert.equal(events[1].output, 'Example Domain');
  assert.equal(events[3].output, 'not found');
});
