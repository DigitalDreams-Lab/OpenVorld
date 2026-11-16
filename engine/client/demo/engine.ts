// The demo engine's state: what engine/server keeps on disk, kept in memory for one visit (a reload starts over).
// It starts from fixtures the real engine made (tools/demo-build.mjs) and sends live events the way the server's
// WebSocket does, so the real client renders everything unchanged.
// The vorld the real engine made (tools/demo-build.mjs), loaded once before anything else runs.
export const F: any = await fetch(`${import.meta.env.BASE_URL}fixtures.json`).then((r) => { if (!r.ok) throw new Error('Demo data missing: run npm run demo:build'); return r.json(); });
export const IDS: Record<string, string> = F.ids;
export const PROJECT: string = F.project;

type Thread = { thread: any; events: any[] };
export const threads = new Map<string, Thread>(Object.entries(F.threads as Record<string, Thread>));
export const files = new Map<string, string>(Object.entries(F.files as Record<string, string>));
export let gameState: any = F.vorld.state;

// ---------- live events (the WebSocket of the real server) ----------
const listeners = new Set<(m: any) => void>();
export const listen = (f: (m: any) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function send(m: any) {
  if (m.type === 'game') gameState = m.state;
  for (const f of [...listeners]) f(m);
}
export const sendEvent = (thread: string, role: string | null, ev: any) => send({ type: 'thread.event', thread, role, ev });
export const command = (role: string, commands: any[]) => send({ type: 'command', role, commands });

// ---------- threads ----------
const now = () => new Date().toISOString();
export function threadOf(id: string) {
  const t = threads.get(id);
  if (!t) throw Object.assign(new Error('thread not found'), { status: 404 });
  return t;
}
export function append(id: string, ev: any) {
  const line = { at: now(), ...ev };
  const t = threadOf(id);
  t.events.push(line);
  t.thread = { ...t.thread, updated_at: line.at };
  return line;
}
export function updateThread(id: string, patch: any) {
  const t = threadOf(id);
  t.thread = { ...t.thread, ...patch, updated_at: now() };
  return t.thread;
}
export function createThread(fields: any) {
  const t = { id: crypto.randomUUID(), role: null, kind: 'chat', title: null, state: 'open', created_at: now(), updated_at: now(), session_id: null, ...fields };
  threads.set(t.id, { thread: t, events: [] });
  return t;
}
export const listThreads = (role?: string | null, kind?: string | null) => [...threads.values()].map((t) => t.thread)
  .filter((t) => (!role || t.role === role) && (!kind || t.kind === kind))
  .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

/** Requests for access still waiting, across all threads (GET /writs/open). */
export const openWrits = () => [...threads.values()].flatMap(({ thread, events }) => events
  .filter((e) => e.type === 'writ.request' && !events.some((x) => x.type === 'writ.answered' && x.id === e.id))
  .map((e) => ({ id: e.id, thread: thread.id, role: e.role, capability: e.capability, scope: e.scope, why: e.why ?? '', risk: e.risk, signin: false, at: e.at })));

export const member = (id: string) => F.vorld.crew.find((c: any) => c.id === id);
export const reactions: Record<string, any> = F.vorld.interactions?.reactions ?? {};

// ---------- the demo guide (the welcome card and tips over the game) ----------
export type Phase = 'welcome' | 'idle' | 'running' | 'writ' | 'denied' | 'done';
let phase: Phase = 'welcome';
const phaseSubs = new Set<() => void>();
export const getPhase = () => phase;
export const subscribePhase = (f: () => void) => { phaseSubs.add(f); return () => { phaseSubs.delete(f); }; };
export function setPhase(p: Phase) { phase = p; phaseSubs.forEach((f) => f()); }

/** Shown inside the website's hero (play/?embed): a small window, so the map leads and the chat opens only on request. */
export const EMBED = new URLSearchParams(location.search).has('embed');

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const DEMO_ONLY = 'This is a demo vorld, so this part stays as it is. Download OpenVorld to make it yours.';
