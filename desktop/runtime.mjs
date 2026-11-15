// Shared desktop configuration; kept independent of Electron so it can be tested in Node.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function readSettings(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`Could not read desktop settings: ${error.message}`); }
}

export function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

export function dataHome({ env = process.env, settings = {}, root, development = false, home = os.homedir() }) {
  if (env.OPENVORLD_HOME) return path.resolve(env.OPENVORLD_HOME);
  if (settings.home) return path.resolve(settings.home);
  if (development) {
    const local = readSettings(path.join(root, '.openvorld-dev.json'));
    if (local.home) return path.resolve(root, local.home);
  }
  return path.join(home, '.openvorld');
}

/** Finder launches with a minimal PATH; retain the user's login-shell CLI locations. */
export function desktopPath(env = process.env, platform = process.platform) {
  if (platform === 'win32') return env.PATH ?? env.Path ?? '';
  let loginPath = '';
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    const output = execFileSync(shell, ['-ilc', 'printf "\\n__OPENVORLD_PATH__%s\\n" "$PATH"'], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    loginPath = output.split('__OPENVORLD_PATH__').at(-1)?.split('\n')[0] ?? '';
  } catch { /* Pack-defined CLI folders still provide a fallback. */ }
  return [...new Set([loginPath, env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).flatMap(p => p.split(':')))].join(':');
}

export function engineEnvironment({ env = process.env, home, token, executable, cliPath }) {
  const result = { ...env, OPENVORLD_HOME: home, OV_PORT: '0', OV_TOKEN: token,
    OV_DESKTOP: '1', OV_NODE_EXECUTABLE: executable, ELECTRON_RUN_AS_NODE: '1', PATH: cliPath };
  // A development proxy host and inherited Node flags must not affect a packaged engine.
  delete result.OV_DEV_HOSTS; delete result.NODE_OPTIONS; delete result.NODE_PATH;
  delete result.Path;
  return result;
}

export function isAppUrl(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}
export function isExternalUrl(value) {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
