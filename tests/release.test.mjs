// The release workflow: the notes of a version come from the changelog, and the workflow publishes versioned builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { releaseNotes } from '../tools/release-notes.mjs';
import { verifyUpdates } from '../tools/verify-updates.mjs';
import { desktopBuildOptions } from '../tools/desktop-build.mjs';
import { updateFeedFiles, publishUpdateFeed, MANIFESTS } from '../tools/publish-update-feed.mjs';
import { verifyMac } from '../desktop/verify-mac.mjs';

const CHANGELOG = '# Changelog\n\nintro\n\n## 0.6.0 - 2026-11-15\n\n- API keys\n- More\n\n## 0.5.0 - 2026-11-15\n\n- Images\n\n## 0.10.0 - 2026-11-16\n\n- Ten\n';

test('release notes are the version’s own changelog entry', () => {
  assert.equal(releaseNotes(CHANGELOG, '0.6.0'), '- API keys\n- More');
  assert.equal(releaseNotes(CHANGELOG, '0.5.0'), '- Images');
  assert.equal(releaseNotes(CHANGELOG, '0.10.0'), '- Ten', 'the last entry runs to the end');
  assert.equal(releaseNotes(CHANGELOG, '0.1.0'), 'OpenVorld 0.1.0', '0.1.0 is not 0.10.0, and a missing entry still gives a line');
  assert.equal(releaseNotes(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version).startsWith('- '), true, 'the current version has an entry');
});

test('release validation rejects incomplete feeds and corrupt installers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-update-feed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(verifyUpdates(dir, '0.10.0'), /No architecture-specific/);
  const data = Buffer.from('test installer');
  const filename = 'OpenVorld-0.10.0-win-x64.exe';
  const info = { version: '0.10.0', releaseNotes: '- Updates', files: [{ url: filename, size: data.length, sha512: crypto.createHash('sha512').update(data).digest('base64') }] };
  fs.writeFileSync(path.join(dir, filename), data);
  fs.writeFileSync(path.join(dir, 'latest-x64.yml'), YAML.stringify(info));
  assert.deepEqual(await verifyUpdates(dir, '0.10.0'), ['latest-x64.yml']);
  await assert.rejects(verifyUpdates(dir, '0.10.1'), /Incomplete/);
  fs.writeFileSync(path.join(dir, filename), Buffer.alloc(data.length));
  await assert.rejects(verifyUpdates(dir, '0.10.0'), /checksum mismatch/);
});

