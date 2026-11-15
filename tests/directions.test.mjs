import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';

const { movementDirection, DIRECTIONS, walkFrame, WALK_FRAMES } = await clientModule('engine/client/src/game/pixels.ts');

test('a movement picks one of eight directions (screen y points down)', () => {
  const at = (x, y) => movementDirection(x, y, 'down');
  assert.equal(at(1, 0), 'right'); assert.equal(at(-1, 0), 'left'); assert.equal(at(0, -1), 'up'); assert.equal(at(0, 1), 'down');
  assert.equal(movementDirection(1, 1, 'up'), 'down_right'); assert.equal(movementDirection(-1, 1, 'up'), 'down_left');
  assert.equal(movementDirection(1, -1, 'down'), 'up_right'); assert.equal(movementDirection(-1, -1, 'down'), 'up_left');
  assert.equal(DIRECTIONS.length, 8);
});

test('no movement keeps the last direction, a wobble does not flip it', () => {
  assert.equal(movementDirection(0, 0, 'up_left'), 'up_left');
  assert.equal(movementDirection(1, 0.35, 'right'), 'right');          // about 19 degrees off: still right
  assert.equal(movementDirection(1, 0.7, 'right'), 'down_right');      // about 35 degrees: turned
});

test('the walk cycle loops through four frames', () => {
  const seen = new Set(); for (let t = 0; t < 1000; t += 10) seen.add(walkFrame(t, 125));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]); assert.equal(WALK_FRAMES, 4);
});

test('custom character sheets made for fewer directions or frames still work', async () => {
  const { characterFramePlan } = await clientModule('engine/client/src/game/pixels.ts');
  const sheet = (dirs, frames) => new Set(dirs.flatMap((d) => Array.from({ length: frames }, (_, f) => `c_x_${d}_${f}`)));
  const has = (set) => (n) => set.has(n);
  // the old sheet: four directions, three frames (two strides, standing)
  const old = characterFramePlan(has(sheet(['down', 'up', 'left', 'right'], 3)), 'c_x');
  assert.deepEqual(old.down, ['c_x_down_0', 'c_x_down_2', 'c_x_down_1', 'c_x_down_2'], 'stride, stand, stride, stand: standing is the idle frame');
  assert.equal(old.down_left[0].startsWith('c_x_left_'), true, 'a missing diagonal borrows the side view');
  assert.equal(old.up_right[0].startsWith('c_x_right_'), true);
  // the full sheet uses every cell as drawn
  const dirs8 = ['down', 'down_right', 'right', 'up_right', 'up', 'up_left', 'left', 'down_left'];
  const full = characterFramePlan(has(sheet(dirs8, 4)), 'c_x');
  assert.deepEqual(full.up_left, ['c_x_up_left_0', 'c_x_up_left_1', 'c_x_up_left_2', 'c_x_up_left_3']);
  // a sheet with a single picture per direction does not crash and does not animate
  assert.deepEqual(characterFramePlan(has(sheet(['down'], 1)), 'c_x').left, ['c_x_down_0', 'c_x_down_0', 'c_x_down_0', 'c_x_down_0']);
  assert.equal(characterFramePlan(has(new Set()), 'c_x'), null, 'no pictures at all: nothing to draw');
});
