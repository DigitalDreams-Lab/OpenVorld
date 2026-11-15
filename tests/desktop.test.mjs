import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { dataHome, engineEnvironment, isAppUrl, isExternalUrl, readSettings, writeSettings } from '../desktop/runtime.mjs';
import { cleanEnv } from '../engine/server/agents/drivers/proc.mjs';

test('desktop data selection preserves browser data and explicit choices', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-desktop-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.openvorld-dev.json'), JSON.stringify({ home: '../existing-vorlds' }));
  const options = { env: {}, root, home: root };
  assert.equal(dataHome(options), path.join(root, '.openvorld'));
  assert.equal(dataHome({ ...options, development: true }), path.resolve(root, '../existing-vorlds'));
  assert.equal(dataHome({ ...options, settings: { home: root } }), root);
  assert.equal(dataHome({ ...options, env: { OPENVORLD_HOME: root }, settings: { home: '/ignored' } }), root);
  const file = path.join(root, 'prefs', 'desktop.json');
  assert.deepEqual(readSettings(file), {});
  writeSettings(file, { home: root, width: 1200 });
  assert.deepEqual(readSettings(file), { home: root, width: 1200 });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => readSettings(file), /Could not read desktop settings/);
});

test('desktop engine flags stay separate from normal agent subprocesses', t => {
  const env = engineEnvironment({ env: { OV_PORT: '4317', OV_DEV_HOSTS: 'outside.test', NODE_OPTIONS: '--inspect', NODE_PATH: '/outside', KEEP: 'yes' }, home: '/vorlds', token: 'secret', executable: '/OpenVorld', cliPath: '/bin' });
  assert.equal(env.OV_PORT, '0'); assert.equal(env.OV_TOKEN, 'secret');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(env.OPENVORLD_HOME, '/vorlds');
  assert.equal(env.KEEP, 'yes'); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.OV_DEV_HOSTS, undefined);
  const saved = { ...process.env };
  Object.assign(process.env, { ELECTRON_RUN_AS_NODE: '1', OV_NODE_EXECUTABLE: '/OpenVorld', OV_DESKTOP: '1' });
  t.after(() => { for (const key of ['ELECTRON_RUN_AS_NODE', 'OV_NODE_EXECUTABLE', 'OV_DESKTOP']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  const agent = cleanEnv();
  assert.equal(agent.ELECTRON_RUN_AS_NODE, undefined); assert.equal(agent.OV_NODE_EXECUTABLE, undefined); assert.equal(agent.OV_DESKTOP, undefined);
});

test('desktop navigation keeps system URLs and other local origins out of its window', () => {
  const origin = 'http://127.0.0.1:4317';
  assert.ok(isAppUrl(origin + '/api/boot', origin));
  for (const url of ['http://127.0.0.1:4318/', 'https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'not a URL']) assert.equal(isAppUrl(url, origin), false);
  assert.ok(isExternalUrl('https://example.com')); assert.ok(isExternalUrl('mailto:hello@example.com'));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'shell:AppsFolder', 'not a URL']) assert.equal(isExternalUrl(url), false);
});

test('desktop engine chooses a free port, authenticates it, and shuts down through IPC', { timeout: 20000 }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-desktop-engine-'));
  const child = fork(new URL('../engine/server/index.mjs', import.meta.url), [], {
    env: { ...process.env, OPENVORLD_HOME: home, OV_DESKTOP: '1', OV_PORT: '0', OV_TOKEN: 'desktop-test-token' },
    execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  t.after(() => { child.kill(); fs.rmSync(home, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Engine startup timed out: ${stderr}`)), 10000);
    child.on('message', message => { if (message?.type === 'desktop:ready') { clearTimeout(timer); resolve(message); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Engine exited: ${code}: ${stderr}`)); });
  });
  assert.ok(ready.port > 0);
  const url = `http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(url + '/api/boot')).status, 401);
  const response = await fetch(url + '/api/boot', { headers: { 'x-ov-token': 'desktop-test-token' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).home, home);
  const status = once(child, 'message'); child.send({ type: 'desktop:status' });
  assert.deepEqual((await status)[0], { type: 'desktop:status', active: 0 });
  const exited = once(child, 'exit'); child.send({ type: 'desktop:shutdown' });
  assert.equal((await exited)[0], 0);
});
