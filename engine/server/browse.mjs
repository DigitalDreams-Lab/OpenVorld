// Folder browsing for the founder's folder picker. Lists folder NAMES only (never file contents), marks which
// folders a writ could actually be granted (the capability's never-list and "too broad" rules still apply), and can
// open the operating system's own folder dialog. All options come from packs/core/permissions.yaml > browse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { checkFolder } from './gate.mjs';

const home = os.homedir();
const expand = (p) => String(p ?? '').replace(/^~(?=\/|$)/, home);
const tidy = (p) => path.resolve(expand(p));

export const browseConfig = (ctx) => ctx.packs.byKind.permissions?.permissions?.browse ?? {};

/** What can be shown for a folder: its sub-folders (selectable or not), its parent and the quick-start roots. */
export function browseFolder(ctx, { dir, capability = 'fs.write' } = {}) {
  const cfg = browseConfig(ctx), cap = capability === 'fs.read' ? 'fs.read' : 'fs.write';
  const roots = (cfg.roots ?? []).map((r) => ({ name: r.name, path: tidy(r.path) })).filter((r) => { try { return fs.statSync(r.path).isDirectory(); } catch { return false; } });
  let abs = tidy(dir || home);
  try { if (!fs.statSync(abs).isDirectory()) abs = path.dirname(abs); } catch { abs = home; }
  const selectable = (p) => { try { checkFolder(ctx, cap, p); return true; } catch { return false; } };
  let entries = [], error = null;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(abs, d.name)))) && !(cfg.hide_dotfolders !== false && d.name.startsWith('.')))
      .map((d) => ({ name: d.name, path: path.join(abs, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .slice(0, cfg.max_entries ?? 400)
      .map((e) => ({ ...e, ok: selectable(e.path) }));
  } catch (e) { error = e.code === 'EACCES' || e.code === 'EPERM' ? 'This folder is private to the system.' : 'This folder can\'t be opened.'; }
  const parent = abs === path.parse(abs).root ? null : path.dirname(abs);
  return { path: abs, parent, home, roots, entries, ok: selectable(abs), error, native: cfg.native_dialog !== false ? (nativeDialog()?.label ?? null) : null };
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The system's own folder dialog: Finder (macOS), Explorer (Windows), zenity or kdialog (Linux). Cached. */
let native;
export function nativeDialog() {
  if (native !== undefined) return native;
  const has = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (process.platform === 'darwin') native = { cmd: 'osascript', label: 'Finder' };
  else if (process.platform === 'win32') native = { cmd: 'powershell', label: 'Explorer' };
  else native = has('zenity') ? { cmd: 'zenity', label: 'file manager' } : has('kdialog') ? { cmd: 'kdialog', label: 'file manager' } : null;
  return native;
}
const nativeCommand = () => nativeDialog()?.cmd ?? null;

/** Opens the system folder dialog. Resolves the chosen path, or null when the founder cancels. */
export function pickNative(prompt = 'Choose a folder', start) {
  const dialog = nativeDialog();
  if (!dialog) return Promise.reject(Object.assign(new Error('This computer has no folder dialog; type the folder path instead.'), { status: 501 }));
  const clean = String(prompt).replace(/[^\p{L}\p{N} .,'-]/gu, '').slice(0, 80) || 'Choose a folder';
  let from = home;
  if (start) {
    const target = tidy(start);
    try {
      if (!fs.existsSync(target)) {
        const parent = path.dirname(target);
        if (isDir(parent)) {
          fs.mkdirSync(target, { recursive: true });
        }
      }
    } catch { /* ignore creation error */ }
    let cur = target;
    while (cur && cur !== path.dirname(cur)) {
      if (isDir(cur)) { from = cur; break; }
      cur = path.dirname(cur);
    }
  }
  const escapedFrom = from.replace(/["\\]/g, '');
  const osaScript = `try\nset loc to (POSIX file "${escapedFrom}" as alias)\nPOSIX path of (choose folder with prompt "${clean}" default location loc)\non error\nPOSIX path of (choose folder with prompt "${clean}")\nend try`;
  const run = {
    osascript: ['osascript', ['-e', osaScript]],
    powershell: ['powershell', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${clean.replace(/'/g, "''")}'; $d.SelectedPath = '${from.replace(/'/g, "''")}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`]],
    zenity: ['zenity', ['--file-selection', '--directory', `--title=${clean}`, `--filename=${from}/`]],
    kdialog: ['kdialog', ['--getexistingdirectory', from, '--title', clean]],
  }[dialog.cmd];
  return new Promise((resolve, reject) => {
    execFile(run[0], run[1], { timeout: 5 * 60_000 }, (err, out, errOut) => {
      if (err) return (err.code === 1 || /User canceled|-128/.test(`${errOut}${err.message}`)) ? resolve(null) : reject(Object.assign(new Error('The folder dialog could not open.'), { status: 500 }));
      resolve(out.trim().replace(/[\\/]$/, '') || null);
    });
  });
}
