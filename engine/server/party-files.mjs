// A party's shared folder: where the founder and the members leave files for each other, kept after the party is gone.
// Files: <vorld>/parties/<id>/shared/. OpenVorld only carries the files and says where they are; each member opens them
// with its own file tools, whatever it is (a CLI harness, an API model). Members never get write access for this: the engine
// copies into the folder what is shared in the room (attachments, screenshots) and the files a member names in its reply.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { getAttachment } from './attachments.mjs';
import { readEvents } from './threads.mjs';
import { isNever } from './gate.mjs';

export const sharedDir = (ctx, partyId) => path.join(ctx.dir, 'parties', partyId, 'shared');
export function ensureShared(ctx, partyId) {
  const dir = sharedDir(ctx, partyId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const cfgOf = (ctx) => ({ copy_max_mb: 50, listed: 30, ...(ctx.interactions.agent?.party?.shared ?? {}) });
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'someone';
const safeName = (n) => String(n ?? 'file').split(/[\\/]/).at(-1).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';

/** Copy one file into the shared folder as <who>-<key>-<name> (the same file is never copied twice). Null when it is too big or not a file. */
function copyIn(ctx, partyId, who, src, key, name) {
  let stat; try { stat = fs.statSync(src); } catch { return null; }
  if (!stat.isFile() || stat.size > cfgOf(ctx).copy_max_mb * 1024 * 1024) return null;
  const dir = ensureShared(ctx, partyId), shared = `${slug(who)}-${key}-${safeName(name ?? path.basename(src))}`, dest = path.join(dir, shared);
  if (!fs.existsSync(dest)) { try { fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL); fs.chmodSync(dest, 0o600); } catch (e) { if (e.code !== 'EEXIST') return null; } }
  return { name: shared, path: dest };
}

/**
 * Everything attached in a room (the founder's files, and pictures or files that came out of a member's tools) copied into
 * the shared folder. Returns attachment id -> { name, path } for the lines the room shows. Files the founder only pointed at
 * (references) stay where they are.
 */
export function syncAttachments(ctx, partyId, tid, nameOf) {
  const found = new Map();
  const add = (who, list) => {
    for (const a of list ?? []) {
      if (!a?.id || found.has(a.id)) continue;
      let f; try { f = getAttachment(ctx, tid, a.id); } catch { continue; }
      if (f.kind === 'reference') continue;
      const copy = copyIn(ctx, partyId, who, f.path, a.id.slice(0, 6), f.name);
      if (copy) found.set(a.id, copy);
    }
  };
  for (const e of readEvents(ctx, tid)) {
    if (e.type === 'founder.message') add('founder', e.attachments);
    else if (e.type === 'agent.text') for (const s of e.steps ?? []) add(nameOf(e.role), s.attachments);
  }
  return found;
}

/** The files a member named in its reply, copied in when it may read them itself (its own folders, never a never-listed path). */
export function shareFiles(ctx, partyId, who, requested, readRoots) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const roots = readRoots.map(real).filter(Boolean), out = [];
  for (const raw of requested ?? []) {
    const abs = real(path.resolve(String(raw).replace(/^~(?=\/|$)/, process.env.HOME ?? '~')));
    if (!abs || !roots.some((r) => abs === r || abs.startsWith(r + path.sep)) || isNever(ctx, 'fs.read', abs)) continue;
    const stat = fs.statSync(abs);
    const copy = copyIn(ctx, partyId, who, abs, crypto.createHash('sha1').update(`${abs}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 6), path.basename(abs));
    if (copy) out.push(copy.name);
  }
  return out;
}

/** Names of the files in the shared folder, newest first. */
export function listShared(ctx, partyId) {
  const dir = sharedDir(ctx, partyId);
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, at: fs.statSync(path.join(dir, d.name)).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, cfgOf(ctx).listed).map((f) => f.name);
  } catch { return []; }
}

/** Show the folder in the computer's file manager. */
export function openShared(ctx, partyId) {
  const dir = ensureShared(ctx, partyId);
  const [cmd, args] = process.platform === 'darwin' ? ['open', [dir]] : process.platform === 'win32' ? ['explorer', [dir]] : ['xdg-open', [dir]];
  try { const child = spawn(cmd, args, { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); } catch { /* no file manager: the path is returned */ }
  return dir;
}
