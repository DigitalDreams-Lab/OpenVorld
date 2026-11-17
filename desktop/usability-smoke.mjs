// Exercise chat, folder-picker deduplication, party gathering and the desktop menu with disposable data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openvorld-usability-'));
process.env.OPENVORLD_HOME = path.join(temporary, 'data');
const { createVorld, vorldCtx } = await import('../engine/server/vorld.mjs');
const { saveParty, createPartyChat } = await import('../engine/server/parties.mjs');
const { id } = createVorld({ name: 'Usability test', template: 'blank', brain: { provider: 'none' }, crew: [
  { name: 'Ada', job: 'Writer' }, { name: 'Bo Li', job: 'Editor' }, { name: 'Cy', job: 'Researcher' }, { name: 'Dee', job: 'Designer' },
] });
const ctx = vorldCtx(id), agents = ctx.crew.filter(m => m.role === 'agent');
const party = saveParty(ctx, { name: 'Writing crew', goal: 'Write something useful', members: agents.slice(0, 3).map(m => m.id) });
createPartyChat(ctx, party.id, 'A group conversation');
const env = { ...process.env, OV_DESKTOP_USER_DATA: path.join(temporary, 'preferences') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
const argument = process.argv[2];
const executablePath = argument ? path.resolve(argument, ...(argument.endsWith('.app') ? ['Contents', 'MacOS', 'OpenVorld'] : [])) : (await import('electron')).default;
let desktop, releasePicker;
try {
  desktop = await _electron.launch({ executablePath, args: argument ? [] : [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 30000 });
  const page = await desktop.firstWindow(), errors = []; page.setDefaultTimeout(20000);
  const menus = await desktop.evaluate(({ app, Menu }) => {
    if (process.platform === 'darwin') app.dock.hide();
    return Menu.getApplicationMenu().items.map(item => ({ label: item.label, items: item.submenu?.items.map(i => i.label) ?? [] }));
  });
  if (process.platform === 'darwin') {
    const items = menus.find(m => m.label === 'OpenVorld').items;
    assert.match(items[0], /About/); assert.equal(items[1], 'Check for Updates…');
    assert.ok(!menus.find(m => m.label === 'Help').items.includes('Check for Updates…'));
  }
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: /^About OpenVorld/ }).waitFor();
  if (process.platform === 'darwin') await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'OpenVorld').submenu.items[0].click());
  else await page.getByRole('button', { name: /^About OpenVorld/ }).click();
  const about = page.getByRole('dialog', { name: 'OpenVorld', exact: true });
  await about.getByRole('button', { name: 'Changelog', exact: true }).click();
  const aboutBox = await about.boundingBox(); assert.ok(aboutBox);
  const padding = { x: aboutBox.x + 12, y: aboutBox.y + aboutBox.height / 2 };
  await page.mouse.click(padding.x, padding.y);
  assert.equal(await about.isVisible(), true, 'clicking empty space inside About must keep it open');
  await about.locator('.about-changelog li').first().click();
  assert.equal(await about.isVisible(), true, 'clicking release notes must keep About open');
  await page.mouse.move(padding.x, padding.y); await page.mouse.down();
  await page.mouse.move(8, 8); await page.mouse.up();
  assert.equal(await about.isVisible(), true, 'dragging from inside to the backdrop must keep About open');
  const releases = about.locator('.about-changelog details');
  const version = await desktop.evaluate(({ app }) => app.getVersion());
  assert.match(await releases.first().locator('summary').innerText(), new RegExp(`v${version.replaceAll('.', '\\.')}`));
  assert.ok(await releases.count() > 2);
  await releases.nth(1).locator('summary').click();
  assert.equal(await releases.nth(1).locator('li').first().isVisible(), true, 'older release notes expand');
  await page.screenshot({ path: path.join(os.tmpdir(), 'openvorld-about-changelog.png') });
  await page.mouse.click(8, 8); await about.waitFor({ state: 'hidden' });
  await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Help').submenu.items.find(i => i.label === 'What’s New').click());
  await about.waitFor(); assert.equal(await about.getByRole('button', { name: 'Changelog', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape'); await about.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Usability test/ }).click();
  await page.locator('.phaser-host canvas').waitFor();
  await page.getByRole('button', { name: /^Parties/ }).click();
  await page.getByRole('button', { name: 'Open Writing crew chat', exact: true }).click();
  await page.locator('.party-panel').waitFor();
  const composer = page.locator('.party-panel textarea');
  let messages = 0;
  await page.route('**/threads/*/messages', async route => { messages++; await route.continue(); });
  await composer.fill('@');
  const options = page.getByRole('listbox', { name: 'Mention crew members' }).getByRole('option');
  assert.equal(await options.count(), 3, 'only party members are offered in the group');
  await composer.press('ArrowDown'); await composer.press('Enter');
  assert.equal(await composer.inputValue(), '@Bo Li '); assert.equal(messages, 0, 'choosing a mention does not send');
  await composer.fill('Please @Ad');
  await options.filter({ hasText: '@Ada' }).click();
  assert.equal(await composer.inputValue(), 'Please @Ada ');
  await composer.fill('@'); await composer.press('Escape');
  assert.equal(await page.getByRole('listbox').count(), 0); assert.equal(await page.locator('.party-panel').count(), 1, 'Escape closes suggestions before the chat');
  await composer.fill('@Bo Li review this please'); await composer.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.party-panel .msg.me').length > 0);
  assert.equal(messages, 1);
  await page.locator('.party-panel').getByRole('button', { name: 'Close', exact: true }).click();
  for (const m of agents.slice(0, 3)) {
    await page.getByRole('button', { name: `${m.name} · ${m.job}`, exact: true }).click();
    await page.getByRole('button', { name: `${m.name} is following you: send them home`, exact: true }).waitFor();
    await page.locator('.member-panel').getByRole('button', { name: 'Close', exact: true }).click();
  }
  await page.waitForTimeout(11000); // let the formation settle, beyond the former automatic trip-home delay
  await page.screenshot({ path: path.join(os.tmpdir(), 'openvorld-followers.png') });
  await page.getByRole('button', { name: 'Ada · Writer', exact: true }).click();
  await page.getByRole('button', { name: 'Ada is following you: send them home', exact: true }).waitFor();
  await page.locator('.member-panel').getByRole('button', { name: 'Start a chat', exact: true }).click();
  await page.locator('.member-panel textarea').fill('@');
  assert.equal(await page.getByRole('listbox').getByRole('option').count(), ctx.crew.length, 'private chat suggestions include the crew');
  await page.locator('.member-panel textarea').press('Escape');
  await page.locator('.member-panel').getByRole('button', { name: 'Settings', exact: true }).click();
  let pickCalls = 0;
  await page.route('**/fs/pick', async route => {
    pickCalls++; await new Promise(resolve => { releasePicker = resolve; }); await route.fulfill({ json: { path: null } });
  });
  const pick = page.locator('.member-settings').getByRole('button', { name: 'change folder', exact: true });
  await pick.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('.workbenches .link-btn')?.disabled);
  assert.equal(pickCalls, 1); releasePicker();
  await pick.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
  assert.equal(await pick.isEnabled(), true); assert.equal(pickCalls, 1, 'cancel does not reopen the picker');
  await page.locator('.member-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.member-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Unsaved profile draft');
  await page.getByRole('button', { name: 'About OpenVorld', exact: true }).click();
  await about.getByRole('button', { name: 'Changelog', exact: true }).click();
  await about.locator('.about-changelog details').first().waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); await about.waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Unsaved profile draft', 'closing About preserves Settings edits');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', menu: true, partyCard: true, mentions: true, partyStays: true, singlePicker: true, aboutChangelog: true }));
} finally {
  releasePicker?.(); if (desktop) await desktop.close(); fs.rmSync(temporary, { recursive: true, force: true });
}