test('the desktop workflow builds three systems, then publishes one versioned release', () => {
  const wf = YAML.parse(fs.readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8'));
  assert.deepEqual(wf.jobs.build.strategy.matrix.include, [
    { os: 'macos-latest', arch: 'arm64' }, { os: 'macos-15-intel', arch: 'x64' },
    { os: 'windows-latest', arch: 'x64' }, { os: 'ubuntu-24.04', arch: 'x64' },
  ]);
  assert.equal(wf.jobs.release.needs, 'build');
  assert.equal(wf.jobs.release.permissions.contents, 'write', 'only the release job may write');
  assert.equal(wf.permissions.contents, 'read');
  const text = fs.readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  assert.match(text, /name: 'OpenVorld-\$\{\{ steps\.version\.outputs\.version \}\}-\$\{\{ matrix\.os \}\}-\$\{\{ matrix\.arch \}\}'/, 'artifacts are versioned and keep architectures separate');
  assert.match(text, /gh release create "\$\{TAG\}" "\$\{ARTIFACTS\[@\]\}"/);
  assert.match(text, /publish-update-feed\.mjs dist/);
  assert.doesNotMatch(text, /SHA256SUMS|release\/\*\.blockmap|release\/\*\.dmg/);
  assert.match(text, /TAG="v\$\{VERSION\}"/, 'the tag is v<package version>');
  assert.match(text, /release\/latest-\*\.yml/);
  assert.match(text, /--draft --target/); assert.match(text, /--draft=false --latest/);
  assert.ok('release' in wf.on.workflow_dispatch.inputs && wf.on.push.tags.includes('v*'));
  assert.match(fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'), /artifactName: .*\$\{version\}.*\$\{os\}.*\$\{arch\}/, 'files carry the version');
});

test('the build command handles absent signing credentials and rejects an incomplete Mac identity', () => {
  const build = (env, distribution = true) => desktopBuildOptions({ platform: 'darwin', arch: 'arm64', env, distribution });
  const local = build({ CSC_LINK: '', CSC_KEY_PASSWORD: '' }, false);
  assert.equal('CSC_LINK' in local.env, false);
  assert.equal('CSC_KEY_PASSWORD' in local.env, false);
  assert.throws(() => build({}), /Public Mac releases require/);
  assert.throws(() => build({ CSC_LINK: 'certificate' }, false), /MAC_SIGNING_IDENTITY/);
  assert.throws(() => build({ CSC_NAME: '-', APPLE_KEYCHAIN_PROFILE: 'notary' }), /Public Mac releases require/);
  assert.throws(() => build({ CSC_NAME: 'Apple Development: Test', APPLE_KEYCHAIN_PROFILE: 'notary' }), /Public Mac releases require/);
  assert.throws(() => build({ CSC_NAME: 'Developer ID Application: Test' }), /notarization credentials/);
  const signed = build({ CSC_NAME: 'Developer ID Application: Test', APPLE_KEYCHAIN_PROFILE: 'notary' });
  assert.ok(signed.args.includes('--config.mac.identity=Test'), 'electron-builder requires the holder name without the certificate-type prefix');
  assert.ok(signed.args.includes('--config.mac.notarize=true'));
  assert.ok(signed.args.includes('--config.forceCodeSigning=true'));
  assert.equal(desktopBuildOptions({ platform: 'win32', arch: 'x64', distribution: true }).args.includes('--config.forceCodeSigning=true'), false);
});

test('update feeds map each architecture to its full installer URL and reject partial or mixed releases', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-feed-publish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const suffixes = ['mac-arm64.zip', 'mac-x64.zip', 'win-x64.exe', 'linux-x86_64.AppImage'];
  const manifest = index => ({ version: '0.11.0', releaseNotes: '- Signed desktop updates', files: [{ url: `OpenVorld-0.11.0-${suffixes[index]}`, sha512: 'checksum', size: 123 }] });
  MANIFESTS.forEach((name, index) => fs.writeFileSync(path.join(directory, name), YAML.stringify(manifest(index))));
  const files = updateFeedFiles(directory, '0.11.0');
  files.forEach((file, index) => {
    const info = YAML.parse(file.content);
    assert.equal(info.files.length, 1);
    assert.equal(info.files[0].url, `https://github.com/DigitalDreams-Lab/OpenVorld/releases/download/v0.11.0/OpenVorld-0.11.0-${suffixes[index]}`);
    assert.equal(info.path, info.files[0].url);
  });
  fs.writeFileSync(path.join(directory, MANIFESTS[0]), YAML.stringify(manifest(1)));
  assert.throws(() => updateFeedFiles(directory, '0.11.0'), /Unexpected desktop artifact/);
  assert.throws(() => updateFeedFiles(directory, '0.12.0'), /Incomplete/);
  fs.unlinkSync(path.join(directory, MANIFESTS[0]));
  assert.throws(() => updateFeedFiles(directory, '0.11.0'), /ENOENT/);
});

test('feed publication switches one branch only after all metadata is committed and never forces history', async () => {
  const calls = [];
  const files = [{ path: MANIFESTS[0], content: YAML.stringify({ version: '0.11.0' }) }];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
    const result = url.includes('/contents/') ? { content: Buffer.from('version: 0.10.0').toString('base64') } : url.endsWith('/git/ref/heads/updates') ? { object: { sha: 'previous' } } : { sha: url.endsWith('/git/trees') ? 'tree' : 'commit' };
    return { ok: true, json: async () => result };
  };
  const result = await publishUpdateFeed(files, { token: 'test', fetcher });
  assert.equal(result.commit, 'commit');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST', 'POST', 'PATCH']);
  assert.deepEqual(calls[2].body.tree, files);
  assert.deepEqual(calls[3].body.parents, ['previous']);
  assert.deepEqual(calls[4].body, { sha: 'commit', force: false });
  await assert.rejects(publishUpdateFeed([{ ...files[0], content: 'version: 0.9.0' }], { token: 'test', fetcher }), /roll the update feed back/);
  await assert.rejects(publishUpdateFeed(files, { token: 'test', fetcher: async () => ({ ok: false, status: 403 }) }), /403/);
});

test('public Mac verification rejects ad-hoc signatures and missing notarization instead of bypassing Gatekeeper', () => {
  const signatures = { adhoc: 'Signature=adhoc\nTeamIdentifier=not set', developer: 'Authority=Developer ID Application: Test\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory flags=0x10000(runtime)' };
  const run = (signature, stapled = true) => (command, args) => {
    if (command.endsWith('PlistBuddy')) return { status: 0, stdout: '0.11.0' };
    if (command.endsWith('lipo')) return { status: 0, stdout: 'arm64' };
    if (args.includes('-dv')) return { status: 0, stderr: signature };
    if (args.includes('stapler') && !stapled) return { status: 65, stderr: 'No ticket' };
    return { status: 0 };
  };
  const verify = (signature, stapled) => verifyMac('/tmp/OpenVorld.app', { distribution: true, arch: 'arm64', version: '0.11.0', run: run(signature, stapled) });
  assert.throws(() => verify(signatures.adhoc), /Developer ID Application/);
  assert.throws(() => verify(signatures.developer, false), /notarization ticket/);
  assert.equal(verify(signatures.developer).gatekeeper, 'accepted');
});
