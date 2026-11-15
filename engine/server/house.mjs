// The HOUSE: every crew member's fixed, private home inside the vorld (<vorld>/houses/<member>/). It never moves, and no
// folder writ can ever reach it. Its VAULT holds what the member needs to get into places on the founder's behalf:
//   vault/secrets.env   named secrets (API keys, OAuth tokens, ...), one NAME="value" per line
//   vault/session.json  the founder's browser sign-ins for this member (see browser.mjs)
//
// The founder fills the vault (Settings of the member); the member only ever sees secret NAMES. A secret is usable only
// with a `secret.use` writ for that name:
//   - the engine's command tool swaps %NAME% for the value when it starts the command, and hides the value in the output
//     before the model sees it (API brains: the model never learns the value);
//   - Claude Code and Codex get the secrets they hold a writ for as environment variables ($NAME in their shell). Their
//     shell can print them, so the founder grants these one by one; values are still hidden in the chat and transcript.
import fs from 'node:fs';
import path from 'node:path';
import { grantsOf } from './gate.mjs';

const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
export const MIN_SECRET = 6;                 // shorter values cannot be hidden reliably in text
const MAX_SECRET = 8000;

export const houseDir = (ctx, id) => path.join(ctx.dir, 'houses', String(id));
/** The member's vault folder (created owner-only on first use). */
export function vaultDir(ctx, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id))) bad('bad crew member id');
  const dir = path.join(houseDir(ctx, id), 'vault');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
const envFile = (ctx, id) => path.join(vaultDir(ctx, id), 'secrets.env');

function readAll(ctx, id) {
  const out = new Map();
  let text = '';
  try { text = fs.readFileSync(envFile(ctx, id), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    try { value = JSON.parse(m[2]); } catch { /* a hand-written plain value */ }
    out.set(m[1], String(value));
  }
  return out;
}
function writeAll(ctx, id, map) {
  const body = [...map].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(envFile(ctx, id), `# Secrets of one crew member. Edit through OpenVorld; never share this file.\n${body}\n`, { mode: 0o600 });
}

/** Names of the member's secrets (never the values). */
export const listSecrets = (ctx, id) => [...readAll(ctx, id)].map(([name, value]) => ({ name, length: value.length })).sort((a, b) => a.name.localeCompare(b.name));
export const hasSecret = (ctx, id, name) => readAll(ctx, id).has(name);

export function setSecret(ctx, id, name, value) {
  const n = String(name ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!SECRET_NAME.test(n)) bad('name the secret in capitals, like YT_CLIENT_SECRET (3 to 64 letters, digits or _)');
  const v = String(value ?? '');
  if (v.length < MIN_SECRET) bad(`a secret must be at least ${MIN_SECRET} characters`);
  if (v.length > MAX_SECRET) bad('that secret is too long');
  const all = readAll(ctx, id);
  if (!all.has(n) && all.size >= 64) bad('a vault holds at most 64 secrets');
  all.set(n, v);
  writeAll(ctx, id, all);
  return n;
}
export function removeSecret(ctx, id, name) {
  const all = readAll(ctx, id);
  if (!all.delete(name)) bad('no such secret', 404);
  writeAll(ctx, id, all);
}

/** Secrets the member may use: it holds a secret.use writ for the name and the vault has it. { NAME: value } */
export function heldSecrets(ctx, role) {
  const held = new Set(grantsOf(ctx, role).filter((g) => g.capability === 'secret.use').map((g) => g.scope));
  const out = {};
  for (const [k, v] of readAll(ctx, role)) if (held.has(k)) out[k] = v;
  return out;
}

/**
 * Swap %NAME% in each argument for the secret's value. A placeholder naming a secret the member has no writ for asks
 * for one (`onRequest`) and throws; a %WORD% that is not a secret in the vault is left alone (URLs have % in them).
 */
export function substitute(ctx, role, args, onRequest = () => {}) {
  const all = readAll(ctx, role), held = heldSecrets(ctx, role);
  return args.map((arg) => String(arg).replace(/%([A-Z][A-Z0-9_]{2,63})%/g, (whole, name) => {
    if (!all.has(name)) return whole;
    if (!(name in held)) {
      onRequest({ capability: 'secret.use', scope: name, why: `use the secret ${name} in a command` });
      throw new Error(`no writ to use the secret ${name}. The founder has been asked; wait for their answer`);
    }
    return held[name];
  }));
}

/** Hide every value of the member's vault in a piece of text: the value becomes $NAME. */
export function redactSecrets(ctx, role, text) {
  let out = String(text ?? '');
  if (!out) return out;
  const all = [...readAll(ctx, role)].sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of all) if (value.length >= MIN_SECRET && out.includes(value)) out = out.split(value).join(`$${name}`);
  return out;
}

/** Hide vault values in the text fields of a driver event (what the chat, the transcript and the game will see). */
export function redactEvent(ctx, role, e) {
  const out = { ...e };
  for (const k of ['text', 'output', 'target']) if (typeof out[k] === 'string') out[k] = redactSecrets(ctx, role, out[k]);
  if (out.detail && typeof out.detail === 'object') {
    out.detail = { ...out.detail };
    for (const k of ['note', 'write']) if (typeof out.detail[k] === 'string') out.detail[k] = redactSecrets(ctx, role, out.detail[k]);
  }
  return out;
}

/** The vault paragraph of a member's system prompt: names only, and how to use the ones it may. Empty when the vault is empty. */
export function vaultHelp(ctx, role) {
  const names = listSecrets(ctx, role).map((s) => s.name);
  if (!names.length) return '';
  const held = Object.keys(heldSecrets(ctx, role));
  const text = ctx.interactions?.agent?.vault?.instructions ?? '';
  return text.replace(/\{names\}/g, names.join(', ')).replace(/\{held\}/g, held.join(', ') || 'none yet');
}
