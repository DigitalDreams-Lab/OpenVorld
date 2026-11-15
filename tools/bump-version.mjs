#!/usr/bin/env node
// Bump the version of OpenVorld: package.json, package-lock.json and a new CHANGELOG.md entry, in one go.
//   npm run bump -- patch "Fix the Brain list when the server restarts"
//   npm run bump -- minor "Eight-direction characters"
//   npm run bump -- 0.4.0 "..."            (an exact version)
// Every commit bumps the version (see CONTRIBUTING.md > Versioning): patch = fixes, polish, art and docs; minor = anything new,
// and anything that changes a data or pack format (while we are below 1.0, "breaking" is a minor). 1.0.0 is for a stable release,
// so it is never reached by accident: give it as an exact version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const write = (f, o) => fs.writeFileSync(path.join(root, f), JSON.stringify(o, null, 2) + '\n');

export function nextVersion(current, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [a, b, c] = current.split('.').map(Number);
  if (how === 'patch') return `${a}.${b}.${c + 1}`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  throw new Error(`Say patch, minor or an exact version like 0.4.0 (got "${how}"). 1.0.0 is only ever given exactly.`);
}

/** Insert `## version - date` with one line per change above the newest entry. */
export function addChangelog(text, version, notes, date = new Date().toISOString().slice(0, 10)) {
  const entry = `## ${version} - ${date}\n\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`;
  const i = text.search(/^## /m);
  return i < 0 ? `${text.trimEnd()}\n\n${entry}` : text.slice(0, i) + entry + text.slice(i);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [how, ...notes] = process.argv.slice(2);
  if (!how || !notes.length) { console.error('usage: npm run bump -- <patch|minor|x.y.z> "what changed" ["another change"]'); process.exit(2); }
  const pkg = read('package.json'), lock = read('package-lock.json'), version = nextVersion(pkg.version, how);
  pkg.version = version; lock.version = version; if (lock.packages?.['']) lock.packages[''].version = version;
  write('package.json', pkg); write('package-lock.json', lock);
  const log = path.join(root, 'CHANGELOG.md');
  fs.writeFileSync(log, addChangelog(fs.readFileSync(log, 'utf8'), version, notes));
  console.log(`version ${version}`);
}
