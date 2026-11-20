import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { nearEnd, NEAR_END } = await clientModule('engine/client/src/ui/scroll.ts');

test('a chat follows new messages only while the reader is near the end', () => {
  const area = (scrollTop) => ({ scrollHeight: 2000, clientHeight: 500, scrollTop });
  assert.ok(nearEnd(area(1500)), 'at the very end');
  assert.ok(nearEnd(area(1500 - NEAR_END)), 'just inside the slack');
  assert.ok(!nearEnd(area(1500 - NEAR_END - 1)), 'just outside it: they are reading older messages');
  assert.ok(!nearEnd(area(0)), 'at the top');
  assert.ok(nearEnd({ scrollHeight: 300, clientHeight: 500, scrollTop: 0 }), 'a short chat that does not scroll');
});
