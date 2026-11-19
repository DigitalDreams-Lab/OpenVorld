// OpenCode as a CLI mind (`opencode run --format json`): pack registration, OPENCODE_PERMISSION mapping, event folding, and writ requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readYaml } from '../tools/lib/packs.mjs';
import { argsFor, permissionsFor, mcpConfigFor, deniedAccess, run } from '../engine/server/agents/drivers/opencode.mjs';
import { home, makeVorld } from './helpers/vorld.mjs';
import { createThread, readEvents } from '../engine/server/threads.mjs';
import { grant } from '../engine/server/gate.mjs';
import { runTurn } from '../engine/server/agents/runner.mjs';

const providers = readYaml('packs/core/providers.yaml');

test('opencode is configured in providers.yaml and builds headless args and OPENCODE_PERMISSION rules', () => {
  assert.ok(providers.bin_dirs.includes('~/.opencode/bin'));
  const p = providers.providers.opencode;
  assert.equal(p.label, 'OpenCode');
  assert.deepEqual(p.drivers.cli.detect, ['opencode', '--version']);
  assert.equal(p.models.source, 'command');
  assert.deepEqual(p.models.command, ['opencode', 'models']);

  assert.deepEqual(argsFor({ model: 'opencode/big-pickle' }), ['run', '--format', 'json', '--thinking', '-m', 'opencode/big-pickle']);
  assert.deepEqual(
    argsFor({ sessionId: 'ses_1', model: 'm', images: [{ path: '/tmp/a.png' }] }),
    ['run', '--format', 'json', '--thinking', '-s', 'ses_1', '-m', 'm', '-f', '/tmp/a.png'],
  );

  const ro = permissionsFor({});
  assert.equal(ro.edit, 'deny');
  assert.equal(ro.bash, 'deny');
  assert.equal(ro.webfetch, 'deny');
  assert.equal(ro.websearch, 'deny');
  assert.deepEqual(ro.external_directory, { '*': 'deny' });

  const rw = permissionsFor({ addDirs: ['/shared/docs'], writable: true, cmdAllow: ['npm test', 'git status *'], web: true });
  assert.equal(rw.edit, 'allow');
  assert.deepEqual(rw.bash, { '*': 'deny', 'npm test': 'allow', 'git status *': 'allow', 'git status': 'allow' });
  assert.equal(rw.webfetch, 'allow');
  assert.equal(rw.websearch, 'allow');
  assert.deepEqual(rw.external_directory, { '*': 'deny', '/shared/docs/*': 'allow' });

  assert.deepEqual(deniedAccess('read', { filePath: '/ext/secret/file.txt' }, '/cwd'), {
    capability: 'fs.read', scope: '/ext/secret', why: 'read /ext/secret/file.txt',
  });
  assert.deepEqual(deniedAccess('bash', { command: 'curl -H "Authorization: Bearer secret123" https://api.example.com' }, '/cwd'), {
    capability: 'cmd.run', scope: 'curl *', why: 'run a command: curl -H "Authorization: Bearer •••" https://api.example.com',
  });
});

