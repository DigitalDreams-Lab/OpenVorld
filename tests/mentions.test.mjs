import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { activeMention, mentionSuggestions, EVERYONE, asksEveryone } = await clientModule('engine/client/src/ui/mentions.ts');
const crew = [{ id: 'ada', name: 'Ada' }, { id: 'bo-li', name: 'Bo Li' }, { id: 'élise', name: 'Élise' }];

test('@ suggestions support bare mentions, partial and full names, Unicode and editing in the middle', () => {
  assert.deepEqual(mentionSuggestions(crew, activeMention('Hi @', 4).query), crew);
  assert.deepEqual(mentionSuggestions(crew, activeMention('Hi @bo l', 8).query).map(m => m.id), ['bo-li']);
  assert.deepEqual(mentionSuggestions(crew, activeMention('@é', 2).query).map(m => m.id), ['élise']);
  assert.deepEqual(activeMention('Ask @Ada please', 6), { start: 4, end: 8, query: 'a' });
  assert.equal(activeMention('hello@example.com', 17), null);
  assert.equal(activeMention('Use `@Ada', 9), null);
  assert.equal(activeMention('```\n@Ada', 8), null);
  assert.deepEqual(mentionSuggestions(crew, 'unknown'), []);
});

test('@all completes in a party and the composer knows when a message asks everyone', () => {
  const crew = [{ id: 'ada', name: 'Ada' }, { id: 'bo-li', name: 'Bo Li' }, EVERYONE];
  assert.deepEqual(mentionSuggestions(crew, activeMention('@al', 3).query).map(m => m.id), ['all']);
  assert.deepEqual(mentionSuggestions(crew, activeMention('@', 1).query).map(m => m.id), ['ada', 'bo-li', 'all']);
  assert.ok(asksEveryone('@all please') && asksEveryone('thanks @Everyone!') && asksEveryone('@team'));
  assert.ok(!asksEveryone('mail me@all.example') && !asksEveryone('use `@all` here') && !asksEveryone('hello @allison') && !asksEveryone('everyone'));
});
