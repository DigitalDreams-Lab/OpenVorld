import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';

test('the wide chat panel is a choice kept in this browser, and works without storage', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { toggleWidePanel, widePanelIsOn } = await clientModule('engine/client/src/ui/widePanel.ts', { react: 'data:text/javascript,export const useSyncExternalStore=()=>false' }, true);
  assert.equal(widePanelIsOn(), false, 'normal width by default');
  toggleWidePanel();
  assert.equal(widePanelIsOn(), true);
  assert.equal(store.get('openvorld.widePanel'), '1', 'saved for the next visit');
  toggleWidePanel();
  assert.equal(widePanelIsOn(), false);
  assert.equal(store.get('openvorld.widePanel'), '0');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  toggleWidePanel();
  assert.equal(widePanelIsOn(), true, 'a blocked storage (private window) still toggles for this visit');
  delete globalThis.localStorage;
});
