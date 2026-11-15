// Writs: grants per crew member, checked against the never-lists in packs/core/permissions.yaml.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { readYaml } from '../../tools/lib/packs.mjs';

const file = (ctx) => path.join(ctx.dir, 'grants.yaml');
/** This server run: "session" grants last until the game closes (a restart starts a new session). */
export const BOOT = crypto.randomUUID();
const live = (g) => !g.session || g.session === BOOT;
export const listGrants = (ctx) => (fs.existsSync(file(ctx)) ? readYaml(file(ctx))?.grants ?? [] : []).filter(live);

function save(ctx, grants) {
  fs.writeFileSync(file(ctx), YAML.stringify({ kind: 'grants', version: 1, grants }), { mode: 0o600 });
}
function audit(ctx, entry) {
  fs.appendFileSync(path.join(ctx.dir, 'audit.log'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
}

const expand = (p, ctx) => p.replace(/^~(?=\/|$)/, os.homedir()).replace('<vorld>', ctx.dir);
function globToRe(g) {
  return new RegExp('^' + g.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
}

/** Validate a folder the founder picked for an fs grant. Returns the normalized path or throws. */
export function checkFolder(ctx, capability, folder) {
  const caps = ctx.packs.byKind.permissions?.permissions?.capabilities ?? {};
  const abs = path.resolve(expand(String(folder || ''), ctx));
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!folder) bad('pick a folder');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) bad(`not a folder: ${abs}`);
  // a crew member's house (and the vault in it) is private for good: no folder writ may hold it or contain it
  const houses = path.join(ctx.dir, 'houses');
  if (abs === houses || abs.startsWith(houses + path.sep) || houses.startsWith(abs + path.sep)) bad('this folder holds crew members\' private houses and can never be shared');
  if (abs === '/' || abs === os.homedir() || abs.split(path.sep).length < 3) bad('that folder is too broad; pick a project folder');
  for (const n of caps[capability]?.never ?? []) {
    const re = globToRe(expand(n, ctx));
    if (re.test(abs) || re.test(abs + '/x')) bad(`this folder can never be granted (${n})`);
  }
  return abs;
}

export function grant(ctx, { role, capability, scope, answer = 'always' }) {
  // once: lasts for the crew member's next turn; session: until the game closes; always: until revoked
  const g = { id: crypto.randomUUID(), role, capability, scope, answer, at: new Date().toISOString(), ...(answer === 'session' ? { session: BOOT } : {}), ...(answer === 'once' ? { once: true } : {}) };
  save(ctx, [...listGrants(ctx), g]);
  audit(ctx, { action: 'grant', ...g });
  return g;
}
export function revoke(ctx, id) {
  const grants = listGrants(ctx);
  save(ctx, grants.filter((g) => g.id !== id));
  audit(ctx, { action: 'revoke', id });
}
export function deny(ctx, { role, capability, scope }) {
  audit(ctx, { action: 'deny', role, capability, scope });
}
export const grantsOf = (ctx, role) => listGrants(ctx).filter((g) => g.role === role);
/** "Allow once" grants end with the turn that used them. */
export function consumeOnce(ctx, role) {
  const all = listGrants(ctx), keep = all.filter((g) => !(g.once && g.role === role));
  if (keep.length !== all.length) { save(ctx, keep); audit(ctx, { action: 'expire_once', role }); }
}
/** True when the crew member already holds this exact capability and scope. */
export const holds = (ctx, role, capability, scope) => grantsOf(ctx, role).some((g) => g.capability === capability && (g.scope === scope || g.scope.replace(/\/\*\*$/, '') === scope));

/** Normalise and check what a crew member asks for. Throws a 400 with a plain reason when it can never be granted. */
export function checkScope(ctx, capability, scope) {
  const caps = ctx.packs.byKind.permissions?.permissions?.capabilities ?? {};
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!caps[capability]) bad(`unknown capability ${capability}`);
  const s = String(scope ?? '').trim();
  if (capability === 'fs.read' || capability === 'fs.write') {
    let abs = path.resolve(expand(s, ctx));
    if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) abs = path.dirname(abs);
    return checkFolder(ctx, capability, abs);
  }
  if (capability === 'cmd.run') {
    if (!s || /[;&|`$<>\n]/.test(s)) bad('a command writ names one program and its arguments');
    if (s.length > 200) bad('a command writ is a short pattern like "curl *", not a whole command line');
    // "curl" means the founder allows curl, so a bare program name is the same as "curl *" (arguments are free)
    const pattern = /^[^\s*]+$/.test(s) ? `${s} *` : s;
    if (isNever(ctx, 'cmd.run', pattern)) bad('this command can never be granted');
    return pattern;
  }
  if (capability === 'secret.use') { if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(s)) bad('name a secret like YT_CLIENT_SECRET'); return s; }
  if (capability === 'net.fetch' || capability === 'net.session' || capability === 'net.act') {
    const d = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    if (!/^(\*|[a-z0-9.-]+\.[a-z]{2,})$/.test(d)) bad('name a domain like example.com');
    if (d === '*' && capability !== 'net.fetch') bad('name one site: signed-in access is never given for every site');
    return d;
  }
  if (!s) bad('the scope is empty');
  return s.slice(0, 200);
}
export const folderGrants = (ctx, role, capability) => grantsOf(ctx, role).filter((g) => g.capability === capability).map((g) => g.scope.replace(/\/\*\*$/, ''));

/** True when a path (or command) hits the never-list of a capability in permissions.yaml. */
export function isNever(ctx, capability, value) {
  const caps = ctx.packs.byKind.permissions?.permissions?.capabilities ?? {};
  return (caps[capability]?.never ?? []).some((n) => {
    const re = globToRe(expand(n, ctx));
    return re.test(value) || re.test(value + '/x') || (capability === 'cmd.run' && new RegExp('^' + n.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value));
  });
}
/**
 * The writ pattern to ask for when a command was refused: the program, plus a plain subcommand or script when there is
 * one, and "*" for the arguments. "npm test" stays "npm test"; the long curl call becomes "curl *". Never the whole
 * command line: it can hold secrets, and a pattern that long would not match the next call anyway.
 */
export function commandPattern(command) {
  const t = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return '';
  const plain = (x) => /^[A-Za-z0-9_./~][\w./~@+-]*$/.test(x ?? '');
  if (t.length === 1) return t[0];
  if (t.length === 2 && plain(t[1])) return `${t[0]} ${t[1]}`;
  return plain(t[1]) ? `${t[0]} ${t[1]} *` : `${t[0]} *`;
}
/** A command line for showing to the founder: values that look like secrets are hidden. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(bearer|basic)\s+[^\s"']+/gi, '$1 •••')
    .replace(/((?:client_)?secret|token|api[_-]?key|apikey|key|password|passwd)(["']?\s*[=:]\s*|\s+)(["']?)[^\s"']+/gi, '$1$2$3•••');
}
/** cmd.run scopes are command patterns: "*" matches any run of characters. */
export const commandMatches = (scope, command) => new RegExp('^' + String(scope).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(command);
export const capabilityLimit = (ctx, capability, key) => ctx.packs.byKind.permissions?.permissions?.capabilities?.[capability]?.[key];
