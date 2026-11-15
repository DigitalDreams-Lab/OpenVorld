// Install the locally built app for this user; never needs sudo or changes Gatekeeper settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings } from './runtime.mjs';
if (process.platform !== 'darwin') throw new Error('This installer is for macOS. Use desktop:dist on Windows or Linux.');
const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'OpenVorld.app');
if (!fs.existsSync(source)) throw new Error('Build the app first: npm run desktop:pack');
const applications = path.join(os.homedir(), 'Applications'), destination = path.join(applications, 'OpenVorld.app');
fs.mkdirSync(applications, { recursive: true });
let backup;
if (fs.existsSync(destination)) {
  backup = path.join(applications, `.OpenVorld-backup-${Date.now()}.app`);
  fs.renameSync(destination, backup);
}
try { execFileSync('/usr/bin/ditto', [source, destination]); }
catch (error) {
  fs.rmSync(destination, { recursive: true, force: true });
  if (backup) fs.renameSync(backup, destination);
  throw error;
}
// each backup is a full copy of the previous app: keep the two newest, remove older ones (only files this installer made, by name)
for (const name of fs.readdirSync(applications).filter((n) => /^\.OpenVorld-backup-\d+\.app$/.test(n)).sort().slice(0, -2)) fs.rmSync(path.join(applications, name), { recursive: true, force: true });
const settingsFile = path.join(os.homedir(), 'Library', 'Application Support', 'OpenVorld', 'desktop.json');
const settings = readSettings(settingsFile), local = readSettings(path.join(root, '.openvorld-dev.json'));
const i = process.argv.indexOf('--home');
const chosen = i >= 0 ? process.argv[i + 1] : !settings.home && local.home ? path.resolve(root, local.home) : null;
if (chosen) {
  const home = path.resolve(chosen);
  if (!fs.existsSync(home) || !fs.statSync(home).isDirectory()) throw new Error(`Data folder does not exist: ${home}`);
  writeSettings(settingsFile, { ...settings, home });
}
const register = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
if (fs.existsSync(register)) execFileSync(register, ['-f', destination]);
console.log(`Installed: ${destination}`);
if (backup) console.log(`Previous app kept: ${backup}`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.OPENVORLD_HOME;
execFileSync('/usr/bin/open', [destination], { env });
