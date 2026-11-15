// Decoration planner: deliberate, seeded, in the world's style, and never on paths or inside homes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readYaml } from '../tools/lib/packs.mjs';
import { planScenery } from '../tools/lib/scenery.mjs';
import { homeBody } from '../tools/lib/decor.mjs';

const defs = readYaml('packs/core/scenery.yaml');
const plan = (o) => planScenery(defs, { seed: 'tea', homes: 9, ...o });

test('decoration is deterministic and varies with the seed', () => {
  const a = plan({}), b = plan({}), c = plan({ seed: 'coffee' });
  assert.deepEqual(a.props, b.props);
  const names = (p) => JSON.stringify([...p.props, ...p.ground_props].filter((x) => x.decor));
  assert.notEqual(names(a), names(c));
  assert.ok([...a.props, ...a.ground_props].filter((x) => x.decor).length >= 12, 'a town is decorated');
});

test('decor never lands on a path, inside a home, on the terminal or on another solid prop', () => {
  for (const [seed, mood, biome] of [['tea', 'cozy', 'meadow'], ['x1', 'epic', 'desert'], ['x2', 'futuristic', 'station'], ['x3', 'gritty', 'city'], ['x4', 'serene', 'garden'], ['x5', 'mystical', 'forest']]) {
    const p = plan({ seed, mood, biome });
    const bodies = p.slots.slice(0, p.used).map(homeBody);
    const seen = new Set();
    for (const d of [...p.props, ...p.ground_props].filter((x) => x.decor)) {
      const c = p.ground[d.y][d.x];
      assert.ok(('0' <= c && c <= '3') || c === 'P', `${seed}: ${d.t} on ${c}`);
      assert.ok(!bodies.some((b) => d.x >= b.x0 && d.x <= b.x1 && d.y >= b.y0 && d.y <= b.y1), `${seed}: ${d.t} inside a home`);
      assert.ok(!(Math.abs(d.x - p.plaza.x) <= 1 && d.y >= p.plaza.y - 1 && d.y <= p.plaza.y + 3), `${seed}: ${d.t} on the terminal`);
      if (!defs.props[d.t].ground) { const k = `${d.x},${d.y}`; assert.ok(!seen.has(k), `${seed}: two props on ${k}`); seen.add(k); }
    }
  }
});

test('mood and biome choose the decoration', () => {
  const kinds = (o) => new Set([...plan(o).props, ...plan(o).ground_props].filter((x) => x.decor).map((x) => x.t));
  const serene = [...Array(6)].flatMap((_, i) => [...kinds({ seed: `g${i}`, mood: 'serene', biome: 'garden' })]);
  assert.ok(serene.includes('fountain') || serene.includes('bench') || serene.includes('well'));
  assert.ok(!serene.includes('brazier'), 'only the mood pools are used');
  assert.ok([...kinds({})].includes('lamp'), 'lamps are always placed');
});

test('a lamp is placed beside paths and around the square', () => {
  const p = plan({ mood: 'cozy', biome: 'meadow' });
  const lamps = p.props.filter((x) => x.t === 'lamp' && x.decor);
  assert.ok(lamps.length >= 4, 'a lamp ring plus path lamps');
  assert.ok(lamps.some((l) => Math.hypot((l.x - p.plaza.x) / 1.5, l.y - p.plaza.y) < 7), 'around the square');
  for (const l of lamps) assert.ok('0123'.includes(p.ground[l.y][l.x]) || p.ground[l.y][l.x] === 'P');
});
