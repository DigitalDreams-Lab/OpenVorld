// The demo's stand-in for src/api.ts (vite.demo.config.mjs swaps it in): the same exports, answered in the browser by
// the demo engine instead of the local OpenVorld server. Reads come from what the real engine made; the story's turns
// come from scenario.ts; anything that would change the vorld politely says it is a demo.
import { DEMO_ONLY, F, IDS, append, createThread, files, gameState, listThreads, listen, openWrits, sendEvent, threadOf } from './engine';
import { chatMessage, partyMessage, stop, writAnswered } from './scenario';

const ART = `${import.meta.env.BASE_URL}art/`;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const vorld = () => ({ ...F.vorld, state: gameState });

type Route = [method: string, pattern: RegExp, handler: (m: RegExpMatchArray, body: any, q: URLSearchParams) => any];
const V = '/vorlds/[^/]+';
const routes: Route[] = [
  ['GET', /^\/boot$/, () => F.boot],
  ['GET', /^\/profile$/, () => F.profile],
  ['POST', /^\/detect$/, () => []],
  ['GET', /^(?:\/vorlds\/[^/]+)?\/fs\/native$/, () => ({ native: null })],
  ['GET', new RegExp(`^${V}/vorld$`), () => vorld()],
  ['GET', new RegExp(`^${V}/settings$`), () => F.settings],
  ['GET', new RegExp(`^${V}/models$`), () => ({ source: 'none', live: false, models: [], tiers: {} })],
  ['GET', new RegExp(`^${V}/parties$`), () => F.vorld.parties],
  ['GET', new RegExp(`^${V}/parties/([^/]+)/chats$`), (m) => listThreads(null, 'party').filter((t) => t.party === m[1])],
  ['POST', new RegExp(`^${V}/parties/([^/]+)/chats$`), (m, b) => createThread({ kind: 'party', party: m[1], title: b?.title || null })],
  ['GET', new RegExp(`^${V}/threads$`), (_m, _b, q) => listThreads(q.get('role'), q.get('kind'))],
  ['POST', new RegExp(`^${V}/threads$`), (_m, b) => {
    const bench = F.vorld.crew.find((c: any) => c.id === b?.role)?.benches?.[0]?.id ?? null;
    if (!bench && !F.vorld.crew.some((c: any) => c.id === b?.role)) throw fail('unknown crew member');
    return createThread({ role: b.role, kind: 'chat', title: null, bench });
  }],
  ['GET', new RegExp(`^${V}/threads/([^/]+)$`), (m) => { const t = threadOf(m[1]); return { thread: t.thread, events: [...t.events] }; }],
  ['POST', new RegExp(`^${V}/threads/([^/]+)/messages$`), (m, b) => {
    const t = threadOf(m[1]), text = String(b?.text ?? '').trim();
    if (!text) throw fail('empty message');
    const run = t.thread.kind === 'party' ? partyMessage : (tid: string) => chatMessage(tid, t.thread.role);
    // like the server: save the message, answer right away, and let the turn run on its own
    const ev = append(m[1], { type: 'founder.message', text });
    if (!t.thread.title) t.thread.title = text.slice(0, 48);
    sendEvent(m[1], t.thread.role, ev);
    void run(m[1]).catch((e) => sendEvent(m[1], t.thread.speaker ?? t.thread.role, { type: 'turn.error', message: e.message }));
    return { ok: true };
  }],
  ['POST', new RegExp(`^${V}/threads/([^/]+)/stop$`), (m) => { stop(m[1]); return { ok: true }; }],
  ['POST', new RegExp(`^${V}/threads/([^/]+)/writs/([^/]+)$`), (m, b) => {
    const { events } = threadOf(m[1]);
    const ask = events.find((e) => e.type === 'writ.request' && e.id === m[2]);
    if (!ask) throw fail('unknown request', 404);
    if (events.some((e) => e.type === 'writ.answered' && e.id === m[2])) throw fail('already answered', 409);
    if (!F.vorld.permissions.answers.some((a: any) => a.id === b?.answer)) throw fail('unknown answer');
    const ev = append(m[1], { type: 'writ.answered', id: m[2], role: ask.role, answer: b.answer, scope: ask.scope });
    sendEvent(m[1], ask.role, ev);
    void writAnswered(m[1], b.answer);
    return { ok: true, scope: ask.scope };
  }],
  ['POST', new RegExp(`^${V}/threads/([^/]+)/file-access$`), () => ({ ok: true })],
  ['GET', new RegExp(`^${V}/writs/open$`), () => openWrits()],
  ['GET', new RegExp(`^${V}/grants$`), () => F.grants],
  ['GET', new RegExp(`^${V}/browser/[^/]+$`), () => ({})],
  ['GET', new RegExp(`^${V}/crew/([^/]+)/vault$`), (m) => F.vaults[m[1]] ?? { secrets: [], signin: {} }],
  ['GET', new RegExp(`^${V}/crew/[^/]+/signin$`), () => ({})],
  ['GET', new RegExp(`^${V}/crew/([^/]+)/memory$`), () => ({ notes: [], chats: [] })],
  ['GET', /^\/detect\/add-yourself$/, () => ({ text: '' })],         // no integration prompt in the demo: the button stays hidden
];

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body ? 'POST' : 'GET');
  const url = new URL(path, 'http://demo');
  await Promise.resolve();
  for (const [verb, re, handler] of routes) {
    const m = verb === method ? url.pathname.match(re) : null;
    if (m) return structuredClone(await handler(m, opts.body, url.searchParams)) as T;
  }
  throw new Error(DEMO_ONLY);
}

/** Live events: the demo engine's events, as the real WebSocket would deliver them. */
export function connect(_wid: string, onMsg: (m: any) => void): () => void {
  return listen((m) => { try { onMsg(structuredClone(m)); } catch (e) { console.error(e); } });
}

export async function artImage(name: string) {
  const res = await fetch(`${ART}${encodeURIComponent(name)}.webp`);
  if (!res.ok) throw new Error('Art unavailable');
  return res.blob();
}

export class FileAccessError extends Error { constructor(message: string, public path: string) { super(message); } }
export async function allowFile(_url: string) { return { ok: true }; }

const TYPES: Record<string, string> = { html: 'text/html', md: 'text/markdown', txt: 'text/plain' };
/** Files the crew wrote or reads in the demo project (Buzz's notes, and the invitation once Jules has saved it). */
export async function fileBlob(url: string, _signal?: AbortSignal, _maxBytes?: number) {
  const path = new URL(url, 'http://demo').searchParams.get('path') ?? '';
  const name = path.split('/').pop() ?? '';
  const text = files.get(name);
  if (text == null) throw new Error('This file is not here yet.');
  return new Blob([text], { type: TYPES[name.split('.').pop() ?? ''] ?? 'text/plain' });
}
export async function uploadFile(_wid: string, _thread: string, _file: File): Promise<any> { throw new Error(DEMO_ONLY); }

export const DEMO_IDS = IDS;