test('the driver folds opencode JSON events into deltas, thinking, tools, plan, cost, and writ requests', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'opencode');
  const lines = [
    { type: 'step_start', sessionID: 'ses_99', part: { type: 'step-start' } },
    { type: 'reasoning', sessionID: 'ses_99', part: { type: 'reasoning', text: 'Checking files' } },
    {
      type: 'tool_use',
      sessionID: 'ses_99',
      part: {
        id: 'prt_1',
        callID: 'call_1',
        tool: 'read',
        state: { status: 'completed', input: { filePath: '/a/b.txt' }, output: 'hello world' },
      },
    },
    {
      type: 'tool_use',
      sessionID: 'ses_99',
      part: {
        id: 'prt_2',
        callID: 'call_2',
        tool: 'bash',
        state: {
          status: 'error',
          input: { command: 'npm test', description: 'Run suite' },
          error: 'The user rejected permission because you specified a rule to deny bash',
        },
      },
    },
    {
      type: 'tool_use',
      sessionID: 'ses_99',
      part: {
        id: 'prt_3',
        callID: 'call_3',
        tool: 'todowrite',
        state: { status: 'completed', input: { todos: [{ content: 'Finish driver', status: 'completed' }] }, output: '' },
      },
    },
    { type: 'text', sessionID: 'ses_99', part: { type: 'text', text: 'Done!' } },
    { type: 'step_finish', sessionID: 'ses_99', part: { type: 'step-finish', reason: 'stop', cost: 0.012 } },
  ];
  fs.writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${lines.map((l) => JSON.stringify(l)).join('\n')}\nEOF\n`, { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  const events = [];
  const r = await run({ system: 's', prompt: 'p', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'Done!');
  assert.equal(r.sessionId, 'ses_99');
  assert.equal(r.cost, 0.012);
  assert.deepEqual(events.map((e) => e.type), ['thinking', 'tool', 'tool_result', 'tool', 'tool_result', 'access', 'plan', 'delta']);
  assert.equal(events[1].kind, 'tool.read');
  assert.equal(events[1].target, '/a/b.txt');
  assert.equal(events[2].ok, true);
  assert.equal(events[4].ok, false);
  assert.equal(events[5].capability, 'cmd.run');
  assert.equal(events[5].scope, 'npm test');
  assert.deepEqual(events[6].items, [{ text: 'Finish driver', status: 'completed' }]);
});

test('a failed opencode run throws an error when no response text was emitted', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-err-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'opencode'),
    `#!/bin/sh\necho '{"type":"error","sessionID":"ses_e","error":{"name":"ProviderAuthError","data":{"message":"missing api key"}}}'\n`,
    { mode: 0o755 },
  );
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  await assert.rejects(run({ system: 's', prompt: 'p', cwd: dir, onEvent() {} }), /missing api key/);
});

test('runner dispatches opencode crew members with OPENCODE_PERMISSION and persists sessionID', async (t) => {
  const bin = path.join(home, 'opencode-bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(bin, 'call.json');
  const script = `#!${process.execPath}
import fs from 'node:fs';
let stdin = '';
for await (const c of process.stdin) stdin += c;
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({
  args: process.argv.slice(2),
  perm: JSON.parse(process.env.OPENCODE_PERMISSION || '{}'),
  cfg: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}'),
  stdin,
}));
console.log(JSON.stringify({ type: 'text', sessionID: 'ses_dispatch_1', part: { type: 'text', text: 'Ready via OpenCode.' } }));
`;
  fs.writeFileSync(path.join(bin, 'opencode'), script, { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${old}`;
  t.after(() => { process.env.PATH = old; });

  const ctx = makeVorld({ name: 'OpenCode Dispatch', brain: { provider: 'opencode', model: 'opencode/big-pickle' } });
  grant(ctx, { role: ctx.companionId, capability: 'cmd.run', scope: 'npm test' });
  const thread = createThread(ctx, { role: ctx.companionId });
  const r = await runTurn(ctx, thread.id, 'Hello OpenCode', () => {});
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, 'ses_dispatch_1');
  const logged = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.deepEqual(logged.args, ['run', '--format', 'json', '--thinking', '-m', 'opencode/big-pickle']);
  assert.equal(logged.perm.bash['npm test'], 'allow');
  assert.equal(logged.perm.edit, 'deny');
  assert.equal(logged.perm['ov_browser_*'], 'allow');
  assert.equal(logged.cfg.mcp?.ov_browser?.type, 'local');
  assert.equal(logged.cfg.mcp?.ov_browser?.enabled, true);
  assert.ok(Array.isArray(logged.cfg.mcp?.ov_browser?.command) && logged.cfg.mcp.ov_browser.command.some((a) => a.endsWith('browser-mcp.mjs')));
  assert.equal(mcpConfigFor(null), null);
  const events = readEvents(ctx, thread.id);
  assert.equal(events.find((e) => e.type === 'agent.text')?.text, 'Ready via OpenCode.');
});
