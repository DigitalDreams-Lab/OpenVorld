// Where a crew member works. Two kinds of place, never mixed up:
//  - WORKBENCHES: folders the member works in. Every member has a Main bench and may have more; the founder can move,
//    add and remove them, and each chat is started on one of them. Folders the founder chose are writable by that
//    member (the founder's choice is the consent); the default Main bench inside the vorld stays talk-only until a writ
//    says more.
//  - the HOUSE (house.mjs): fixed, private, never changes. Holds the vault with the member's secrets and sign-ins.
// Plus the vorld's one shared PROJECT folder, which the whole crew can read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFolder } from './gate.mjs';

const expand = (p) => String(p ?? '').replace(/^~(?=\/|$)/, os.homedir());
const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
export const MAX_BENCHES = 12;

/** The folder every member's default Main bench is made in, unless the founder points it somewhere else in Settings. */
export function benchBase(ctx) {
  const base = ctx.doc?.benches?.base;
  return base ? { path: path.resolve(expand(base)), custom: true } : { path: path.join(ctx.dir, 'workbenches'), custom: false };
}

/** Every workbench of a member: [{ id, name, path, chosen, default }], the Main bench first. `chosen` = the founder picked the folder. */
export function benchesOf(ctx, role) {
  const m = ctx.member?.(role);
  const saved = Array.isArray(m?.benches) ? m.benches : [];
  const space = benchBase(ctx), main = saved.find((b) => b.id === 'main');
  const defaultPath = path.join(space.path, role);
  if (!main?.path && !space.custom) {
    try { fs.mkdirSync(defaultPath, { recursive: true }); } catch { /* ignore */ }
  }
  const list = [
    { id: 'main', name: main?.name || 'Main bench', path: main?.path ? path.resolve(expand(main.path)) : defaultPath, chosen: !!main?.path || space.custom },
    ...saved.filter((b) => b.id !== 'main').map((b) => ({ id: b.id, name: b.name, path: path.resolve(expand(b.path)), chosen: true })),
  ];
  const def = list.some((b) => b.id === m?.default_bench) ? m.default_bench : 'main';
  return list.map((b) => ({ ...b, default: b.id === def }));
}
/** One workbench by id; an unknown or missing id means the member's default bench. */
export function benchOf(ctx, role, id) {
  const list = benchesOf(ctx, role);
  return list.find((b) => b.id === id) ?? list.find((b) => b.default) ?? list[0];
}
/** A short id for a new bench that no other bench of the member uses. */
export function newBenchId(ctx, role, name) {
  const taken = new Set(benchesOf(ctx, role).map((b) => b.id));
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'bench';
  let id = base === 'main' ? 'bench' : base, n = 1;
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

/**
 * The vorld's project folder: the one place the whole crew works on together. Every member can read it; changing it
 * needs an fs.write writ. Unless the founder picked a folder, it is <vorld>/project.
 */
export function projectOf(ctx) {
  const picked = ctx.doc?.project;
  const abs = picked ? path.resolve(expand(picked)) : path.join(ctx.dir, 'project');
  if (!picked) fs.mkdirSync(abs, { recursive: true });
  return { path: abs, chosen: !!picked, exists: fs.existsSync(abs) };
}

/** Validate a folder the founder picked as the project folder: it must exist and be grantable for reading and writing. */
export function checkProject(ctx, folder) {
  const abs = path.resolve(expand(folder));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) bad(`not a folder: ${abs}`);
  checkFolder(ctx, 'fs.read', abs);
  return checkFolder(ctx, 'fs.write', abs);
}

/** Validate a folder the founder picked as a workbench or as the folder benches are made in (created when missing, inside a real parent). */
export function checkBench(ctx, folder) {
  const abs = path.resolve(expand(folder));
  if (!fs.existsSync(abs)) {
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) bad(`not a folder: ${abs}`);
    fs.mkdirSync(abs);
  }
  return checkFolder(ctx, 'fs.write', abs);
}
