// The version lives in package.json, package-lock.json and the top of CHANGELOG.md: they must agree, and the bump tool keeps them so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextVersion, addChangelog } from '../tools/bump-version.mjs';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));

test('package.json, package-lock.json and the newest CHANGELOG entry carry the same version', () => {
  const v = json('package.json').version;
  assert.match(v, /^\d+\.\d+\.\d+$/);
  const lock = json('package-lock.json');
  assert.equal(lock.version, v, 'package-lock.json'); assert.equal(lock.packages[''].version, v, 'package-lock.json packages[""]');
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.equal(log.match(/^## (\d+\.\d+\.\d+)/m)?.[1], v, 'the newest CHANGELOG.md entry');
});

test('the bump tool: patch, minor, exact, and never 1.0 by accident', () => {
  assert.equal(nextVersion('0.3.0', 'patch'), '0.3.1'); assert.equal(nextVersion('0.3.7', 'minor'), '0.4.0');
  assert.equal(nextVersion('0.3.0', '1.0.0'), '1.0.0');
  assert.throws(() => nextVersion('0.3.0', 'major'), /patch, minor or an exact version/);
});

test('a bump writes a dated entry above the newest one', () => {
  const out = addChangelog('# Changelog\n\nintro\n\n## 0.3.0 - 2026-01-01\n\n- old\n', '0.3.1', ['Fix a thing'], '2026-02-02');
  assert.match(out, /intro\n\n## 0\.3\.1 - 2026-02-02\n\n- Fix a thing\n\n## 0\.3\.0/);
});
