#!/usr/bin/env node
// Pre-commit check (see .githooks/pre-commit): a commit that changes anything must bump the version and say why in CHANGELOG.md.
// Skip once with SKIP_VERSION_BUMP=1 git commit ... (merges, reverts and rebases are skipped automatically).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
if (process.env.SKIP_VERSION_BUMP) process.exit(0);
const gitDir = git('rev-parse', '--git-dir').trim();
if (['MERGE_HEAD', 'REVERT_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'].some((f) => fs.existsSync(`${gitDir}/${f}`))) process.exit(0);
const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
if (!staged.length) process.exit(0);
const versionChanged = /^[+]\s+"version":/m.test(git('diff', '--cached', '-U0', '--', 'package.json'));
const logChanged = staged.includes('CHANGELOG.md');
if (versionChanged && logChanged) process.exit(0);
console.error(`
This commit does not bump the version${versionChanged ? '' : ' (package.json)'}${logChanged ? '' : ' or add a CHANGELOG.md entry'}.
Every commit bumps the version, by what changed:
  patch  fixes, polish, art, docs            npm run bump -- patch "what changed"
  minor  anything new, or a changed data/pack format
Then \`git add package.json package-lock.json CHANGELOG.md\` and commit again.   (SKIP_VERSION_BUMP=1 skips this once.)
`);
process.exit(1);
