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
