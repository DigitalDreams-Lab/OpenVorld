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
  assert.match(text, /gh release create "\$\{TAG\}"/); assert.match(text, /--clobber/); assert.match(text, /SHA256SUMS\.txt/);
  assert.match(text, /TAG="v\$\{VERSION\}"/, 'the tag is v<package version>');
  assert.match(text, /release\/latest-\*\.yml/); assert.match(text, /release\/\*\.blockmap/);
  assert.match(text, /--draft --target/); assert.match(text, /--draft=false --latest/);
  assert.ok('release' in wf.on.workflow_dispatch.inputs && wf.on.push.tags.includes('v*'));
  assert.match(fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'), /artifactName: .*\$\{version\}.*\$\{os\}.*\$\{arch\}/, 'files carry the version');
});
