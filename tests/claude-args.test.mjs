// Claude Code's command line: no argument may hold a newline (on Windows an npm-installed CLI is a .cmd launcher, and cmd.exe cuts
// the command line at the first newline, which dropped --allowedTools and left a member refused its own tools).
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { argsFor, run } = await import('../engine/server/agents/drivers/claude.mjs');

const SYSTEM = 'You are Ada.\n\nYour writs:\n- fs.read /project\n\nYou have a browser: browser_open ...';
const mcp = { name: 'ov_browser', command: 'C:\\Program Files\\OpenVorld\\OpenVorld.exe', args: ['C:\\app\\browser-mcp.mjs'], env: { OV_URL: 'http://127.0.0.1:4317', OV_TOOLS: 'browser_open,recall' } };

test('no argument holds a newline, and the system prompt and the tool permissions both arrive', () => {
  const args = argsFor({ systemFile: '/tmp/ov/system.md', sid: 's1', first: true, tools: ['Read', 'Grep'], allowed: ['Read', 'Grep', 'mcp__ov_browser'], addDirs: ['/project'], mcp, model: 'sonnet' });
  assert.ok(args.every((a) => !/[\r\n]/.test(a)), 'cmd.exe would cut the command line at a newline');
  assert.equal(args[args.indexOf('--system-prompt-file') + 1], '/tmp/ov/system.md');
  assert.ok(!args.includes('--system-prompt'));
  assert.deepEqual(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 4), ['--allowedTools', 'Read', 'Grep', 'mcp__ov_browser']);
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.ov_browser.args, mcp.args);
  assert.deepEqual(args.slice(-2), ['--session-id', 's1']);
  assert.deepEqual(argsFor({ systemFile: 'f', sid: 's2', first: false }).slice(-2), ['--resume', 's2']);
});

test('the CLI reads the system prompt from a private file that is removed when the turn ends', { skip: process.platform === 'win32' }, async () => {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ov-fake-claude-')), 'claude');
  const out = `${bin}.json`;
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2); const f = a[a.indexOf('--system-prompt-file') + 1];
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: a, file: f, system: fs.readFileSync(f, 'utf8'), mode: fs.statSync(f).mode & 0o777 }));
console.log(JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0 }));
`, { mode: 0o755 });
  const r = await run({ bin, system: SYSTEM, prompt: 'hi', tools: ['Read'], allowed: ['mcp__ov_browser'], mcp, onEvent: () => {} });
  assert.equal(r.text, 'ok');
  const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(seen.system, SYSTEM, 'the whole multi-line prompt reaches the CLI');
  assert.equal(seen.mode, 0o600);
  assert.ok(seen.args.every((a) => !/[\r\n]/.test(a)));
  assert.ok(seen.args.includes('--allowedTools'));
  assert.equal(fs.existsSync(seen.file), false, 'nothing is left in the temp folder');
});
