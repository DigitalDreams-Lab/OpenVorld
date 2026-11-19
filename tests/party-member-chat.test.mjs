import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule, stubModule } from './helpers/client.mjs';
const { closeTop, emit, getState, on, setState, str } = await clientModule('engine/client/src/store.ts', { react: stubModule('export const useSyncExternalStore = () => null;') });

test('a member opened from a party room sits on top of it: Escape returns to the room, then closes it', () => {
  const off = on('talk', (role) => setState({ talkingTo: role }));       // what Game.tsx does for the map, and now for a name in the room
  setState({ partyId: 'p1', talkingTo: null, modal: null });
  emit('talk', 'nico');
  assert.deepEqual([getState().talkingTo, getState().partyId], ['nico', 'p1'], 'the room stays open under the member chat');
  setState(closeTop);
  assert.deepEqual([getState().talkingTo, getState().partyId], [null, 'p1'], 'back in the party room');
  setState(closeTop);
  assert.deepEqual([getState().talkingTo, getState().partyId], [null, null]);
  off();
});

test('Escape closes a dialog before the chat under it', () => {
  assert.deepEqual(closeTop({ modal: 'member', talkingTo: 'nico', partyId: 'p1' }), { modal: null });
  assert.deepEqual(closeTop({ modal: null, talkingTo: 'nico', partyId: null }), { talkingTo: null });
});

test('the tooltip names the member, and a theme can reword it', () => {
  setState({ vorld: null });
  assert.equal(str('chat.open_member', { name: 'Nico' }, 'Chat with {name}'), 'Chat with Nico');
  setState({ vorld: { theme: { strings: { chat: { open_member: 'Visit {name}' } } } } });
  assert.equal(str('chat.open_member', { name: 'Nico' }, 'Chat with {name}'), 'Visit Nico');
});
