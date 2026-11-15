// House builder: homes are assembled from parts chosen by seed inside the world's style.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readYaml } from '../tools/lib/packs.mjs';
import { planHouse, houseVariants, housePools, PARTS } from '../tools/lib/houses.mjs';

const houses = readYaml('packs/core/scenery.yaml').houses;

test('the same seed and member always build the same house; others differ', () => {
  const w = { seed: 'tea', biome: 'meadow', mood: 'cozy' };
  assert.deepEqual(planHouse(houses, { ...w, id: 'a' }), planHouse(houses, { ...w, id: 'a' }));
  const plans = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => JSON.stringify(planHouse(houses, { ...w, id })));
  assert.ok(new Set(plans).size >= 7, 'members get different homes');
  const other = ['a', 'b', 'c', 'd'].map((id) => JSON.stringify(planHouse(houses, { ...w, seed: 'coffee', id })));
  assert.notDeepEqual(plans.slice(0, 4), other, 'another world seed gives another town');
});

test('every part comes from the world style, and mood favourites are preferred', () => {
  for (const biome of Object.keys(houses.styles)) for (const mood of Object.keys(houses.moods)) {
    const v = houseVariants(houses, biome, mood);
    for (let i = 0; i < 12; i++) {
      const p = planHouse(houses, { seed: 'x', biome, mood, id: `m${i}` });
      for (const [part, key] of [['base', 'base'], ['wall', 'walls'], ['roof', 'roof'], ['door', 'door'], ['window', 'window']]) assert.ok(v[part].includes(p[key]), `${biome}/${mood}: ${part} ${p[key]}`);
      if (p.chimney) assert.ok(v.chimney.includes(p.chimney));
      for (const e of p.extras) assert.ok(v.extra.includes(e.type) && houses.extra_slots[e.type]);
      const [lo, hi] = houses.extras_count; assert.ok(p.extras.length >= Math.min(lo, v.extra.length) && p.extras.length <= hi);
    }
  }
  const pools = housePools(houses, 'meadow', 'cozy');
  assert.ok(pools.wall.filter((x) => x === 'timber').length >= 2, 'mood favourites count double');
  for (const p of PARTS) for (const v of Object.values(houseVariants(houses, 'default', 'cozy'))) assert.ok(Array.isArray(v), p);
});
