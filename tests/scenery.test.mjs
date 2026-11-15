import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPacks, REPO } from '../tools/lib/packs.mjs';
import { planScenery, guessMood, newSeed, resolveWorld } from '../tools/lib/scenery.mjs';

const k = loadPacks([path.join(REPO, 'packs', 'core')]).byKind;
const defs = k.scenery.scenery;

test('same seed -> same world; different seed -> different world', () => {
  const a = planScenery(defs, { seed: 'amber-1234', mood: 'cozy', biome: 'auto', homes: 8 });
  const b = planScenery(defs, { seed: 'amber-1234', mood: 'cozy', biome: 'auto', homes: 8 });
  const c = planScenery(defs, { seed: 'willow-9999', mood: 'cozy', biome: 'auto', homes: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.ground, c.ground);
  assert.notDeepEqual(a.slots, c.slots);
});

test('every mood x biome x layout produces a valid plan', () => {
  for (const mood of Object.keys(defs.moods)) for (const biome of Object.keys(defs.biomes)) for (const layout of defs.layouts) for (const seed of ['a', 'b-77', newSeed()]) {
    const p = planScenery(defs, { seed, mood, biome, layout, homes: 13 });
    assert.equal(p.slots.length, defs.home_slots, `${mood}/${biome}/${layout}`);
    for (const s of p.slots) assert.ok(s.x >= 4 && s.x < p.w - 4 && s.y >= 4 && s.y < p.h - 4, `slot in bounds ${JSON.stringify(s)} ${mood}/${biome}/${layout}`);
    for (let i = 0; i < p.slots.length; i++) for (let j = i + 1; j < p.slots.length; j++) assert.ok(Math.hypot(p.slots[i].x - p.slots[j].x, p.slots[i].y - p.slots[j].y) >= 5, `slots ${i},${j} too close (${mood}/${biome}/${layout})`);
    assert.ok(p.props.length > 5, `has props ${mood}/${biome}`);
    for (const pr of p.props) { assert.ok(defs.props[pr.t]); const c = p.ground[pr.y][pr.x]; assert.ok((c >= '0' && c <= '3') || (pr.decor && c === 'P'), `prop on ${c}`); }   // decor may stand on the plaza (see decor.test.mjs)
  }
});

test('homes are reachable from the plaza by path/bridge tiles', () => {
  const p = planScenery(defs, { seed: 'reach-1', mood: 'mystical', biome: 'wetland', homes: 12 });
  const open = (x, y) => 'pPb'.includes(p.ground[y]?.[x] ?? '#');
  const seen = new Set([`${p.plaza.x},${p.plaza.y}`]), q = [[p.plaza.x, p.plaza.y]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const key = `${x + dx},${y + dy}`; if (!seen.has(key) && open(x + dx, y + dy)) { seen.add(key); q.push([x + dx, y + dy]); } } }
  for (let i = 0; i < 12; i++) assert.ok(seen.has(`${p.doors[i].x},${p.doors[i].y}`), `door ${i} reachable`);
});

test('no props on plaza, paths, water or home plots', () => {
  const p = planScenery(defs, { seed: 'clear-2', mood: 'futuristic', biome: 'station', homes: 10 });
  for (const pr of p.props.filter((x) => !x.decor)) for (let i = 0; i < 10; i++) assert.ok(!(Math.abs(pr.x - p.slots[i].x) <= 4 && Math.abs(pr.y - (p.slots[i].y - 1)) <= 4), 'prop inside a home plot');
});

test('mood guess, auto resolution and prop grids are well formed', () => {
  assert.equal(guessMood(defs, 'a cozy bakery for kids'), 'cozy');
  assert.equal(guessMood(defs, 'zzz qqq'), null);
  const r = resolveWorld(defs, { seed: 's', mood: 'auto', biome: 'auto' });
  assert.ok(defs.moods[r.mood] && defs.biomes[r.biome]);
  for (const [id, pr] of Object.entries(defs.props)) assert.ok(Array.isArray(pr.grid) && pr.grid.length === 2 && pr.grid.every((n) => Number.isInteger(n) && n > 0), `prop ${id}: grid of sprites`);
  assert.ok(Array.isArray(k.icons.icons.icons) && k.icons.icons.icons.includes('trophy'), 'icons are names of sprites');
});

test('props reserve foot clearance and keep paths, water and home entrances open', () => {
  for (const biome of Object.keys(defs.biomes)) {
    const p = planScenery(defs, {seed:'clearance',mood:'cozy',biome,homes:13});
    for (let i=0;i<p.props.length;i++) {
      const prop=p.props[i], def=defs.props[prop.t];
      if(def.solid&&prop.decor)assert.match(p.ground[prop.y][prop.x],/^[0-3P]$/,`${biome}/${prop.t} stands on ground`);
      else if(def.solid){
        const radius=Math.max(1,(def.foot??1)-1,Math.ceil((def.solid/2+4)/16));
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)assert.match(p.ground[prop.y+dy]?.[prop.x+dx]??'',/^[0-3]$/,`${biome}/${prop.t} clearance`);
      }
      const rad=(def.foot??1)-1;
      for(const other of p.props.slice(i+1)){
        const otherRad=(defs.props[other.t].foot??1)-1;
        assert.ok(Math.abs(prop.x-other.x)>rad+otherRad||Math.abs(prop.y-other.y)>rad+otherRad,'footprints overlap');
      }
    }
  }
});
