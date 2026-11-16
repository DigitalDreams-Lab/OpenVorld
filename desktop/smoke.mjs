// End-to-end check of either the source app or a packaged executable, using disposable data only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openvorld-desktop-smoke-'));
const activityCheck = process.argv.includes('--activity');
const profileCheck = process.argv.includes('--profile');
const spriteCheck = process.argv.includes('--sprites');
const executableArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const executable = executableArgument ? path.resolve(executableArgument) : (await import('electron')).default;
const env = { ...process.env, OPENVORLD_HOME: path.join(temporary, 'data'), OV_DESKTOP_USER_DATA: path.join(temporary, 'preferences') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
let desktop;
try {
  desktop = await _electron.launch({ executablePath: executable, args: executableArgument ? [] : [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 30000 });
  const page = await desktop.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let gameSocket;
  if (activityCheck) await page.routeWebSocket(/\/ws\?/, socket => {
    gameSocket = socket;
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => server.send(message));
  });
  await page.getByRole('button', { name: 'New vorld', exact: true }).waitFor();
  const origin = new URL(page.url()).origin;
  const preferences = await (await desktop.browserWindow(page)).evaluate(window => window.webContents.getLastWebPreferences());
  assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true);
  await page.getByRole('button', { name: 'New vorld', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).first().fill('Desktop smoke world');
  await page.getByLabel('None for now').check();
  await page.getByRole('button', { name: 'Create the vorld', exact: true }).click();
  await page.locator('canvas').first().waitFor({ timeout: 30000 });
  const state = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="ov-token"]').content;
    const api = async (url, body) => {
      const response = await fetch('/api' + url, { method: body ? 'POST' : 'GET', headers: { 'x-ov-token': token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const boot = await api('/boot'), id = boot.vorlds[0].id;
    const vorld = await api(`/vorlds/${id}/vorld`), role = vorld.crew.find(member => member.role === 'companion').id;
    const thread = await api(`/vorlds/${id}/threads`, { role });
    await api(`/vorlds/${id}/threads/${thread.id}/messages`, { text: 'Hello from the desktop smoke test.' });
    for (let i = 0; i < 100; i++) {
      const saved = await api(`/vorlds/${id}/threads/${thread.id}`);
      if (saved.events.some(event => event.type === 'agent.text')) return { home: boot.home, crew: vorld.crew.length, role, replied: true };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('The scripted agent did not reply.');
  });
  assert.equal(state.home, env.OPENVORLD_HOME); assert.ok(state.replied);
  if (spriteCheck) {
    await page.waitForFunction(() => [...document.querySelectorAll('canvas.portrait')].length > 1 && [...document.querySelectorAll('canvas.portrait')].every(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((byte, index) => index % 4 === 3 && byte > 0);
    }), null, { timeout: 30000 });
    const pages = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="ov-token"]').content, headers = { 'x-ov-token': token };
      const boot = await (await fetch('/api/boot', { headers })).json();
      const world = await (await fetch(`/api/vorlds/${boot.vorlds[0].id}/vorld`, { headers })).json();
      return Promise.all(world.art.atlas.sheets.filter(sheet => sheet.group === 'characters').map(async sheet => {
        const response = await fetch('/api/art/' + sheet.image, { headers });
        const image = await createImageBitmap(await response.blob());
        const result = { width: image.width, height: image.height }; image.close(); return result;
      }));
    });
    assert.ok(pages.length > 1 && pages.every(page => page.width <= 2048 && page.height <= 2048), 'walking sprites use small decoded image pages');
  }
  if (profileCheck) {
    await page.getByRole('button', { name: 'Edit your profile', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('Ada Brook');
    await page.getByLabel('About me', { exact: true }).fill('I build useful tools and prefer concise updates.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.hud-title .ellip')?.textContent === 'Ada Brook');
    assert.ok((await page.locator('.hud-rank').innerText()).trim().length > 1, 'the earned title is still shown');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.hud-title .ellip')?.textContent === 'Ada Brook');
    await page.getByRole('button', { name: 'Edit your profile', exact: true }).click();
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Ada Brook');
    assert.equal(await page.getByLabel('About me', { exact: true }).inputValue(), 'I build useful tools and prefer concise updates.');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const saved = JSON.parse(fs.readFileSync(path.join(env.OPENVORLD_HOME, 'profile.json'), 'utf8'));
    assert.equal(saved.name, 'Ada Brook'); assert.match(saved.about, /concise updates/);
  }
  if (activityCheck) {
    assert.ok(gameSocket);
    const send = message => gameSocket.send(JSON.stringify(message));
    const turn = ev => send({ type: 'thread.event', role: state.role, thread: 'activity-preview', ev });
    turn({ type: 'turn.start' });
    turn({ type: 'delta', text: 'I checked the project.\nPreparing the release notes now.' });
    const balloon = page.locator(`.agent-balloon[data-agent="${state.role}"]`);
    await balloon.waitFor({ state: 'visible' });
    assert.match(await balloon.innerText(), /Preparing the release notes now/);
    assert.equal(await page.locator('.browser-dock').count(), 0);
    const image = (await page.screenshot({ type: 'jpeg' })).toString('base64');
    send({ type: 'browser', role: state.role, active: true, title: 'Project documentation', url: 'https://example.com/docs', image });
    await balloon.locator('.ab-browser').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.ab-browser')?.naturalWidth > 0);
    const before = await balloon.boundingBox();
    await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d');
    const after = await balloon.boundingBox();
    assert.ok(before && after && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1), 'balloon follows the character and camera');
    await page.screenshot({ path: path.join(os.tmpdir(), 'openvorld-agent-balloon.png') });
    send({ type: 'browser', role: state.role, active: false });
    turn({ type: 'turn.done', text: 'The files were checked.\nRelease notes are ready.', meta: { balloon: 'Done!' } });
    await page.waitForFunction(() => document.querySelector('.agent-balloon')?.textContent?.includes('Release notes are ready.'));
    assert.equal(await balloon.locator('.ab-browser').count(), 0);
    await balloon.waitFor({ state: 'detached', timeout: 8000 });
  }
  assert.deepEqual(errors, []);
  const screenshot = path.join(os.tmpdir(), 'openvorld-desktop-smoke.png');
  await page.screenshot({ path: screenshot });
  await desktop.close(); desktop = null;
  await assert.rejects(fetch(origin + '/api/boot'), 'quitting also stops the engine');
  console.log(JSON.stringify({ result: 'passed', executable, crew: state.crew, scriptedReply: state.replied, profileChecked: profileCheck, spritesChecked: spriteCheck, engineStopped: true, screenshot }));
} finally {
  if (desktop) await desktop.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
