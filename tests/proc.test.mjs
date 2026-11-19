import test from 'node:test';
import assert from 'node:assert/strict';
import { runJsonLines, cleanEnv } from '../engine/server/agents/drivers/proc.mjs';

test('a CLI that closes stdin early can still return its JSON response', async () => {
  const lines = [];
  await runJsonLines({
    cmd: process.execPath,
    args: ['-e', "require('node:fs').closeSync(0); console.log(JSON.stringify({text:'Ready'}))"],
    stdin: 'x'.repeat(2 * 1024 * 1024),
    onLine: line => lines.push(line),
  });
  assert.deepEqual(lines, [{ text: 'Ready' }]);
});

test('a CLI that rejects input reports its own failure instead of EPIPE', async () => {
  await assert.rejects(runJsonLines({
    cmd: process.execPath,
    args: ['-e', "require('node:fs').closeSync(0); console.error('Provider rejected authentication'); process.exitCode = 1"],
    stdin: 'x'.repeat(2 * 1024 * 1024),
    onLine() {},
  }), /Provider rejected authentication/);
});

test('a brain process never inherits the launch token', () => {
  process.env.OV_TOKEN = 'the-launch-token';
  try { assert.equal(cleanEnv().OV_TOKEN, undefined); }
  finally { delete process.env.OV_TOKEN; }
});
