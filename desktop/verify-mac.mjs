// Read-only bundle checks. Distribution verification never bypasses Gatekeeper.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function verifyMac(appPath, { distribution = false, arch = process.arch, version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, run = spawnSync } = {}) {
  const bundle = path.resolve(appPath);
  const check = (command, args, label) => {
    const result = run(command, args, { encoding: 'utf8', timeout: 45000 });
    if (result.error || result.status !== 0) throw new Error(`${label}: ${result.error?.message || result.stderr || result.stdout || 'check failed'}`);
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  };
  check('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], 'The Mac app signature is invalid');
  const installedVersion = check('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(bundle, 'Contents/Info.plist')], 'Could not read the Mac app version').trim();
  if (installedVersion !== version) throw new Error(`Mac app version is ${installedVersion}, expected ${version}`);
  const architectures = check('/usr/bin/lipo', ['-archs', path.join(bundle, 'Contents/MacOS/OpenVorld')], 'Could not read the Mac app architecture').trim().split(/\s+/);
  if (!architectures.includes(arch === 'x64' ? 'x86_64' : arch)) throw new Error(`Mac app does not contain ${arch}`);
  if (distribution) {
    const signature = check('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], 'Could not read the distribution signature');
    if (!/Authority=Developer ID Application:/.test(signature) || !/TeamIdentifier=[A-Z0-9]{10}\b/.test(signature) || !/flags=.*\bruntime\b/.test(signature)) throw new Error('Public Mac releases require Developer ID Application signing and Hardened Runtime. Ad-hoc signatures are only for local development.');
    check('/usr/bin/xcrun', ['stapler', 'validate', bundle], 'The Mac app is missing a valid Apple notarization ticket');
    check('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle], 'Gatekeeper rejected the Mac app');
  }
  return { version, arch, distribution, signature: 'valid', ...(distribution ? { notarization: 'valid', gatekeeper: 'accepted' } : {}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') throw new Error('Mac verification must run on macOS.');
  const bundle = process.argv.slice(2).find(value => !value.startsWith('--'));
  if (!bundle) throw new Error('Provide the path to OpenVorld.app.');
  console.log(JSON.stringify(verifyMac(bundle, { distribution: process.argv.includes('--distribution') })));
}
