// The art of a vorld: the default sprite sheets (packs/core/art/default/*.png, laid out by packs/core/default-art.yaml).
// Nothing is painted in code. This module tells the client which sheet image holds which sprite (an atlas index);
// the client cuts the frames itself. Replace a PNG (or drop one with the same name in a user pack) to change the look.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pngSize } from '../../tools/lib/png.mjs';

const keyOf = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

/** A sheet file next to the pack file that names it (later packs override earlier ones). */
export function sheetFile(packs, rel) {
  return [...(packs.sources['default_art/default_art'] ?? [])].reverse().map((f) => path.join(path.dirname(f), rel)).find((f) => fs.existsSync(f)) ?? null;
}

/** Every sheet the art config names: id -> { rel, file }. The character sheet is `characters`. */
export function sheetFiles(packs) {
  const cfg = packs.byKind.default_art?.default_art ?? {};
  const out = {};
  if (cfg.characters?.file) out.characters = cfg.characters.file;
  for (const [id, g] of Object.entries(cfg.sheets ?? {})) out[id] = g.file;
  return Object.fromEntries(Object.entries(out).map(([id, rel]) => [id, { rel, file: sheetFile(packs, rel) }]));
}

/**
 * The atlas index of a vorld: { revision, sheets: [{ group, image, frames: { name: {x, y, w, h, kind} } }] }.
 * Characters: the founder and the companion have their own rows; agents take the agent rows in crew order.
 */
export function atlasFor(ctx) {
  const cfg = ctx.packs.byKind.default_art?.default_art ?? {};
  const files = sheetFiles(ctx.packs);
  const sheets = [];
  const sizeOf = (id) => { const f = files[id]?.file; return f ? pngSize(fs.readFileSync(f)) : null; };
  const ch = cfg.characters;
  const rows = ch?.rows ?? [];
  const agentRows = rows.map((r, i) => (r.for === 'agent' ? i : -1)).filter((i) => i >= 0);
  const rowOf = (m) => {
    const want = m.id === 'founder' ? 'founder' : m.role === 'companion' ? 'companion' : null;
    const own = want ? rows.findIndex((r) => r.for === want) : -1;
    if (own >= 0) return own;
    const agents = ctx.crew.filter((c) => c.role === 'agent');
    const k = Math.max(0, agents.findIndex((c) => c.id === m.id));
    return agentRows.length ? agentRows[k % agentRows.length] : 0;
  };
  const people = [{ id: 'founder', role: 'founder' }, ...ctx.crew];
  const sig = [];
  const size = sizeOf('characters');
  if (ch && size) {
    const cols = ch.dirs.length * ch.frames + (ch.portrait ? 1 : 0), cell = size.width / cols, frames = {};
    for (const m of people) {
      const y = rowOf(m) * cell, key = `c_${keyOf(m.id)}`;
      ch.dirs.forEach((d, di) => { for (let f = 0; f < ch.frames; f++) frames[`${key}_${d}_${f}`] = { x: (di * ch.frames + f) * cell, y, w: cell, h: cell, kind: 'sprite' }; });
      if (ch.portrait) frames[`${key}_portrait`] = { x: ch.dirs.length * ch.frames * cell, y, w: cell, h: cell, kind: 'sprite' };
    }
    sheets.push({ group: 'characters', image: 'characters', frames });
  }
  for (const [id, g] of Object.entries(cfg.sheets ?? {})) {
    const s = sizeOf(id);
    if (!s) continue;
    const cell = s.width / g.cols, frames = {};
    if (id === 'portraits') {
      for (const m of people) { const r = rowOf(m); frames[`c_${keyOf(m.id)}_portrait`] = { x: (r % g.cols) * cell, y: Math.floor(r / g.cols) * cell, w: cell, h: cell, kind: 'sprite' }; }
    } else g.cells.forEach((name, i) => { if (name !== '_') frames[name] = { x: (i % g.cols) * cell, y: Math.floor(i / g.cols) * cell, w: cell, h: cell, kind: name.startsWith('t_') ? 'tile' : 'sprite' }; });
    sheets.push({ group: id, image: id, frames });
  }
  for (const s of Object.values(files)) if (s.file) sig.push(s.file, fs.statSync(s.file).mtimeMs);
  sig.push(people.map((p) => p.id).join(','));
  return { revision: crypto.createHash('sha1').update(sig.join('|')).digest('hex').slice(0, 12), sheets };
}
