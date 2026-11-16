import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './release-notes.mjs';
import { verifyMac } from '../desktop/verify-mac.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export function desktopBuildOptions({ platform, arch, distribution = false, env = {} }) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Desktop builds support x64 or arm64.');
  const clean = { ...env };
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_KEYCHAIN_PROFILE', 'APPLE_KEYCHAIN']) if (!clean[key]) delete clean[key];
  const args = [`--${arch}`, '--publish', 'never', `--config.publish.channel=latest-${arch}`];
  if (platform === 'darwin') {
    const identity = clean.CSC_NAME;
    const notarization = Boolean(clean.APPLE_KEYCHAIN_PROFILE || (clean.APPLE_ID && clean.APPLE_APP_SPECIFIC_PASSWORD && clean.APPLE_TEAM_ID) || (clean.APPLE_API_KEY && clean.APPLE_API_KEY_ID && clean.APPLE_API_ISSUER));
    if (distribution && (!identity?.startsWith('Developer ID Application:') || !notarization)) throw new Error('Public Mac releases require a Developer ID Application identity and notarization credentials. Configure MAC_CERTIFICATE, MAC_SIGNING_IDENTITY and Apple notarization before publishing.');
    if (clean.CSC_LINK && !identity) throw new Error('MAC_SIGNING_IDENTITY must name the Developer ID Application certificate.');
    if (identity) args.push(`--config.mac.identity=${identity}`, '--config.mac.hardenedRuntime=true', `--config.mac.notarize=${notarization}`, '--config.forceCodeSigning=true');
  }
  return { args, env: clean };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--arch');
  const arch = i >= 0 ? process.argv[i + 1] : process.arch;
  const distribution = process.argv.includes('--distribution') || process.env.OPENVORLD_DISTRIBUTION === 'true';
  const options = desktopBuildOptions({ platform: process.platform, arch, distribution, env: process.env });
  const run = (script, args = []) => {
    const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, env: options.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  };
  run('node_modules/vite/bin/vite.js', ['build', '--config', 'engine/client/vite.config.mjs']);
  run('desktop/make-icons.mjs');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  const notes = path.join(root, 'release/release-notes.md');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  fs.writeFileSync(notes, releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version));
  run('node_modules/electron-builder/cli.js', [...options.args, `--config.releaseInfo.releaseNotesFile=${notes}`]);
  if (process.platform === 'darwin') console.log(JSON.stringify(verifyMac(path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'OpenVorld.app'), { distribution, arch, version })));
}
