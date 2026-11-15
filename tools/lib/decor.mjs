// Decoration planner. Pure: runs after paths and homes exist and adds deliberate props (lamps along the paths and
// around the square, benches, wells, stalls, planters at doorsteps, yard clutter, flower beds). Everything comes
// from scenery.yaml > decor and the seed, inside the world's style (mood pools, biome drops), and never lands on
// a path or inside a home. Items are appended to `props` (solid or standing) or `ground` (flat), like any prop.
import { rngFrom } from './scenery.mjs';

/** Tile rectangle a home occupies above its door (plans put the door at slot.y + 2). */
export const homeBody = (slot) => ({ x0: slot.x - 3, x1: slot.x + 3, y0: slot.y - 4, y1: slot.y + 1 });

function pool(decor, kind, moodId, biomeId, props) {
  const base = decor.pools?.[kind] ?? [], fav = decor.moods?.[moodId]?.[kind] ?? [], drop = new Set(decor.drop?.[biomeId] ?? []);
  return [...base, ...fav, ...fav].filter((id) => props?.[id] && !drop.has(id));
}

/**
 * @param {object} defs scenery pack
 * @param {object} o { seed, moodId, biomeId, mood, W, H, cx, cy, at(x,y), slots, used, doors, props, ground, blocked }
 */
