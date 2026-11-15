// Every crew member has a folder it works in. By default it is <default space>/<member id>, where the default space is
// the world's private `workspaces/` folder unless the founder points it somewhere else in Settings. A member can also
// have a folder of its own (a project). Folders the founder chose are writable by that member (the founder's choice is
// the consent); the world's own private folders stay talk-only until a writ says more.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFolder } from './gate.mjs';

const expand = (p) => String(p ?? '').replace(/^~(?=\/|$)/, os.homedir());

/** The folder every member's own workspace lives in unless they have one of their own. */
export function defaultSpace(ctx) {
  const base = ctx.doc?.workspace?.base;
  return base ? { path: path.resolve(expand(base)), custom: true } : { path: path.join(ctx.dir, 'workspaces'), custom: false };
}

/** { path, source: 'own' | 'space' | 'world', chosen } for one crew member. `chosen` = founder picked it. */
export function workspaceOf(ctx, role) {
  const own = ctx.member?.(role)?.workspace;
  if (own) return { path: path.resolve(expand(own)), source: 'own', chosen: true };
  const space = defaultSpace(ctx);
  return { path: path.join(space.path, role), source: space.custom ? 'space' : 'world', chosen: space.custom };
}

/** Validate a folder the founder picked as a workspace or as the default space (created when missing, inside a real parent). */
export function checkWorkspace(ctx, folder) {
  const abs = path.resolve(expand(folder));
  if (!fs.existsSync(abs)) {
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw Object.assign(new Error(`not a folder: ${abs}`), { status: 400 });
    fs.mkdirSync(abs);
  }
  return checkFolder(ctx, 'fs.write', abs);
}
