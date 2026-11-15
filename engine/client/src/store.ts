// Tiny global store (no library): get/set/subscribe + a React hook, and an event bus between React and the map.
import { useSyncExternalStore } from 'react';

export type Toast = { id: number; kind: 'deed' | 'level' | 'xp' | 'info' | 'error' | 'quest'; title: string; body?: string; xp?: number; icon?: string };
export type Live = { role?: string; steps: any[]; working: boolean; error?: string | null };
export type BrowserFrame = { url?: string; title?: string; image?: string; active?: boolean; signed?: boolean; at?: number };
export type Modal = null | 'quests' | 'deeds' | 'settings' | 'member' | 'add';

type State = {
  vorldId: string | null;
  vorld: any | null;
  talkingTo: string | null;           // crew member whose panel is open
  modal: Modal;
  questId: string | null;             // the quest open on the board (null = the list)
  quests: any[];
  toasts: Toast[];
  live: Record<string, Live>;         // threadId -> streaming turn
  browsers: Record<string, BrowserFrame>;   // crew member id -> what their browser last showed
  threadsVersion: number;             // bump to refetch thread lists
};

let state: State = { vorldId: null, vorld: null, talkingTo: null, modal: null, questId: null, quests: [], toasts: [], live: {}, browsers: {}, threadsVersion: 0 };
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  subs.forEach((f) => f());
}
export const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let toastId = 1;
export function toast(t: Omit<Toast, 'id'>, ms = 4500) {
  const id = toastId++;
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}

/** Theme string with {placeholders}; falls back to the given text or the key's last part. */
export function str(path: string, vars: Record<string, string> = {}, fallback?: string): string {
  const strings = state.vorld?.theme?.strings ?? {};
  const v = path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), strings);
  const s = typeof v === 'string' ? v : fallback ?? path.split('.').pop()!.replace(/_/g, ' ');
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** A crew member of the open vorld, by id. */
export const memberOf = (id: string | null | undefined) => state.vorld?.crew?.find((c: any) => c.id === id) ?? null;

// Event bus between React and the Phaser scene.
type Handler = (payload: any) => void;
const bus = new Map<string, Set<Handler>>();
export const on = (ev: string, h: Handler) => { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev)!.add(h); return () => bus.get(ev)!.delete(h); };
export const emit = (ev: string, payload?: any) => bus.get(ev)?.forEach((h) => h(payload));
