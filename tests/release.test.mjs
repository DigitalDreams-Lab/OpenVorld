// The release workflow: the notes of a version come from the changelog, and the workflow publishes versioned builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { releaseNotes } from '../tools/release-notes.mjs';

const CHANGELOG = '# Changelog\n\nintro\n\n## 0.6.0 - 2026-11-15\n\n- API keys\n- More\n\n## 0.5.0 - 2026-11-15\n\n- Images\n\n## 0.10.0 - 2026-11-16\n\n- Ten\n';

test('release notes are the version’s own changelog entry', () => {
  assert.equal(releaseNotes(CHANGELOG, '0.6.0'), '- API keys\n- More');
  assert.equal(releaseNotes(CHANGELOG, '0.5.0'), '- Images');
  assert.equal(releaseNotes(CHANGELOG, '0.10.0'), '- Ten', 'the last entry runs to the end');
  assert.equal(releaseNotes(CHANGELOG, '0.1.0'), 'OpenVorld 0.1.0', '0.1.0 is not 0.10.0, and a missing entry still gives a line');
  assert.equal(releaseNotes(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version).startsWith('- '), true, 'the current version has an entry');
});

test('the desktop workflow builds three systems, then publishes one versioned release', () => {
  const wf = YAML.parse(fs.readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8'));
  assert.deepEqual(wf.jobs.build.strategy.matrix.os.length, 3);
  assert.equal(wf.jobs.release.needs, 'build');
  assert.equal(wf.jobs.release.permissions.contents, 'write', 'only the release job may write');
  assert.equal(wf.permissions.contents, 'read');
  const text = fs.readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  assert.match(text, /name: 'OpenVorld-\$\{\{ steps\.version\.outputs\.version \}\}-\$\{\{ matrix\.os \}\}'/, 'artifacts are versioned');
  assert.match(text, /gh release create "\$\{TAG\}"/); assert.match(text, /--clobber/); assert.match(text, /SHA256SUMS\.txt/);
  assert.match(text, /TAG="v\$\{VERSION\}"/, 'the tag is v<package version>');
  assert.ok('release' in wf.on.workflow_dispatch.inputs && wf.on.push.tags.includes('v*'));
  assert.match(fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'), /artifactName: .*\$\{version\}.*\$\{os\}.*\$\{arch\}/, 'files carry the version');
});
