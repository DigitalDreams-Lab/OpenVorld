// House builder plans. Pure: (houses pack, world seed, biome, mood, member id) -> which parts make this home
// and where they go. The same inputs always give the same house; another member or seed gives another house
// in the same style. The client paints the plan from built-in parts or AI-drawn parts (h_<part>_<variant>).
import { rngFrom } from './scenery.mjs';

export const PARTS = ['base', 'wall', 'roof', 'door', 'window', 'chimney', 'extra'];

/** Variant pools for a world: biome style (or default), plus the mood's favourites counted twice. */
export function housePools(houses, biome, mood) {
  const known = (part) => Object.keys(houses?.parts?.[part] ?? {});
  const style = houses?.styles?.[biome] ?? houses?.styles?.default ?? {};
  const fav = houses?.moods?.[mood] ?? {};
  return Object.fromEntries(PARTS.map((part) => {
    const ok = new Set(known(part));
    const base = (style[part] ?? houses?.styles?.default?.[part] ?? [...ok]).filter((v) => ok.has(v));
    const liked = (fav[part] ?? []).filter((v) => ok.has(v));
    return [part, [...base, ...liked, ...liked]];
  }));
}

/** Every variant this world's houses can use (what an AI artist needs to draw). */
export function houseVariants(houses, biome, mood) {
  const pools = housePools(houses, biome, mood);
  return Object.fromEntries(PARTS.map((p) => [p, [...new Set(pools[p])]]));
}

/**
 * @param {object} houses scenery.yaml > houses
 * @param {{ seed: string, biome: string, mood: string, id: string }} o
 */
export function planHouse(houses, { seed, biome, mood, id }) {
  const rnd = rngFrom(`${seed}|house|${id}`);
  const pools = housePools(houses, biome, mood);
  const pick = (list, fallback = null) => (list?.length ? list[Math.min(list.length - 1, Math.floor(rnd() * list.length))] : fallback);
  const size = pick(houses?.sizes ?? [], { cols: 3, floors: 1 });
  const [lo, hi] = houses?.extras_count ?? [1, 2];
  const want = lo + Math.floor(rnd() * (hi - lo + 1));
  const extras = [];
  const pool = [...pools.extra];
  while (extras.length < want && pool.length) {
    const e = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (!extras.includes(e)) extras.push(e);
  }
  const cols = Math.max(3, (size.cols ?? 3) | 1);    // odd: the door block sits in the middle column
  return {
    id, cols, floors: size.floors ?? 1,
    base: pick(pools.base, 'stone'), walls: pick(pools.wall, 'plaster'), roof: pick(pools.roof, 'gable'),
    door: pick(pools.door, 'plank'), window: pick(pools.window, 'square'),
    chimney: pools.chimney.length && rnd() < 0.65 ? pick(pools.chimney) : null,
    extras: extras.map((type) => ({ type, slot: houses?.extra_slots?.[type] ?? 'ground', side: rnd() < 0.5 ? -1 : 1 })),
    flip: rnd() < 0.5,                                   // mirrors the asymmetric bits (chimney, sign side)
    tint: rnd(),                                         // small shade shift so neighbours never look identical
  };
}

/** Roof rows: each row steps in one block per side until a single peak block closes it (flat roofs: one row). */
export function roofRows(cols, roof) {
  const band = Array.from({ length: cols }, (_, i) => (i === 0 ? 'l' : i === cols - 1 ? 'r' : 'm'));
  if (roof === 'flat') return [band];
  if (roof === 'dome') return [band, ['peak']];            // one curved row and a cupola on top
  const rows = [];
  for (let span = cols; span >= 1; span -= 2) rows.push(span === 1 ? ['peak'] : Array.from({ length: span }, (_, i) => (i === 0 ? 'l' : i === span - 1 ? 'r' : 'm')));
  return rows;
}