export function decorate(defs, o) {
  const decor = defs.decor;
  if (!decor) return;
  const { W, H, cx, cy, at, slots, used, doors, props, ground, blocked } = o;
  const rnd = rngFrom(`${o.seed}|decor`);
  const isGround = (c) => c >= '0' && c <= '3';
  const isRoad = (c) => c === 'p' || c === 'P' || c === 'b';
  const bodies = slots.slice(0, used).map(homeBody);
  const inHome = (x, y) => bodies.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const nearCentre = (x, y) => Math.abs(x - cx) <= 1 && y >= cy - 1 && y <= cy + 3;          // terminal and its approach
  const pick = (list) => (list.length ? list[Math.floor(rnd() * list.length)] : null);
  const placed = [];                                                                          // every placed tile, for spacing
  const key = (x, y) => `${x},${y}`;

  const clear = (x, y, rad, allowPlaza) => {
    if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3 || inHome(x, y) || nearCentre(x, y)) return false;
    const c = at(x, y);
    if (!(isGround(c) || (allowPlaza && c === 'P'))) return false;
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) if (blocked.has(key(x + i, y + j))) return false;
    return true;
  };
  const place = (id, x, y, rad = 0) => {
    const def = defs.props[id];
    if (!def) return false;
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) blocked.add(key(x + i, y + j));
    const item = { t: id, x, y, v: def.variants ? Math.floor(rnd() * def.variants) : 0, decor: true };
    (def.ground ? ground : props).push(item);
    placed.push({ x, y });
    return true;
  };
  const far = (x, y, d) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= d);
  /** The nearest clear tile to (x, y) within a small radius. */
  const near = (x, y, rad, opts = {}) => {
    for (let r = 0; r <= rad; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      if (clear(x + i, y + j, opts.clear ?? 0, opts.plaza) && (opts.apart === undefined || far(x + i, y + j, opts.apart))) return { x: x + i, y: y + j };
    }
    return null;
  };
  const footOf = (id) => Math.max(0, (defs.props[id]?.foot ?? 1) - 1);

  // 1. lamps ring the square
  const ring = decor.plaza_ring;
  if (ring && defs.props[ring.prop]) {
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < (ring.count ?? 4); k++) {
      const a = a0 + (k / (ring.count ?? 4)) * Math.PI * 2;
      const t = near(Math.round(cx + Math.cos(a) * ring.radius * 1.5), Math.round(cy + Math.sin(a) * ring.radius), 2, { plaza: true, apart: 3 });
      if (t) place(ring.prop, t.x, t.y, footOf(ring.prop));
    }
  }

  // 2. lamps beside the paths: spaced, close to the square and to each home's door
  const lamps = decor.path_lamps;
  if (lamps && defs.props[lamps.prop]) {
    const cand = [];
    for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
      if (!isGround(at(x, y))) continue;
      const road = at(x - 1, y) === 'p' || at(x + 1, y) === 'p' || at(x, y - 1) === 'p' || at(x, y + 1) === 'p';
      if (!road) continue;
      const dc = Math.hypot((x - cx) / 1.5, y - cy), dd = Math.min(...doors.slice(0, used).map((d) => Math.hypot(x - d.x, y - d.y)), 99);
      if (dc <= (lamps.near_plaza ?? 12) || dd <= 4) cand.push({ x, y, w: rnd() });
    }
    cand.sort((a, b) => a.w - b.w);
    let n = 0;
    for (const c of cand) {
      if (n >= (lamps.max ?? 12)) break;
      if (clear(c.x, c.y, footOf(lamps.prop), false) && far(c.x, c.y, lamps.every ?? 6)) { place(lamps.prop, c.x, c.y, footOf(lamps.prop)); n++; }
    }
  }

  // 3. plaza extras: benches, wells, stalls... around the square, spaced apart
  const [pLo, pHi] = decor.plaza_extras ?? [0, 0];
  const plazaPool = pool(decor, 'plaza', o.moodId, o.biomeId, defs.props);
  const want = pLo + Math.floor(rnd() * (pHi - pLo + 1));
  for (let k = 0, tries = 0; k < want && tries < 60 && plazaPool.length; tries++) {
    const a = rnd() * Math.PI * 2, r = 2.6 + rnd() * 3.2;
    const id = pick(plazaPool), rad = footOf(id);
    const t = near(Math.round(cx + Math.cos(a) * r * 1.5), Math.round(cy + Math.sin(a) * r), 1, { plaza: true, clear: rad, apart: 3.2 });
    if (t && place(id, t.x, t.y, rad)) k++;
  }

  // 4. every home: items framing the doorstep, and yard items beside it
  const doorPool = pool(decor, 'door', o.moodId, o.biomeId, defs.props), yardPool = pool(decor, 'yard', o.moodId, o.biomeId, defs.props);
  for (let i = 0; i < used; i++) {
    const s = slots[i], d = doors[i];
    const [fLo, fHi] = decor.door_frames ?? [0, 0];
    const frames = fLo + Math.floor(rnd() * (fHi - fLo + 1));
    const sides = rnd() < 0.5 ? [-1, 1] : [1, -1];
    for (let k = 0; k < frames && doorPool.length; k++) {
      const id = pick(doorPool);
      const t = near(d.x + sides[k] * 2, d.y + 1, 1, { clear: footOf(id) });
      if (t) place(id, t.x, t.y, footOf(id));
    }
    const [yLo, yHi] = decor.yard_extras ?? [0, 0];
    const extras = yLo + Math.floor(rnd() * (yHi - yLo + 1));
    for (let k = 0; k < extras && yardPool.length; k++) {
      const id = pick(yardPool), rad = footOf(id), side = rnd() < 0.5 ? -1 : 1;
      const t = near(s.x + side * (3 + Math.floor(rnd() * 2)), s.y + 1 + Math.floor(rnd() * 3), 2, { clear: rad, apart: 2 });
      if (t) place(id, t.x, t.y, rad);
    }
  }

  // 5. flower beds along the path edges (denser in moods that like plants)
  const beds = decor.beds;
  if (beds && defs.props[beds.prop]) {
    const chance = (beds.chance ?? 0.12) * (o.mood?.density ?? 1);
    let n = 0;
    for (let y = 3; y < H - 3 && n < (beds.max ?? 100); y++) for (let x = 3; x < W - 3 && n < (beds.max ?? 100); x++) {
      if (!isGround(at(x, y)) || inHome(x, y) || nearCentre(x, y) || blocked.has(key(x, y))) continue;
      if (!(isRoad(at(x - 1, y)) || isRoad(at(x + 1, y)) || isRoad(at(x, y - 1)) || isRoad(at(x, y + 1)))) continue;
      if (rnd() < chance) { ground.push({ t: beds.prop, x, y, v: Math.floor(rnd() * (defs.props[beds.prop].variants ?? 1)), decor: true }); n++; }
    }
  }
}
