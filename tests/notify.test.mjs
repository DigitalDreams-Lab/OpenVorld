import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule, stubModule } from './helpers/client.mjs';

const played = [], emitted = [];
globalThis.__ovTest = { played, emitted };
const sfx = stubModule(`export const play = (id) => globalThis.__ovTest.played.push(id);`);
const store = stubModule(`export const emit = (...a) => globalThis.__ovTest.emitted.push(a); export const getState = () => ({ openWrits: [] }); export const subscribe = () => () => {};`);
const { notificationPlan, notifyPrefs, setNotifyPrefs, notify } = await clientModule('engine/client/src/notify.ts', { './audio/sfx': sfx, './store': store });

const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };

test('only "someone needs you" makes a sound; desktop notifications only while the window is out of sight', () => {
  const on = { sound: true, desktop: true };
  assert.deepEqual(notificationPlan('attention', true, on), { sound: true, desktop: false });
  assert.deepEqual(notificationPlan('attention', false, on), { sound: true, desktop: true });
  assert.deepEqual(notificationPlan('done', true, on), { sound: false, desktop: false }, 'a finished job is silent while you look');
  assert.deepEqual(notificationPlan('done', false, on), { sound: false, desktop: true });
  assert.deepEqual(notificationPlan('error', false, on), { sound: false, desktop: true });
  assert.deepEqual(notificationPlan('attention', false, { sound: false, desktop: false }), { sound: false, desktop: false }, 'both switches turn off');
});

test('the switches default to on and are kept', () => {
  assert.deepEqual(notifyPrefs(), { sound: true, desktop: true });
  setNotifyPrefs({ sound: false });
  assert.deepEqual(notifyPrefs(), { sound: false, desktop: true });
  setNotifyPrefs({ sound: true, desktop: false });
  assert.deepEqual(notifyPrefs(), { sound: true, desktop: false });
});

test('notify plays the chime for attention and nothing for a finished job', () => {
  setNotifyPrefs({ sound: true, desktop: false });
  played.length = 0;
  notify({ kind: 'attention', title: 'Quinn needs your OK' });
  notify({ kind: 'done', title: 'Quinn is done' });
  notify({ kind: 'error', title: 'Quinn hit a problem' });
  assert.deepEqual(played, ['notify.attention']);
});
