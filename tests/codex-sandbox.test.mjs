// A resumed Codex session has no -s / --add-dir, so the writs must reach it as config overrides on every turn
// (a write writ granted after the chat began used to be ignored: "the session still enforces read-only access").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as codex from '../engine/server/agents/drivers/codex.mjs';

test('Codex gets the sandbox from the writs on new AND resumed sessions', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-codex-sandbox-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const oldPath = process.env.PATH, log = path.join(dir, 'log.json');
  process.env.PATH = dir + path.delimiter + oldPath; process.env.OV_CODEX_LOG = log;
  t.after(() => { process.env.PATH = oldPath; delete process.env.OV_CODEX_LOG; });
  fs.writeFileSync(path.join(dir, 'codex'), `#!${process.execPath}\nimport fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;fs.writeFileSync(process.env.OV_CODEX_LOG,JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'thread.started',thread_id:'s'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'ok'}}));`, { mode: 0o700 });
  const args = async (o) => { await codex.run({ system: 's', prompt: 'p', cwd: dir, onEvent() {}, ...o }); return JSON.parse(fs.readFileSync(log, 'utf8')); };
  const mode = (a) => a.filter((x, i) => a[i - 1] === '-c' && x.startsWith('sandbox_mode='))[0];

  // new session: the flags, as before
  const fresh = await args({ writable: true, addDirs: ['/a b'] });
  assert.ok(fresh.includes('-s') && fresh[fresh.indexOf('-s') + 1] === 'workspace-write' && fresh.includes('--add-dir'));
  // resumed session: the same settings as overrides
  const writable = await args({ sessionId: 'old', writable: true, addDirs: ['/other dir'] });
  assert.equal(writable[1], 'resume');
  assert.equal(mode(writable), 'sandbox_mode="workspace-write"');
  assert.ok(writable.includes('sandbox_workspace_write.writable_roots=["/other dir"]'));
  const readOnly = await args({ sessionId: 'old', writable: false, addDirs: ['/other dir'] });
  assert.equal(mode(readOnly), 'sandbox_mode="read-only"', 'a revoked writ closes it again, whatever the session started with');
  assert.ok(!readOnly.some((x) => x.startsWith('sandbox_workspace_write')), 'no extra writable folders when read-only');
});

test('a write writ for a folder that is not the working folder still opens the sandbox', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-codex-grant-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const oldPath = process.env.PATH, log = path.join(dir, 'log.json'), other = '/Users/x/Project crew';
  process.env.PATH = dir + path.delimiter + oldPath; process.env.OV_CODEX_LOG = log;
  t.after(() => { process.env.PATH = oldPath; delete process.env.OV_CODEX_LOG; });
  fs.writeFileSync(path.join(dir, 'codex'), `#!${process.execPath}\nimport fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;fs.writeFileSync(process.env.OV_CODEX_LOG,JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'thread.started',thread_id:'s'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'ok'}}));`, { mode: 0o700 });
  // the runner hands the driver exactly this, from the folders the member may write (folderGrants strips the /** of a writ scope)
  assert.deepEqual(codex.sandboxOf([], dir), { writable: false, addDirs: [] }, 'no writ: read-only');
  assert.deepEqual(codex.sandboxOf([dir], dir), { writable: true, addDirs: [] }, 'the working folder itself');
  assert.deepEqual(codex.sandboxOf([other], dir), { writable: true, addDirs: [other] }, 'another folder only: writable, and that folder is named');
  assert.deepEqual(codex.sandboxOf([other, dir], dir), { writable: true, addDirs: [other] });
  const args = async (writeDirs, o = {}) => { await codex.run({ system: 's', prompt: 'p', cwd: dir, onEvent() {}, ...codex.sandboxOf(writeDirs, dir), ...o }); return JSON.parse(fs.readFileSync(log, 'utf8')); };
  const after = (a, flag) => a.flatMap((x, i) => (a[i - 1] === flag ? [x] : []));

  const none = await args([]);
  assert.deepEqual(after(none, '-s'), ['read-only']); assert.deepEqual(after(none, '--add-dir'), []);
  const own = await args([dir]);
  assert.deepEqual(after(own, '-s'), ['workspace-write']); assert.deepEqual(after(own, '--add-dir'), []);
  const fresh = await args([other]);
  assert.deepEqual(after(fresh, '-s'), ['workspace-write'], 'this was read-only: the writ was dropped');
  assert.deepEqual(after(fresh, '--add-dir'), [other]);
  assert.deepEqual(after(fresh, '-C'), [dir], 'the working folder does not move');
  // a resumed session has no -s / --add-dir: the same three cases as config overrides
  const cfg = (a) => after(a, '-c').filter((x) => x.startsWith('sandbox_'));
  assert.deepEqual(cfg(await args([], { sessionId: 'old' })), ['sandbox_mode="read-only"']);
  assert.deepEqual(cfg(await args([dir], { sessionId: 'old' })), ['sandbox_mode="workspace-write"']);
  const resumed = await args([other], { sessionId: 'old' });
  assert.deepEqual(cfg(resumed), ['sandbox_mode="workspace-write"', `sandbox_workspace_write.writable_roots=[${JSON.stringify(other)}]`]);
  assert.ok(!resumed.includes('-s') && !resumed.includes('--add-dir'), '`codex exec resume` takes neither flag');
});

test('pictures Codex generated during the turn come back as the result of an image step', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-codex-img-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), old = path.join(home, 'generated_images', 'session-one');
  fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, 'before.png'), 'old'); fs.utimesSync(path.join(old, 'before.png'), 1, 1);
  const oldPath = process.env.PATH, oldHome = process.env.CODEX_HOME;
  process.env.PATH = dir + path.delimiter + oldPath; process.env.CODEX_HOME = home;
  t.after(() => { process.env.PATH = oldPath; if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome; });
  fs.writeFileSync(path.join(dir, 'codex'), `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';for await(const c of process.stdin);fs.writeFileSync(path.join(process.env.CODEX_HOME,'generated_images','session-one','made.png'),'new');fs.writeFileSync(path.join(process.env.CODEX_HOME,'generated_images','session-one','notes.txt'),'x');console.log(JSON.stringify({type:'thread.started',thread_id:'session-one'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));`, { mode: 0o700 });
  const events = [];
  const r = await codex.run({ system: 's', prompt: 'p', cwd: dir, onEvent: (e) => events.push(e) });
  assert.equal(r.sessionId, 'session-one');
  const made = events.filter((e) => e.type === 'tool_result');
  assert.equal(made.length, 1, 'only the picture made in this turn, not an old one and not a text file');
  assert.equal(made[0].name, 'image_gen');
  assert.equal(Buffer.from(made[0].images[0].data, 'base64').toString(), 'new');
  assert.equal(made[0].images[0].type, 'image/png');
  assert.ok(events.some((e) => e.type === 'tool' && e.id === made[0].id), 'with the step it belongs to');
  assert.deepEqual(codex.generatedImages('../etc', 0), [], 'a session id is never a path');
});
