// Agent CLIs often live outside the PATH a dev server inherits (an app's own bin folder, ~/.gemini/bin ...).
// Packs list those folders (providers.yaml > bin_dirs, art.yaml > availability.<id>.dirs); the ones that exist are
// appended to this process's PATH once, so detection and every spawn afterwards find the CLI by name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function addCliDirs(dirs = []) {
  const have = new Set((process.env.PATH ?? '').split(path.delimiter));
  for (const raw of dirs) {
    const dir = String(raw).replace(/^~(?=$|[\\/])/, os.homedir());
    if (!have.has(dir) && fs.existsSync(dir)) { process.env.PATH = [process.env.PATH, dir].filter(Boolean).join(path.delimiter); have.add(dir); }
  }
}
