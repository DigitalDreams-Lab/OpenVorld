import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { SolidIndex } = await clientModule('engine/client/src/game/solids.ts');
const { walkingPath, clearWalk } = await clientModule('engine/client/src/game/navigation.ts');

test('the crew walks around what the founder bumps into, not through it', () => {
  const solids = new SolidIndex(16);
  solids.addCentered(160, 160, 32, 8);   // a bench across the straight line from (60,160) to (260,160)
  const walkable = (x, y) => x > 0 && y > 0 && x < 320 && y < 320 && !solids.blocked(x, y);
  assert.ok(!walkable(160, 160), 'the bench is not standing room');
  assert.ok(!walkable(160, 163), 'nor is its edge (the walker\'s feet need room)');
  assert.ok(walkable(160, 175), 'but a step away is');
  assert.ok(!clearWalk({ x: 60, y: 160 }, { x: 260, y: 160 }, walkable), 'the straight line is blocked');
  const path = walkingPath({ x: 60, y: 160 }, { x: 260, y: 160 }, walkable, 320, 320);
  assert.ok(path && path.length > 1, 'a route with a turn exists');
  let at = { x: 60, y: 160 };
  for (const p of path) { assert.ok(clearWalk(at, p, walkable), 'every leg of the route is clear'); at = p; }
  assert.deepEqual(at, { x: 260, y: 160 });
});

test('solids across tile edges, and clearing them, work', () => {
  const solids = new SolidIndex(16, 0);
  solids.add({ x: 10, y: 10, w: 20, h: 20 });          // spans four tiles
  for (const [x, y] of [[12, 12], [28, 12], [12, 28], [28, 28]]) assert.ok(solids.blocked(x, y), `${x},${y}`);
  assert.ok(!solids.blocked(31, 20) && !solids.blocked(5, 5));
  solids.clear();
  assert.ok(!solids.blocked(20, 20));
});
