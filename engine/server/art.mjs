// The art of a vorld: the default sprite sheets (packs/core/art/default/*.png, laid out by packs/core/default-art.yaml).
// Nothing is painted in code. This module tells the client which sheet image holds which sprite (an atlas index);
// the client cuts the frames itself. Replace a PNG (or drop one with the same name in a user pack) to change the look.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pngSize } from '../../tools/lib/png.mjs';
import { decodePng, encodePng } from '../../tools/lib/pngcodec.mjs';

const PAGE_EDGE = 2048;
const pageCache = new Map();

/** Keep whole character cells together on small images, avoiding a giant decoded browser surface. */
function characterPage(file, characters, size) {
  if (!file || !characters || Math.max(size.width, size.height) <= PAGE_EDGE) return null;
  const cells = characters.dirs.length * characters.frames + (characters.portrait ? 1 : 0);
  const cell = size.width / cells, edge = Math.floor(PAGE_EDGE / cell) * cell;
  if (!Number.isInteger(cell) || !edge) return null;
  // Custom PNG formats the small codec does not handle keep their original browser decoding path.
  const header = Buffer.alloc(29), fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  return header[24] === 8 && [2, 6].includes(header[25]) && header[28] === 0 ? { edge, ...size } : null;
}

/** Original sheets remain available; paged character images are generated without changing the artwork. */
export function sheetImage(packs, name) {
  const files = sheetFiles(packs), page = /^characters-page-(\d+)-(\d+)$/.exec(name);
  if (!page) return files[name]?.file ? fs.readFileSync(files[name].file) : null;
  const file = files.characters?.file;
  if (!file) return null;
  const raw = fs.readFileSync(file), layout = characterPage(file, packs.byKind.default_art?.default_art?.characters, pngSize(raw));
  if (!layout) return null;
  if (Number(page[1]) * layout.edge >= layout.width || Number(page[2]) * layout.edge >= layout.height) return null;
  const stat = fs.statSync(file), revision = `${stat.mtimeMs}:${stat.size}:${layout.edge}`;
  let cache = pageCache.get(file);
  if (!cache || cache.revision !== revision) {
    if (pageCache.size >= 4) pageCache.delete(pageCache.keys().next().value);
    cache = { revision, pages: new Map() }; pageCache.set(file, cache);
  }
  const key = `${Number(page[1])}:${Number(page[2])}`;
  if (!cache.pages.has(key)) {
    // decode the sheet once and cut every page from it: the first load used to decode the whole sheet again for each page
    const source = decodePng(raw);
    for (let py = 0; py * layout.edge < source.height; py++) for (let px = 0; px * layout.edge < source.width; px++) {
      const x0 = px * layout.edge, y0 = py * layout.edge, width = Math.min(layout.edge, source.width - x0), height = Math.min(layout.edge, source.height - y0);
      const data = Buffer.alloc(width * height * 4);
      for (let row = 0; row < height; row++) {
        const start = ((y0 + row) * source.width + x0) * 4;
        source.data.copy(data, row * width * 4, start, start + width * 4);
      }
      cache.pages.set(`${px}:${py}`, encodePng({ width, height, data }, { fast: true }));
    }
  }
  return cache.pages.get(key) ?? null;
}

/** Cut the character pages now (at start-up), so the first vorld opened does not wait for them. */
export function warmArt(packs) { try { sheetImage(packs, 'characters-page-0-0'); } catch { /* the first request tries again */ } }

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
    if (m.avatar) {
      const av = String(m.avatar).replace(/^portrait_/, '');
      const match = rows.findIndex((r) => r.id === av || r.id === `agent_${av}`);
      if (match >= 0) return match;
    }
    const agents = ctx.crew.filter((c) => c.role === 'agent');
    const k = Math.max(0, agents.findIndex((c) => c.id === m.id));
    return agentRows.length ? agentRows[k % agentRows.length] : 0;
  };
  const people = [{ id: 'founder', role: 'founder' }, ...ctx.crew];
  const sig = ['character-pages-v1'];
  const size = sizeOf('characters');
  if (ch && size) {
    const cells = ch.dirs.length * ch.frames, cols = cells + (ch.portrait ? 1 : 0), cell = size.width / cols, frames = {};
    for (const m of people) {
      const y = rowOf(m) * cell, key = `c_${keyOf(m.id)}`;
      ch.dirs.forEach((d, di) => { for (let f = 0; f < ch.frames; f++) frames[`${key}_${d}_${f}`] = { x: (di * ch.frames + f) * cell, y, w: cell, h: cell, kind: 'sprite' }; });
      // `mirror: { left: right }` draws a direction as the flipped picture of another, so the sheet only holds one of each pair
      for (const [d, src] of Object.entries(ch.mirror ?? {})) for (let f = 0; f < ch.frames; f++) if (frames[`${key}_${src}_${f}`]) frames[`${key}_${d}_${f}`] = { ...frames[`${key}_${src}_${f}`], flip: true };
      if (ch.portrait) frames[`${key}_portrait`] = { x: cells * cell, y, w: cell, h: cell, kind: 'sprite' };
    }
    const layout = characterPage(files.characters?.file, ch, size);
    if (!layout) sheets.push({ group: 'characters', image: 'characters', frames });
    else {
      const pages = new Map();
      for (const [name, frame] of Object.entries(frames)) {
        const col = Math.floor(frame.x / layout.edge), row = Math.floor(frame.y / layout.edge), image = `characters-page-${col}-${row}`;
        if (!pages.has(image)) pages.set(image, { group: 'characters', image, frames: {} });
        pages.get(image).frames[name] = { ...frame, x: frame.x - col * layout.edge, y: frame.y - row * layout.edge };
      }
      sheets.push(...pages.values());
    }
  }
  for (const [id, g] of Object.entries(cfg.sheets ?? {})) {
    const s = sizeOf(id);
    if (!s) continue;
    const cell = s.width / g.cols, frames = {};
    if (id === 'portraits') {
      g.cells.forEach((name, i) => { if (name !== '_') frames[name] = { x: (i % g.cols) * cell, y: Math.floor(i / g.cols) * cell, w: cell, h: cell, kind: 'sprite' }; });
      for (const m of people) { const r = rowOf(m); frames[`c_${keyOf(m.id)}_portrait`] = { x: (r % g.cols) * cell, y: Math.floor(r / g.cols) * cell, w: cell, h: cell, kind: 'sprite' }; }
    } else g.cells.forEach((name, i) => { if (name !== '_') frames[name] = { x: (i % g.cols) * cell, y: Math.floor(i / g.cols) * cell, w: cell, h: cell, kind: name.startsWith('t_') ? 'tile' : 'sprite' }; });
    sheets.push({ group: id, image: id, frames });
  }
  for (const s of Object.values(files)) if (s.file) sig.push(s.file, fs.statSync(s.file).mtimeMs);
  sig.push(people.map((p) => `${p.id}:${p.avatar ?? ''}`).join(','));
  return { revision: crypto.createHash('sha1').update(sig.join('|')).digest('hex').slice(0, 12), sheets };
}
