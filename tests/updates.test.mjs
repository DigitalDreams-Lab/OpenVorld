import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdates, newerVersion, updateCapability, latestRelease, notesText } from '../desktop/updates.mjs';

function harness(options = {}) {
  const updater = new EventEmitter(), dialogs = [], links = [], states = [], installs = [];
  updater.checkForUpdates = async () => null;
  updater.quitAndInstall = (...args) => installs.push(args);
  const responses = [];
  const updates = createUpdates({ updater, version: '0.9.2', packaged: true, automaticInstall: true,
    show: async message => { dialogs.push(message); return { response: responses.shift() ?? message.cancelId }; },
    openExternal: url => links.push(url), install: async finish => finish(), changed: state => states.push(state), log() {}, ...options,
  });
  return { updater, updates, dialogs, links, responses, states, installs };
}

test('stable updates never offer prereleases, older versions or the current version', () => {
  assert.ok(newerVersion('v0.10.0', '0.9.9'));
  for (const version of ['v0.9.2', '0.9.1', 'v0.10.0-beta.1', 'garbage']) assert.equal(newerVersion(version, '0.9.2'), false);
});

test('installation capability requires a signed Mac app or a supported installer', () => {
  assert.equal(updateCapability({ platform: 'darwin', arch: 'arm64' }), false);
  assert.equal(updateCapability({ platform: 'darwin', arch: 'x64', macSigned: true }), true);
  assert.equal(updateCapability({ platform: 'win32', arch: 'x64' }), true);
  assert.equal(updateCapability({ platform: 'linux', arch: 'x64' }), false);
  assert.equal(updateCapability({ platform: 'linux', arch: 'x64', appImage: '/Apps/OpenVorld.AppImage' }), true);
  assert.equal(updateCapability({ platform: 'linux', arch: 'arm64', appImage: '/Apps/OpenVorld.AppImage' }), false);
});

test('background download defers installation until both restart and lifecycle confirmation', async () => {
  let finish;
  const h = harness({ install: async callback => { finish = callback; } });
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.updater.allowDowngrade, false);
  h.responses.push(1);
  h.updater.emit('update-downloaded', { version: '0.10.0', releaseNotes: '- Update checks\n- Installers' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.dialogs[0].detail, /Update checks/);
  assert.equal(finish, undefined, 'Later never stops the engine');
  h.responses.push(0);
  await h.updates.check(true);
  assert.equal(typeof finish, 'function');
  assert.deepEqual(h.installs, [], 'the updater cannot bypass active-agent confirmation');
  finish();
  assert.deepEqual(h.installs, [[false, true]]);
});

test('concurrent checks share the download and failed downloads can be retried', async () => {
  const h = harness();
  let rejectDownload, calls = 0;
  h.updater.checkForUpdates = async () => { calls++; return { downloadPromise: new Promise((_, reject) => { rejectDownload = reject; }) }; };
  const checking = h.updates.check(true);
  await new Promise(resolve => setImmediate(resolve));
  await h.updates.check(true);
  assert.equal(calls, 1);
  rejectDownload(new Error('offline'));
  await checking;
  assert.match(h.dialogs.at(-1).message, /Could not check or download/);
  h.updater.checkForUpdates = async () => { calls++; return null; };
  await h.updates.check(true);
  assert.equal(calls, 2);
  assert.match(h.dialogs.at(-1).message, /up to date/);
});

test('unsigned Mac fallback shows changelog and only opens the trusted release URL on request', async () => {
  const h = harness({ automaticInstall: false, fetchRelease: async () => ({ tag_name: 'v0.10.0', body: '- Updates', html_url: 'https://untrusted.test' }) });
  h.responses.push(0);
  await h.updates.check();
  assert.match(h.dialogs[0].detail, /Updates/);
  assert.deepEqual(h.links, ['https://github.com/DigitalDreams-Lab/OpenVorld/releases/tag/v0.10.0']);
  assert.deepEqual(h.installs, []);
});

test('source launches never check the network; offline background checks stay quiet', async () => {
  let network = 0;
  const source = harness({ packaged: false, fetchRelease: async () => { network++; } });
  await source.updates.check(); await source.updates.check(true);
  assert.equal(network, 0); assert.equal(source.dialogs.length, 1);
  const offline = harness({ automaticInstall: false, fetchRelease: async () => { throw new Error('offline'); } });
  await offline.updates.check(); assert.equal(offline.dialogs.length, 0);
  await offline.updates.check(true); assert.equal(offline.dialogs.length, 1);
});

test('GitHub response errors and prereleases are rejected, notes stay plain bounded text', async () => {
  await assert.rejects(latestRelease(async () => ({ ok: false, status: 403 })), /GitHub returned 403/);
  await assert.rejects(latestRelease(async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.0', prerelease: true }) })), /No stable release/);
  assert.equal(notesText('<p>Fixed &amp; improved</p>').trim(), 'Fixed & improved');
  assert.ok(notesText('a'.repeat(20000)).length <= 12000);
});
