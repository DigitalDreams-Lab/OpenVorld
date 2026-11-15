// The models a provider offers, for the model pickers (Settings, a crew member's settings). Where the list comes from is data
// (providers.yaml > models.source): `static` values, a CLI `command` that prints them, an HTTP `endpoint` of the configured
// server, or `settings` (only what the founder typed). The tier defaults and any model already chosen are always included.
// Nothing here sends a prompt or a secret anywhere but to the endpoint the founder configured, and it never returns a key.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const cache = new Map();           // key -> { at, value }
const TTL = 60_000;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 8000, maxBuffer: 1 << 20, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : String(stdout)));
});

/** `agy models` / `opencode models` print one model per line (sometimes "id  description"). */
const parseLines = (text) => String(text ?? '').split('\n').map((l) => l.trim().split(/\s{2,}|\t/)[0]).filter((l) => l && !/^[-=#]/.test(l) && !/\s/.test(l)).slice(0, 300);

/** A JSON file a tool keeps itself (Codex: ~/.codex/models_cache.json): `list` names the array, `key` the field, `hide_when` skips entries. */
function fromFile(spec) {
  try {
    const file = String(spec.path ?? '').replace(/^~(?=\/|$)/, os.homedir());
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hide = Object.entries(spec.hide_when ?? {});
    return (spec.list ? data[spec.list] : data).filter((m) => !hide.some(([k, v]) => m?.[k] === v)).map((m) => (typeof m === 'string' ? m : m?.[spec.key ?? 'id'])).filter(Boolean).map(String).slice(0, 300);
  } catch { return null; }
}

async function fromEndpoint(def, inst, env, fetcher) {
  const base = String(inst?.base_url ?? (def.id === 'anthropic-api' ? 'https://api.anthropic.com' : '')).replace(/\/+$/, '');
  if (!base) return null;
  const key = inst?.api_key_env ? env[inst.api_key_env] : env.ANTHROPIC_API_KEY;
  const headers = def.id === 'anthropic-api' ? { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' } : key ? { authorization: `Bearer ${key}` } : {};
  if (def.id === 'anthropic-api' && !key) return null;
  try {
    const r = await fetcher(`${base}${def.models.path ?? '/models'}`, { headers, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data ?? j.models ?? []).map((m) => (typeof m === 'string' ? m : m.id ?? m.name)).filter(Boolean).map(String).slice(0, 500);
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {string} o.id provider id; o.def its providers.yaml entry; o.instance the world's configured instance (or undefined)
 * @param {string[]} [o.current] model names that must stay selectable (what is chosen now)
 * @returns {Promise<{ source: string, models: string[], tiers: Record<string,string> }>}
 */
export async function listModels({ id, def, instance, current = [], env = process.env, fetcher = fetch, exec = run }) {
  const spec = def?.models ?? {};
  const key = `${id}|${instance?.name ?? ''}|${instance?.base_url ?? ''}`;
  let live = cache.get(key);
  if (!live || Date.now() - live.at > TTL) {
    let list = null;
    if (spec.source === 'static') list = spec.values ?? [];
    else if (spec.source === 'command') { const [cmd, ...args] = spec.command ?? []; const out = cmd ? await exec(cmd, args) : null; list = out ? parseLines(out) : null; }
    else if (spec.source === 'file') list = fromFile(spec);
    else if (spec.source === 'endpoint') list = await fromEndpoint({ ...def, id }, instance, env, fetcher);
    live = { at: Date.now(), value: list };
    cache.set(key, live);
  }
  const tiers = { ...(spec.tiers ?? {}), ...(instance?.models ?? {}) };
  const models = [...new Set([...(live.value ?? []), ...Object.values(tiers), ...current].filter(Boolean))];
  return { source: spec.source ?? 'settings', live: live.value != null, models, tiers };
}
