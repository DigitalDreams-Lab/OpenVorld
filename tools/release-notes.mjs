#!/usr/bin/env node
// The release notes of one version: its section of CHANGELOG.md.   node tools/release-notes.mjs 0.6.0
// Used by the desktop workflow to describe the GitHub release it publishes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The lines under `## <version> - date`, up to the next `## `. Falls back to a plain line when the version has no entry. */
export function releaseNotes(changelog, version) {
  const lines = String(changelog).split('\n'), start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return `OpenVorld ${version}`;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() || `OpenVorld ${version}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  console.log(releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version));
}
