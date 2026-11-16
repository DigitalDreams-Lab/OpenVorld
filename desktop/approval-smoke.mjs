// Reproduce party approvals that belong to an older group chat, using disposable data and no model calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openvorld-approval-smoke-'));
process.env.OPENVORLD_HOME = path.join(temporary, 'data');
const { createVorld, vorldCtx } = await import('../engine/server/vorld.mjs');
const { saveParty, createPartyChat } = await import('../engine/server/parties.mjs');
const { createThread } = await import('../engine/server/threads.mjs');
const { requestAccess } = await import('../engine/server/agents/runner.mjs');
const { id } = createVorld({ name: 'Approval test', template: 'blank', brain: { provider: 'none' }, crew: [{ name: 'Stella', job: 'Analyzer' }] });
const ctx = vorldCtx(id), role = ctx.crew.find(member => member.role === 'agent').id;
const party = saveParty(ctx, { name: 'Approval crew', goal: 'Check approval routing', members: [role] });
const original = createPartyChat(ctx, party.id, 'Older approval conversation');
const privateChat = createThread(ctx, { role, title: 'Private conversation' });
const shared = path.join(temporary, 'shared'); fs.mkdirSync(shared);
requestAccess(ctx, original, role, [
  { capability: 'net.session', scope: 'studio.youtube.com', signin: true, why: 'Sign in for this group task' },
  { capability: 'fs.read', scope: shared, why: 'Read the group task notes' },
], () => {});
await new Promise(resolve => setTimeout(resolve, 20));
const latest = createPartyChat(ctx, party.id, 'Most recent conversation');
const env = { ...process.env, OV_DESKTOP_USER_DATA: path.join(temporary, 'preferences') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
const argument = process.argv[2];
const executablePath = argument ? path.resolve(argument, ...(argument.endsWith('.app') ? ['Contents', 'MacOS', 'OpenVorld'] : [])) : (await import('electron')).default;
let desktop;
try {
  desktop = await _electron.launch({ executablePath, args: argument ? [] : [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 30000 });
  if (process.platform === 'darwin') await desktop.evaluate(({ app }) => app.dock.hide());
  const page = await desktop.firstWindow(), errors = []; page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  // No real sign-in window or credentials are used. The real refusal and folder approval APIs remain in use.
  await page.route('**/signin?site=*', route => route.fulfill({ json: { available: true, open: false, signed: false } }));
  await page.getByRole('button', { name: /^Approval test/ }).click();
  await page.locator('.phaser-host canvas').waitFor();
  await page.getByRole('button', { name: 'Open the request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: "Stella's request", exact: true });
  await dialog.getByRole('button', { name: 'Sign in to studio.youtube.com', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Refuse', exact: true }).isEnabled(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Allow once', exact: true }).isDisabled(), true, 'sign-in is still required to allow access');
  assert.equal(await page.locator('.member-panel').count(), 0, 'opening a group request does not divert to a private chat');
  await dialog.getByRole('button', { name: 'Close request', exact: true }).click();
  await page.getByRole('button', { name: 'Stella · Analyzer', exact: true }).click();
  await page.getByRole('button', { name: 'Stella: review request for studio.youtube.com', exact: true }).click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.member-panel').count(), 1, 'closing the request preserves the conversation');
  await page.locator('.member-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Parties/ }).click();
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.getByRole('button', { name: 'Most recent conversation', exact: true }).waitFor();
  assert.equal(await page.locator('.thread-tab.on').innerText(), 'Most recent conversation');
  await page.getByRole('button', { name: 'Stella: review request for studio.youtube.com', exact: true }).click();
  await dialog.getByRole('button', { name: 'Refuse', exact: true }).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'openvorld-approval-dialog.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Open the request', exact: true }).click();
  await dialog.getByRole('button', { name: 'Refuse', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.agent-balloon.ask').getByRole('button', { name: 'Details', exact: true }).click();
  await dialog.getByRole('button', { name: 'Allow once', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const result = await page.evaluate(async ({ id, original, privateId, latest }) => {
    const token = document.querySelector('meta[name="ov-token"]').content;
    const get = async tail => (await fetch(`/api/vorlds/${id}${tail}`, { headers: { 'x-ov-token': token } })).json();
    for (let i = 0; i < 100; i++) {
      const source = await get(`/threads/${original}`);
      if (source.events.some(event => event.type === 'agent.text')) return {
        answers: source.events.filter(event => event.type === 'writ.answered').map(event => event.answer),
        pending: (await get('/writs/open')).length,
        privateEvents: (await get(`/threads/${privateId}`)).events.length,
        latestEvents: (await get(`/threads/${latest}`)).events.length,
        resumed: true,
      };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('The original group did not resume after its requests were answered.');
  }, { id, original: original.id, privateId: privateChat.id, latest: latest.id });
  assert.deepEqual(result.answers, ['deny', 'once']); assert.equal(result.pending, 0);
  assert.equal(result.privateEvents, 0); assert.equal(result.latestEvents, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', restoredRequest: true, groupResumed: result.resumed, approvalAndRefusal: true }));
} finally {
  if (desktop) await desktop.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
