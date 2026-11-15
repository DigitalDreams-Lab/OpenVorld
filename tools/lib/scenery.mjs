// Seeded world decorator. Pure functions: (scenery pack, seed, mood, biome) -> a plan the client paints.
// Same inputs always give the same world; a different seed gives a different one with the same feel.
// The plan holds no colours or pixels: those come from the world palette and the scenery pack at paint time.
import { decorate } from './decor.mjs';

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rngFrom(seed) {
  let a = hashStr(seed) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Stateless hash of a tile -> [0,1): the same tile always rolls the same, whatever else changes. */
const tileRoll = (seedHash, x, y, salt = 0) => { let h = (seedHash ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
function valueNoise(seedHash, x, y, salt = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const a = tileRoll(seedHash, x0, y0, salt), b = tileRoll(seedHash, x0 + 1, y0, salt), c = tileRoll(seedHash, x0, y0 + 1, salt), d = tileRoll(seedHash, x0 + 1, y0 + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const WORDS = ['amber', 'bramble', 'cinder', 'dune', 'ember', 'fable', 'glade', 'harbor', 'iris', 'juniper', 'kelp', 'lumen', 'moss', 'nova', 'onyx', 'pebble', 'quill', 'reed', 'saffron', 'thistle', 'umber', 'violet', 'willow', 'yarrow', 'zephyr'];
/** A readable random seed such as "willow-4821". */
export function newSeed(rand = Math.random) {
  return `${WORDS[Math.floor(rand() * WORDS.length)]}-${String(Math.floor(rand() * 9000) + 1000)}`;
}

/** Mood id that best matches free text (business name, pitch, website words), or null. */
export function guessMood(defs, text) {
  const words = new Set(String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let best = null, score = 0;
  for (const [id, m] of Object.entries(defs.moods ?? {})) {
    const s = (m.keywords ?? []).reduce((n, k) => n + (words.has(k) ? 1 : 0), 0);
    if (s > score) { best = id; score = s; }
  }
  return best;
}

/** Resolve "auto" / unknown choices to concrete mood, biome and layout from the seed. */
export function resolveWorld(defs, { seed, mood, biome, layout }) {
  const moods = Object.keys(defs.moods ?? {}), r = rngFrom(`${seed}:world`);
  const m = defs.moods?.[mood] ? mood : moods[Math.floor(r() * moods.length)];
  const md = defs.moods[m];
  const b = defs.biomes?.[biome] ? biome : md.biomes[Math.floor(r() * md.biomes.length)];
  const lay = (defs.layouts ?? []).includes(layout) ? layout : md.layouts[Math.floor(r() * md.layouts.length)];
  return { seed: String(seed), mood: m, biome: b, layout: lay };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function homeSlots(layout, defs, seed, cx, cy, W, H) {
  const n = defs.home_slots ?? 16, r = rngFrom(`${seed}:slots`);
  const clampP = (p) => ({ x: Math.max(6, Math.min(W - 7, Math.round(p.x))), y: Math.max(6, Math.min(H - 7, Math.round(p.y))) });
  const ok = (p, out, min) => out.every((q) => dist(p, q) >= min) && dist(p, { x: cx, y: cy }) >= 8;
  const out = [];
  if (layout === 'street') {
    const cand = [];
    for (const [ys, xs] of [[[-8, 8], [8, 17, 26]], [[-15, 15], [13, 22]]]) for (const dy of ys) for (const dx of xs) for (const sx of [-1, 1]) cand.push({ x: cx + sx * dx + Math.round((r() - 0.5) * 2), y: cy + dy + Math.round((r() - 0.5) * 2) });
    cand.sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }) || a.y - b.y);
    // alternate sides of the road
    const north = cand.filter((p) => p.y < cy), south = cand.filter((p) => p.y >= cy);
    while (out.length < n && (north.length || south.length)) { const p = (out.length % 2 ? south : north).shift() ?? north.shift() ?? south.shift(); if (p) out.push(clampP(p)); }
    return out;
  }
  if (layout === 'scatter') {
    for (let tries = 0; out.length < n && tries < 4000; tries++) {
      const a = r() * Math.PI * 2, k = 0.4 + Math.sqrt(r()) * 0.6;
      const p = clampP({ x: cx + Math.cos(a) * 27 * k, y: cy + Math.sin(a) * 16.5 * k });
      if (ok(p, out, 9 - Math.min(2, tries / 1500))) out.push(p);
    }
  } else {
    const a0 = r() * Math.PI * 2, rx = 19 + r() * 5, ry = 11 + r() * 4;
    for (let i = 0; out.length < n && i < n * 40; i++) {
      const slot = out.length, a = a0 + slot * 2.39996 + (i > slot ? r() * 0.3 : 0);
      const p = clampP({ x: cx + Math.cos(a) * (rx + (r() - 0.5) * 4), y: cy + Math.sin(a) * (ry + (r() - 0.5) * 3) });
      if (ok(p, out, 8 - Math.min(2, i / (n * 14)))) out.push(p);
    }
  }
  // fill what the layout could not place: dart-throwing with a shrinking spacing
  for (let min = 8; out.length < n && min >= 5.5; min -= 0.5) {
    for (let tries = 0; out.length < n && tries < 1500; tries++) {
      const a = r() * Math.PI * 2, k = 0.35 + Math.sqrt(r()) * 0.65;
      const p = clampP({ x: cx + Math.cos(a) * 27 * k, y: cy + Math.sin(a) * 16.5 * k });
      if (ok(p, out, min)) out.push(p);
    }
  }
  return out;
}

export function planScenery(defs, opts) {
  const { w: W, h: H } = defs.size ?? { w: 64, h: 44 };
  const world = resolveWorld(defs, opts);
  const mood = defs.moods[world.mood], biome = defs.biomes[world.biome];
  const used = Math.max(0, Math.min(opts.homes ?? 0, defs.home_slots ?? 16));
  const sh = hashStr(world.seed);
  const cx = W >> 1, cy = H >> 1;
  const grid = Array.from({ length: H }, () => Array(W).fill('0'));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = c; };
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? grid[y][x] : 'V');
  const isGround = (c) => c >= '0' && c <= '3';

  // ground variants
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = tileRoll(sh, x, y, 1); grid[y][x] = v < 0.62 ? '0' : v < 0.82 ? '1' : v < 0.94 ? '2' : '3'; }

  // map edge: water or void ring with an irregular inner line
  const edgeKind = biome.edge === 'water' ? 'W' : biome.edge === 'void' ? 'V' : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const t = 1 + valueNoise(sh, x / 5, y / 5, 7) * 2.2;
    if (d < 1) set(x, y, edgeKind ?? 'W'); else if (edgeKind && d < t) set(x, y, edgeKind);
  }

  // plaza: an irregular blob around the centre
  const rp = 2.4 + (tileRoll(sh, 5, 5, 9)) * 1.4;
  for (let y = -8; y <= 8; y++) for (let x = -10; x <= 10; x++) {
    const d = Math.hypot(x / 1.5, y), wob = (valueNoise(sh, x / 2.5 + 40, y / 2.5 + 40, 3) - 0.5) * 1.8;
    if (d + wob < rp) set(cx + x, cy + y, 'P');
  }

  const slots = homeSlots(world.layout, defs, world.seed, cx, cy, W, H);

  // ponds
  const pr = rngFrom(`${world.seed}:ponds`);
  const pondCount = biome.water?.amount ? Math.min(4, Math.round(biome.water.amount * (0.6 + pr() * 1.8))) : 0;
  const ponds = [];
  for (let k = 0, tries = 0; k < pondCount && tries < 300; tries++) {
    const p = { x: 9 + Math.floor(pr() * (W - 18)), y: 8 + Math.floor(pr() * (H - 16)) };
    const rx = 2.5 + pr() * 3.5, ry = 1.8 + pr() * 2.4;
    if (dist(p, { x: cx, y: cy }) < 12 + rx || slots.some((s) => Math.abs(s.x - p.x) < rx + 5 && Math.abs(s.y - p.y) < ry + 6) || ponds.some((q) => dist(p, q) < 10)) continue;
    ponds.push(p); k++;
    for (let y = -6; y <= 6; y++) for (let x = -8; x <= 8; x++) {
      const e = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (valueNoise(sh, (p.x + x) / 2, (p.y + y) / 2, 11) - 0.5) * 0.7;
      if (e < 1 && isGround(at(p.x + x, p.y + y))) set(p.x + x, p.y + y, e < 0.45 ? 'W' : 'w');
    }
  }

  // paths from the plaza to each used home's door; they cross water on plank bridges
  const pathRng = rngFrom(`${world.seed}:paths`);
  const doors = slots.map((s) => ({ x: s.x, y: s.y + 2 }));
  const mark = (x, y) => {
    const c = at(x, y);
    if (c === 'w' || c === 'W') { if (x > 1 && y > 1 && x < W - 2 && y < H - 2) set(x, y, 'b'); }
    else if (isGround(c)) set(x, y, 'p');
  };
  for (let i = 0; i < used; i++) {
    let x = cx, y = cy + 1;
    const d = doors[i];
    for (let guard = 0; guard < 400 && (x !== d.x || y !== d.y); guard++) {
      const dx = d.x - x, dy = d.y - y;
      const horiz = Math.abs(dx) > 0 && (Math.abs(dy) === 0 || pathRng() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy) * 1.4));
      if (pathRng() < 0.07 && Math.abs(dx) + Math.abs(dy) > 6) { if (horiz) y += pathRng() < 0.5 ? -1 : 1; else x += pathRng() < 0.5 ? -1 : 1; }
      else if (horiz) x += Math.sign(dx); else y += Math.sign(dy);
      x = Math.max(2, Math.min(W - 3, x)); y = Math.max(2, Math.min(H - 3, y));
      mark(x, y);
    }
  }

  // props
  const zone = [{ x: cx, y: cy, rx: 7, ry: 5 }, ...slots.slice(0, used).map((s) => ({ x: s.x, y: s.y - 1, rx: 4, ry: 4.5 }))];
  const inZone = (x, y) => zone.some((z) => Math.abs(x - z.x) <= z.rx && y >= z.y - z.ry && y <= z.y + z.ry + 1.5);
  const weights = Object.entries(biome.props ?? {}).filter(([id]) => defs.props?.[id]);
  const totalW = weights.reduce((n, [, v]) => n + v, 0) || 1;
  const pick = (u) => { let acc = 0; for (const [id, v] of weights) { acc += v / totalW; if (u <= acc) return id; } return weights[0]?.[0]; };
  const dens = 0.12 * (mood.density ?? 1), blocked = new Set(), props = [], ground = [];
  const near = (x, y, rad, pred) => { for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) if (pred(at(x + i, y + j))) return true; return false; };
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    if (!isGround(at(x, y)) || inZone(x, y)) continue;
    const band = Math.min(x, y, W - 1 - x, H - 1 - y);
    const cluster = valueNoise(sh, x / 8, y / 8, 21);
    const u = tileRoll(sh, x, y, 31), kind = tileRoll(sh, x, y, 41);
    let id = null;
    if (['forest', 'hedge', 'rock', 'dunes'].includes(biome.edge) && band <= 4 && u < 0.62 - band * 0.08) id = biome.edge === 'forest' ? (kind < 0.55 ? 'pine' : 'tree') : biome.edge === 'hedge' ? 'bush' : 'rock';
    else if (u < dens * (0.4 + cluster * 1.4)) id = pick(kind);
    if (!id || !defs.props[id]) continue;
    const def = defs.props[id];
    if (def.ground) { ground.push({ t: id, x, y, v: 0 }); continue; }
    const rad = Math.max(0, (def.foot ?? 1) - 1);
    // Clearance is in world tiles; solid widths are world pixels.
    const clearance = Math.max(1, rad, Math.ceil(((def.solid ?? 0) / 2 + 4) / 16));
    if (def.solid && near(x, y, clearance, (c) => !isGround(c))) continue;
    let clash = false;
    for (let i = -rad; i <= rad && !clash; i++) for (let j = -rad; j <= rad; j++) if (blocked.has(`${x + i},${y + j}`)) clash = true;
    if (clash || props.length >= 700) continue;
    for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) blocked.add(`${x + i},${y + j}`);
    props.push({ t: id, x, y, v: def.variants ? Math.floor(tileRoll(sh, x, y, 51) * def.variants) : 0 });
  }
  // deliberate decoration (lamps, benches, wells, stalls, doorstep planters, flower beds), by rules and seed
  decorate(defs, { seed: world.seed, moodId: world.mood, biomeId: world.biome, mood, W, H, cx, cy, at, slots, used, doors, props, ground, blocked });
  props.sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    ...world, w: W, h: H, tile: defs.size?.tile ?? 16, used,
    ground: grid.map((row) => row.join('')),
    ground_props: ground, props,
    plaza: { x: cx, y: cy }, slots, doors, spawn: { x: cx, y: cy + 3 },
    particles: mood.particles,
  };
}
