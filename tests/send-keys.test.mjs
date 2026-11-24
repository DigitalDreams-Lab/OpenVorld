import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { sendModeOf, mainAction, effectiveMode } = await clientModule('engine/client/src/ui/sendKeys.ts');

test('Enter sends now, Ctrl+Enter or Cmd+Enter queues, Shift+Enter is a new line', () => {
  assert.equal(sendModeOf({ key: 'Enter' }), 'send');
  assert.equal(sendModeOf({ key: 'Enter', ctrlKey: true }), 'queue');
  assert.equal(sendModeOf({ key: 'Enter', metaKey: true }), 'queue');
  assert.equal(sendModeOf({ key: 'Enter', shiftKey: true }), null);
  assert.equal(sendModeOf({ key: 'Enter', shiftKey: true, ctrlKey: true }), null);
  assert.equal(sendModeOf({ key: 'a' }), null);
  assert.equal(sendModeOf({ key: 'Escape' }), null);
});

test('the main button is Stop while the member works and nothing is typed, Send once there is something to say', () => {
  assert.equal(mainAction(true, false), 'stop');
  assert.equal(mainAction(true, true), 'send');
  assert.equal(mainAction(false, false), 'send');
  assert.equal(mainAction(false, true), 'send');
});

test('queueing only means something while the member works; an idle member just gets the message', () => {
  assert.equal(effectiveMode('queue', true), 'queue');
  assert.equal(effectiveMode('queue', false), 'send');
  assert.equal(effectiveMode('send', true), 'send');
});
