// Pack loading: every *.yaml under each pack root, indexed by (kind, id). Later roots override earlier
// ones by deep merge, so a user or vorld pack can change one value without copying a whole file.
// Roots, in order: <repo>/packs, <home>/packs, <vorld>/packs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SINGLETONS = new Set(['achievements', 'permissions', 'providers', 'defaults', 'interactions', 'default_art', 'icons', 'scenery', 'game_commands']);

export function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function homeDir(defaults) {
  const env = defaults?.home?.env && process.env[defaults.home.env];
  return path.resolve(expandHome(env || defaults?.home?.fallback || '~/.openvorld'));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith('.') ? [] : walk(p);
    return /\.ya?ml$/.test(e.name) ? [p] : [];
  });
}

export function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: invalid YAML (${err.message.split('\n')[0]})`);
  }
}

/** Deep merge: objects merge, arrays of {id} merge by id, other arrays and scalars replace. */
export function deepMerge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => x && typeof x === 'object' && 'id' in x)) {
    const out = a.map((x) => ({ ...x }));
    for (const item of b) {
      const i = out.findIndex((x) => x.id === item.id);
      if (i >= 0) out[i] = deepMerge(out[i], item); else out.push(item);
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
    return out;
  }
  return b;
}

/**
 * Load packs from the roots. Returns { byKind: {kind: {id: doc}}, sources: {"kind/id": [files]}, problems }.
 * Files whose YAML is broken or that have no `kind` are reported, not fatal, so one bad user pack
 * cannot stop the game from starting.
 */
export function loadPacks(roots) {
  const byKind = {};
  const sources = {};
  const problems = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      let doc;
      try { doc = readYaml(file); } catch (e) { problems.push({ level: 'error', msg: e.message }); continue; }
      if (!doc || typeof doc !== 'object' || !doc.kind) {
        problems.push({ level: 'warn', msg: `${file}: no "kind", ignored` });
        continue;
      }
      const id = SINGLETONS.has(doc.kind) ? doc.kind : doc.id;
      if (!id) { problems.push({ level: 'error', msg: `${file}: kind "${doc.kind}" needs an "id"` }); continue; }
      byKind[doc.kind] ??= {};
      byKind[doc.kind][id] = deepMerge(byKind[doc.kind][id], doc);
      (sources[`${doc.kind}/${id}`] ??= []).push(file);
    }
  }
  return { byKind, sources, problems };
}

export function packRoots(home, vorldDir) {
  return [path.join(REPO, 'packs'), path.join(home, 'packs'), vorldDir && path.join(vorldDir, 'packs')].filter(Boolean);
}

/** A theme with its `extends` chain applied (the parent first, the theme on top). */
export function resolveTheme(byKind, id, seen = new Set()) {
  const t = byKind.theme?.[id];
  if (!t || seen.has(id)) return t ?? null;
  seen.add(id);
  return t.extends ? deepMerge(resolveTheme(byKind, t.extends, seen) ?? {}, { ...t, id: t.id }) : t;
}
