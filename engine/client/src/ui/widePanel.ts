import { useSyncExternalStore } from 'react';

// A wide chat panel: the founder's choice for every member chat and party room, kept in this browser.
const KEY = 'openvorld.widePanel';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let wide = read();

export function toggleWidePanel() {
  wide = !wide;
  try { localStorage.setItem(KEY, wide ? '1' : '0'); } catch { /* private window: the choice lasts until reload */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const widePanelIsOn = () => wide;
export const useWidePanel = () => useSyncExternalStore(subscribe, () => wide);