/**
 * The blocks of a home on its grid: col 0..cols-1 left to right (ground extras may sit at -1 or cols), row 0 is
 * the ground floor and rows grow upwards. Overlay blocks are drawn over the block at the same cell.
 * @returns {{ cols: number, rows: number, blocks: { part: string, variant: string, piece: string, col: number, row: number, overlay?: boolean }[] }}
 */
export function houseBlocks(plan) {
  const { cols, floors } = plan, mid = (cols - 1) / 2, blocks = [];
  const piece = (c) => (c === 0 ? 'l' : c === cols - 1 ? 'r' : 'm');
  for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) blocks.push({ part: 'wall', variant: plan.walls, piece: piece(c), col: c, row: f });
  for (let c = 0; c < cols; c++) blocks.push({ part: 'base', variant: plan.base, piece: piece(c), col: c, row: 0, overlay: true });
  blocks.push({ part: 'door', variant: plan.door, piece: 'door', col: mid, row: 0, overlay: true });
  // windows: ground floor beside the door (wide homes), every upper floor in the middle (and beside it when wide)
  const windows = [];
  for (let f = 0; f < floors; f++) for (let c = 1; c < cols - 1; c++) if (f > 0 ? (cols === 3 || c !== mid) : c !== mid) windows.push({ col: c, row: f });
  if (!windows.length && cols === 3) for (const c of [0, 2]) windows.push({ col: c, row: floors - 1 });   // tiny homes: windows in the edge blocks
  for (const w of windows) blocks.push({ part: 'window', variant: plan.window, piece: 'window', ...w, overlay: true });
  const roof = roofRows(cols, plan.roof);
  roof.forEach((row, r) => row.forEach((pc, i) => blocks.push({ part: 'roof', variant: plan.roof, piece: pc, col: (cols - row.length) / 2 + i, row: floors + r })));
  const side = plan.flip ? -1 : 1;
  if (plan.chimney && plan.roof !== 'flat') blocks.push({ part: 'chimney', variant: plan.chimney, piece: 'chimney', col: side > 0 ? cols - 2 : 1, row: floors + 1, overlay: true });
  for (const e of plan.extras ?? []) {
    const s = e.side * side;
    const at = {
      door_top: { col: mid, row: 0 }, door_side: { col: mid + s, row: 0 }, window: windows[0] ?? { col: mid + s, row: 0 },
      wall: { col: s > 0 ? cols - 1 : 0, row: floors - 1 }, wall_edge: { col: s > 0 ? cols - 1 : 0, row: 0 },
      roof: { col: s > 0 ? Math.max(1, cols - 2) : Math.min(cols - 2, 1), row: floors + roof.length - 1 }, ground: { col: s > 0 ? cols : -1, row: 0 },
    }[e.slot] ?? { col: s > 0 ? cols : -1, row: 0 };
    blocks.push({ part: 'extra', variant: e.type, piece: e.slot, ...at, overlay: true });
  }
  return { cols, rows: floors + roof.length + (plan.roof === 'flat' && plan.extras?.some((e) => e.slot === 'roof') ? 1 : 0), blocks };
}

/** Every block and overlay name an artist must draw for a world (h_<part>_<variant>[_<piece>]). */
export function blockNames(houses, biome, mood) {
  const v = houseVariants(houses, biome, mood), out = [];
  for (const w of v.wall) for (const p of ['l', 'm', 'r']) out.push({ name: `h_wall_${w}_${p}`, part: 'wall', variant: w, piece: p });
  for (const r of v.roof) for (const p of r === 'flat' ? ['l', 'm', 'r'] : ['l', 'm', 'r', 'peak']) out.push({ name: `h_roof_${r}_${p}`, part: 'roof', variant: r, piece: p });
  for (const part of ['door', 'window', 'base', 'chimney', 'extra']) for (const x of v[part]) out.push({ name: `h_${part}_${x}`, part, variant: x, piece: part });
  return out;
}
