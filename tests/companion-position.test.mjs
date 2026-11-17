import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { companionPosition, companionOverlap } = await clientModule('engine/client/src/game/companion-position.ts');
const founder = { x: 100, y: 100 }, preferred = { x: 78, y: 80 };
const size = { width: 15.36, height: 15.36 }, person = { width: 25.6, height: 25.6 };
const clear = () => true;

test('the companion keeps the existing default position when nobody covers it', () => {
  assert.deepEqual(companionPosition(preferred, founder, size, [{ ...founder, ...person }], clear), preferred);
});

test('an agent covering the default spot makes only the companion choose a nearby visible spot', () => {
  const crew = [{ ...founder, ...person }, { x: 80, y: 88, ...person }, { x: 120, y: 88, ...person }, { x: 80, y: 112, ...person }, { x: 120, y: 112, ...person }];
  const before = structuredClone(crew);
  assert.ok(companionOverlap(preferred, size, crew) > 0);
  const at = companionPosition(preferred, founder, size, crew, clear);
  assert.equal(companionOverlap(at, size, crew), 0);
  assert.ok(Math.hypot(at.x - founder.x, at.y - founder.y) < 30, 'the companion remains within the original talking range');
  assert.deepEqual(crew, before, 'crew positions are untouched');
  let previous = { x: at.x - founder.x, y: at.y - founder.y };
  for (let frame = 0; frame < 100; frame++) {
    const next = companionPosition(preferred, founder, size, crew, clear, previous);
    assert.deepEqual(next, at, 'the alternate position stays stable');
    previous = { x: next.x - founder.x, y: next.y - founder.y };
  }
  const next = companionPosition(preferred, founder, size, [...crew, { ...at, ...person }], clear, previous);
  assert.notDeepEqual(next, at, 'an agent moving over the alternate position triggers another choice');
  assert.deepEqual(companionPosition(preferred, founder, size, [], clear, previous), preferred, 'the default position is restored once clear');
});

test('the companion also handles a human form and avoids blocked alternatives', () => {
  const occupied = [{ ...founder, ...person }, { x: 78, y: 112, ...person }];
  const at = companionPosition({ x: 78, y: 112 }, founder, person, occupied, (x, y) => x >= 100 && y >= 100);
  assert.equal(companionOverlap(at, person, occupied), 0);
  assert.ok(at.x >= 100 && at.y >= 100);
  assert.ok(Math.hypot(at.x - founder.x, at.y - founder.y) < 30);
});

test('clear upper spots take priority over lower spots, including a previously chosen lower fallback', () => {
  const occupied = [{ ...founder, ...person }, { x: 80, y: 88, ...person }];
  const at = companionPosition(preferred, founder, size, occupied, clear, { x: 0, y: 29 });
  assert.ok(at.y < founder.y, 'the companion returns above the founder when space is available');
  assert.equal(companionOverlap(at, size, occupied), 0);
  const aboveOnly = companionPosition(preferred, founder, size, occupied, (_x, y) => y < founder.y);
  assert.ok(aboveOnly.y < founder.y);
});
