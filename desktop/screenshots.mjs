// Capture the real app with disposable, illustrative data. No model calls or personal worlds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'docs/images'); fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openvorld-screenshots-'));
process.env.OPENVORLD_HOME = path.join(temporary, 'data');
const { createVorld, vorldCtx, saveVorld } = await import('../engine/server/vorld.mjs');
const { saveParty, createPartyChat } = await import('../engine/server/parties.mjs');
const { createThread, appendEvent } = await import('../engine/server/threads.mjs');
const { saveProfile } = await import('../engine/server/profile.mjs');
const { gameFor } = await import('../engine/server/game.mjs');
const { id } = createVorld({ name: 'Launch Studio', about: 'A small crew bringing a thoughtful product into the world.', template: 'blank', brain: { provider: 'none' }, crew: [
  { name: 'Mira', job: 'Product lead', function: 'Shape the launch and coordinate the crew.' },
  { name: 'Jules', job: 'Builder', function: 'Build and check the product.' },
  { name: 'Sage', job: 'Researcher', function: 'Find the details that make the work better.' },
] });
let ctx = vorldCtx(id);
ctx = saveVorld(ctx, doc => { doc.seed = 'openvorld-launch-studio'; });
saveProfile(process.env.OPENVORLD_HOME, { name: 'Alex', about: 'I build useful things with a small crew. Clear plans, thoughtful details, and a little adventure.' });
const agents = ctx.crew.filter(member => member.role === 'agent');
const party = saveParty(ctx, { name: 'Launch crew', goal: 'Turn a good idea into a launch we can be proud of.', members: agents.map(member => member.id) });
const thread = createPartyChat(ctx, party.id, 'A thoughtful first release');
const project = path.join(ctx.dir, 'project');
const report = path.join(project, 'launch-brief.html');
fs.writeFileSync(report, `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#193d35;font:16px/1.7 system-ui,sans-serif;padding:56px}main{max-width:800px;margin:auto}.kicker{font-size:11px;font-weight:700;letter-spacing:.18em;color:#62786d}h1{font-size:48px;line-height:1.1;letter-spacing:-.05em;margin:16px 0 22px}p{max-width:620px}.divider{height:1px;background:#d4dcd3;margin:32px 0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{border:1px solid #d4dcd3;padding:20px;background:#fffdf8}.number{color:#8e7442;font-size:12px;font-weight:700}h2{font-size:17px;margin:12px 0 8px}.card p{font-size:13px;margin:0;color:#596d63}.note{font-size:12px;color:#728276;margin-top:28px}
</style></head><body><main><div class="kicker">LAUNCH STUDIO / RELEASE BRIEF</div><h1>A small launch.<br>A world of possibility.</h1><p>Make the first experience useful, welcoming, and easy to understand. Give a small group something worth coming back to.</p><div class="divider"></div><div class="cards"><section class="card"><span class="number">01 / PRODUCT</span><h2>A clear first step</h2><p>One simple path from a new idea to a working crew.</p></section><section class="card"><span class="number">02 / STORY</span><h2>Show the work</h2><p>Real screens, a short walkthrough, and a useful example.</p></section><section class="card"><span class="number">03 / FEEDBACK</span><h2>Listen, then improve</h2><p>Invite a small first group and learn from their questions.</p></section></div><p class="note">Prepared by the Launch crew · Illustrative demo project</p></main></body></html>`);
for (const event of [
  { type: 'founder.message', text: 'Let’s plan a small, thoughtful first release. What should we focus on?' },
  { type: 'agent.text', role: agents[0].id, text: 'Three things: a clear first experience, a useful walkthrough, and a small group to learn from.\n\n@Jules, can you check the product path? @Sage, shape the launch story.' },
  { type: 'agent.text', role: agents[1].id, text: 'The first-run path is ready: create a vorld, meet your crew, and start a shared task. I added a short checklist so every step is easy to follow.' },
  { type: 'agent.text', role: agents[2].id, text: 'The story is simple: bring your project to life with a crew you can see. Lead with the village, then show the work happening inside it.' },
  { type: 'agent.text', role: agents[0].id, text: `The plan is ready.\n\n- **Product:** a welcoming first task\n- **Story:** a short, honest walkthrough\n- **Feedback:** a small first group\n\n[Open the launch brief](<${report}>)` },
]) appendEvent(ctx, thread.id, event);
const privateThread = createThread(ctx, { role: agents[0].id, title: 'The launch brief' });
appendEvent(ctx, privateThread.id, { type: 'agent.text', role: agents[0].id, text: `Here’s the brief we made together.\n\n[Open the launch brief](<${report}>)` });
gameFor(ctx).event('party.created');
const env = { ...process.env, OV_DESKTOP_USER_DATA: path.join(temporary, 'preferences') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
let desktop;
try {
  desktop = await _electron.launch({ executablePath: (await import('electron')).default, args: [root], env, timeout: 30000 });
  // The capture runner is temporary; keep its Electron icon out of the user's Dock.
  await desktop.evaluate(({ app }) => { if (process.platform === 'darwin') app.dock.hide(); });
  const page = await desktop.firstWindow(); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let socket;
  await page.routeWebSocket(/\/ws\?/, client => { socket = client; const server = client.connectToServer(); server.onMessage(message => client.send(message)); client.onMessage(message => server.send(message)); });
  const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled', scale: 'css' }); console.log('Captured ' + name); };
  await page.getByRole('button', { name: 'New vorld', exact: true }).waitFor();
  await page.locator('.title-card .brand-icon').waitFor();
  await shot('startup');
  await page.getByRole('button', { name: /About OpenVorld/ }).click();
  await page.getByRole('dialog', { name: 'OpenVorld', exact: true }).waitFor();
  await shot('about');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Launch Studio/ }).click();
  await page.locator('.phaser-host canvas').waitFor();
  await page.waitForFunction(() => !!document.querySelector('.hud-profile canvas')?.getContext('2d')?.getImageData(0, 0, 40, 40).data.some(byte => byte));
  await page.waitForTimeout(1000);
  // Walk down the road to frame the cottage and plaza together, using the normal controls.
  await page.keyboard.down('s'); await page.waitForTimeout(600); await page.keyboard.up('s');
  await page.waitForTimeout(500);
  assert.ok(socket);
  // Give each member a distinct place to stand. A tight meeting ring puts names over neighbours.
  socket.send(JSON.stringify({ type: 'command', role: agents[0].id, commands: [{ do: 'walk_to', to: { kind: 'prop', ref: 'stall' } }, { do: 'wait', ms: 60000 }] }));
  socket.send(JSON.stringify({ type: 'command', role: agents[1].id, commands: [{ do: 'walk_to', to: { kind: 'plaza' } }, { do: 'wait', ms: 60000 }] }));
  socket.send(JSON.stringify({ type: 'command', role: agents[2].id, commands: [{ do: 'walk_to', to: { kind: 'plaza' } }, { do: 'walk_to', to: { kind: 'prop', ref: 'bench' } }, { do: 'wait', ms: 60000 }] }));
  await page.waitForTimeout(14000);
  socket.send(JSON.stringify({ type: 'thread.event', role: agents[0].id, thread: 'demo-activity', ev: { type: 'turn.start' } }));
  socket.send(JSON.stringify({ type: 'thread.event', role: agents[0].id, thread: 'demo-activity', ev: { type: 'delta', text: 'Bringing the launch plan together.' } }));
  await page.locator('.agent-balloon').first().waitFor({ state: 'visible' });
  await shot('village');
  socket.send(JSON.stringify({ type: 'thread.event', role: agents[0].id, thread: 'demo-activity', ev: { type: 'turn.done', text: 'The launch plan is ready.', meta: {} } }));
  await page.locator('.agent-balloon').first().waitFor({ state: 'detached', timeout: 8000 });
  await page.getByRole('button', { name: /^Parties/ }).click();
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.getByText('The plan is ready.', { exact: false }).waitFor();
  await shot('party');
  await page.getByRole('link', { name: 'Open the launch brief', exact: true }).click();
  await page.frameLocator('iframe[title="launch-brief.html preview"]').getByRole('heading', { name: 'A small launch. A world of possibility.' }).waitFor();
  await shot('preview');
  await page.getByRole('button', { name: /^Close preview/ }).click();
  await page.locator('.party-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-brand .brand-icon').waitFor();
  await shot('settings');
  await page.getByRole('button', { name: 'About OpenVorld', exact: true }).click();
  await page.getByRole('dialog', { name: 'OpenVorld', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.modal.settings').count(), 1, 'closing About preserves Settings');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Check the saved-key row without storing or revealing any credential.
  await page.route('**/api/vorlds/*/settings', async route => {
    const response = await route.fetch(), settings = await response.json();
    await route.fulfill({ response, json: { ...settings, providers: [{ id: 'openai-compatible', name: 'demo', base_url: 'http://localhost:1234/v1', has_key: true, api_key_env: '' }] } });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const key = page.getByPlaceholder('Key saved ✓', { exact: true }), forget = page.getByRole('button', { name: 'Forget key', exact: true });
  assert.equal(await key.inputValue(), ''); assert.equal(await key.getAttribute('type'), 'password');
  const keyBox = await key.boundingBox(), forgetBox = await forget.boundingBox();
  assert.ok(keyBox && forgetBox && Math.abs(keyBox.y + keyBox.height / 2 - forgetBox.y - forgetBox.height / 2) < 1, 'the saved-key input and Forget key button align');
  await forget.click();
  assert.equal(await page.getByPlaceholder('API key, or env var name', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 1, 'forgetting a key keeps the endpoint');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Branding and screenshot checks passed. All scenes use illustrative demo data.');
} finally {
  if (desktop) await desktop.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
