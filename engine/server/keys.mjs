// API keys of the model endpoints (OpenAI-compatible providers). The founder can give an endpoint either
//   - the NAME of an environment variable (OPENROUTER_API_KEY): read when it is used, nothing is stored; or
//   - the key itself, pasted in Settings: kept on this computer in <vorld>/provider-keys.json (owner-only), shown nowhere,
//     never sent to the browser again and never put into the vorld file, a chat or an error message.
// Anything that is not shaped like a variable name is a key, so a key pasted into the variable-name box still works and is
// moved into the store.
import fs from 'node:fs';
import path from 'node:path';

export const ENV_NAME = /^[A-Z_][A-Z0-9_]{1,63}$/;
export const looksLikeEnvName = (s) => ENV_NAME.test(String(s ?? '').trim());

const file = (ctx) => path.join(ctx.dir, 'provider-keys.json');
function read(ctx) { try { const o = JSON.parse(fs.readFileSync(file(ctx), 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function write(ctx, o) {
  if (!Object.keys(o).length) { fs.rmSync(file(ctx), { force: true }); return; }
  const tmp = `${file(ctx)}.tmp-${process.pid}`;           // written whole, then renamed
  fs.writeFileSync(tmp, JSON.stringify(o), { mode: 0o600 });
  fs.renameSync(tmp, file(ctx));
}
export const hasKey = (ctx, name) => !!read(ctx)[String(name ?? '')];
export function setKey(ctx, name, key) { const o = read(ctx); o[String(name ?? '')] = String(key).trim(); write(ctx, o); }
export function removeKey(ctx, name) { const o = read(ctx); if (String(name ?? '') in o) { delete o[String(name ?? '')]; write(ctx, o); } }

/** The key an endpoint will use: { key, missing } where `missing` names the environment variable that is not set. */
export function keyFor(ctx, inst, env = process.env) {
  const name = inst?.name ?? '', e = String(inst?.api_key_env ?? '').trim();
  if (e && !looksLikeEnvName(e)) return { key: e, missing: null };              // a key that was typed where the variable name goes
  const stored = read(ctx)[name] || null;
  if (e) { const v = env[e] || stored; return { key: v || null, missing: v ? null : e }; }
  return { key: stored, missing: null };
}

/**
 * The providers to keep in the vorld file, from what Settings sent. A typed `api_key` is a variable name or a key; a value in
 * `api_key_env` that is really a key is adopted; `remove_key` forgets the saved one. Keys never go into the returned list.
 */
export function cleanProviders(ctx, incoming) {
  const out = [];
  for (const raw of incoming) {
    const { api_key, api_key_env, remove_key, has_key, key_input, ...rest } = raw ?? {};
    const name = rest.name ?? '', typed = typeof api_key === 'string' ? api_key.trim() : '';
    let env = typeof api_key_env === 'string' ? api_key_env.trim() : '';
    if (remove_key) removeKey(ctx, name);
    if (typed) { if (looksLikeEnvName(typed)) { env = typed; removeKey(ctx, name); } else { setKey(ctx, name, typed); env = ''; } }
    else if (env && !looksLikeEnvName(env)) { setKey(ctx, name, env); env = ''; }
    out.push({ ...rest, ...(env ? { api_key_env: env } : {}) });
  }
  const names = new Set(out.map((p) => p.name ?? ''));
  const o = read(ctx); let changed = false;
  for (const n of Object.keys(o)) if (!names.has(n)) { delete o[n]; changed = true; }   // an endpoint that was removed takes its key with it
  if (changed) write(ctx, o);
  return out;
}

/**
 * A key that was typed where the variable name goes (older Settings had only that box) sits in the vorld file and, after a failed
 * turn, in an error message in the chat. Move it into the key store, blank the field and scrub the chats. Returns how many were moved.
 * `saveVorld` is passed in (vorld.mjs owns the file).
 */
export function adoptLegacyKeys(ctx, saveVorld) {
  const legacy = (ctx.doc.providers ?? []).filter((p) => p.api_key_env && !looksLikeEnvName(p.api_key_env));
  if (!legacy.length) return 0;
  for (const p of legacy) setKey(ctx, p.name ?? '', p.api_key_env);
  const dir = path.join(ctx.dir, 'threads');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const file = path.join(dir, f); let text = fs.readFileSync(file, 'utf8'), hit = false;
    for (const p of legacy) if (text.includes(p.api_key_env)) { text = text.split(p.api_key_env).join('[key removed]'); hit = true; }
    if (hit) fs.writeFileSync(file, text);
  }
  const names = new Set(legacy.map((p) => p.name));
  saveVorld(ctx, (d) => { d.providers = (d.providers ?? []).map((p) => (names.has(p.name) && p.api_key_env && !looksLikeEnvName(p.api_key_env) ? (({ api_key_env, ...rest }) => rest)(p) : p)); });
  return legacy.length;
}
