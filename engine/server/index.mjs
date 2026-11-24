// OpenVorld local server. Binds to 127.0.0.1 only; every API call and the WebSocket need the per-launch token
// (injected into the page it serves), and Host must be localhost (DNS-rebinding guard).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer } from 'ws';
import { HOME, allPacks, listVorlds, vorldCtx, saveVorld, createVorld, cleanMember, detected, migrateVorlds, addYourselfMessage } from './vorld.mjs';
import { atlasFor, sheetImage } from './art.mjs';
import { gameFor } from './game.mjs';
import { listThreads, createThread, deleteThread, getThread, updateThread, readEvents, appendEvent, accessMessage, setQueue, afterInterrupts, QUEUE_MAX } from './threads.mjs';
import { runTurn, stopTurn, stopAllTurns, activeTurnCount, brainOf, isWorking, requestAccess, openWrits } from './agents/runner.mjs';
import { openShared } from './party-files.mjs';
import { listParties, getParty, saveParty, deleteParty, removeFromParties, partyChats, createPartyChat, runParty, resumeParty, stopParty, stopAllParties, partyBusy } from './parties.mjs';
import { adoptLegacyKeys, cleanProviders, hasKey, keyFor, looksLikeEnvName } from './keys.mjs';
import { saveAttachmentStream, saveAttachment, publicFiles, getAttachment, resolveAttachments, replyFile, allowReplyFile, addReferences } from './attachments.mjs';
import { listGrants, grant, revoke, checkFolder, checkScope, deny, holds } from './gate.mjs';
import { browseFolder, pickNative, nativeDialog, browseConfig } from './browse.mjs';
import { benchesOf, benchOf, benchBase, checkBench, newBenchId, projectOf, checkProject, MAX_BENCHES } from './benches.mjs';
import { listSecrets, setSecret, removeSecret, hasSecret, redactSecrets, askSecret } from './house.mjs';
import { listModels } from './models.mjs';
import * as browse from './browser.mjs';
import { readProfile, saveProfile } from './profile.mjs';
import { notes, chats, editNote, dropNote, dropChat, recall } from './memory.mjs';
import { apiAuthorized } from './bridge-token.mjs';
import { REPO, resolveTheme } from '../../tools/lib/packs.mjs';

let PORT = Number(process.env.OV_PORT ?? 4317);
const TOKEN = process.env.OV_TOKEN || crypto.randomBytes(24).toString('hex');
process.env.OV_TOKEN = TOKEN; process.env.OV_PORT = String(PORT);   // the tool bridge calls back to this port, but with its own per-turn token (bridge-token.mjs), never this one
const DIST = path.join(REPO, 'engine', 'client', 'dist');
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(process.env.OV_DEV_HOSTS ?? '').split(',').filter(Boolean)]);
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

// ---------- helpers ----------
const sockets = new Map(); // vorldId -> Set<ws>
const emitTo = (id) => (msg) => { for (const ws of sockets.get(id) ?? []) if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) fail('body too large', 413); }
  try { return s ? JSON.parse(s) : {}; } catch { fail('invalid JSON'); }
}
const trim = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined);
const withoutSecrets = (o) => JSON.parse(JSON.stringify(o ?? {}, (k, v) => (/^(api_key|key|token|secret)$/i.test(k) ? undefined : v)));

/** Everything the client needs to draw a vorld. */
function vorldView(ctx) {
  const game = gameFor(ctx);
  const working = new Set(listThreads(ctx).filter((t) => t.state === 'working' && isWorking(t.id)).map((t) => (t.kind === 'party' ? t.speaker : t.role)).filter(Boolean));
  const k = ctx.packs.byKind;
  const scenery = k.scenery?.scenery ?? {};
  const profile = readProfile(HOME);
  return {
    vorld: { id: ctx.id, name: ctx.doc.name, about: ctx.doc.about ?? '', project: (({ path: p, chosen, exists }) => ({ path: p, chosen, exists }))(projectOf(ctx)) },
    profile,
    crew: ctx.crew.map((c) => {
      const b = brainOf(ctx, c.id);
      return { id: c.id, role: c.role, order: c.order, name: c.name, job: c.job, function: c.function, personality: ctx.doc.crew.find((m) => m.id === c.id)?.personality ?? '', look: c.look, home: c.home,
        avatar: c.avatar ?? null,
        brain: c.brain ?? null, brain_label: b.provider === 'none' ? null : `${b.label}${b.model ? ' · ' + b.model : ''}`, working: working.has(c.id),
        benches: benchesOf(ctx, c.id) };
    }),
    theme: { palette: ctx.theme.palette ?? {}, buildings: ctx.theme.buildings ?? {}, strings: ctx.theme.strings ?? {} },
    interactions: { reactions: ctx.interactions.reactions ?? {}, chat: ctx.interactions.agent?.chat ?? {} },
    permissions: { answers: k.permissions?.permissions?.answers ?? [], capabilities: Object.fromEntries(Object.entries(k.permissions?.permissions?.capabilities ?? {}).map(([id, c]) => [id, { label: c.label ?? id, risk: c.risk ?? 'medium', seal: c.seal ?? null }])) },
    benches: { base: benchBase(ctx).path, custom: benchBase(ctx).custom },
    parties: listParties(ctx),
    scenery: ctx.scenery(),
    art: { scenery, creatures: k.default_art?.default_art?.creatures ?? {}, house_sprites: k.default_art?.default_art?.illustrated_houses ?? [], atlas: atlasFor(ctx), agent_avatars: (k.default_art?.default_art?.characters?.rows ?? []).filter((r) => r.for === 'agent').map((r) => r.id) },
    deeds: game.deedList().map(({ id, name, desc, hint, xp, icon, hidden }) => ({ id, name, desc, hint, xp, icon, hidden: !!hidden })),
    state: game.snapshot(),
  };
}
const vorldChanged = (id) => emitTo(id)({ type: 'vorld' });

/** One turn in a chat with one member. */
async function turn(ctx, tid, text, files = []) {
  const emit = emitTo(ctx.id), thread = getThread(ctx, tid);
  try { await runTurn(ctx, tid, text, emit, files); }
  catch (e) { emit({ type: 'thread.event', thread: tid, role: thread.role, kind: thread.kind, party: thread.party, ev: { type: 'turn.error', message: e.message } }); }
}

// ---------- queued messages ----------
// A message written while the member is busy either interrupts (the turn is stopped, what was written so far stays in the chat, and
// the message runs next) or waits in the chat's queue (threads.mjs > setQueue). The queue runs one message after another, each when
// the previous turn has ended, in chats and in party rooms alike.
const queueChanged = (ctx, thread) => emitTo(ctx.id)({ type: 'thread.event', thread: thread.id, role: thread.role, kind: thread.kind, party: thread.party, ev: { type: 'queue' } });
const busy = (tid) => isWorking(tid) || partyBusy(tid);
/** Start a message now: a chat turn, or the room taking turns. The queue carries on when it ends. */
function launch(ctx, thread, msg, files) {
  const emit = emitTo(ctx.id), tid = thread.id, next = () => drainQueue(ctx, tid);
  if (thread.kind === 'party') void runParty(ctx, tid, msg, files, emit).catch((e) => emit({ type: 'thread.event', thread: tid, role: thread.speaker, kind: thread.kind, party: thread.party, ev: { type: 'turn.error', message: e.message } })).finally(next);
  else void turn(ctx, tid, msg, files).finally(next);
}
/** Once the member is idle, run the first queued message (unless the founder pressed Stop: then the queue waits for them). */
function drainQueue(ctx, tid) {
  if (busy(tid)) return;
  let thread; try { thread = getThread(ctx, tid); } catch { return; }       // the chat is gone
  const [next, ...rest] = thread.queued ?? [];
  if (!next || thread.queue_paused) return;
  setQueue(ctx, tid, rest);
  queueChanged(ctx, thread);
  const files = (next.attachments ?? []).flatMap((id) => { try { return [getAttachment(ctx, tid, id)]; } catch { return []; } });
  launch(ctx, thread, next.text, files);
}
/** Put a message at its place in the queue and, when it interrupts, stop what the member is doing; it starts when the turn has ended. */
function enqueue(ctx, thread, item, interrupt) {
  const queued = thread.queued ?? [];
  if (queued.length >= QUEUE_MAX) fail(`at most ${QUEUE_MAX} messages can wait in a chat`, 409);
  const at = interrupt ? afterInterrupts(queued) : queued.length;
  setQueue(ctx, thread.id, [...queued.slice(0, at), interrupt ? { ...item, now: true } : item, ...queued.slice(at)]);
  queueChanged(ctx, thread);
  if (busy(thread.id)) { if (interrupt) stopParty(thread.id); } else drainQueue(ctx, thread.id);
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
const W = (p) => vorldCtx(p.id);

route('GET', '/api/boot', () => {
  const k = allPacks().byKind, theme = resolveTheme(k, k.defaults?.defaults?.theme ?? 'default') ?? {};
  return {
    version: VERSION, home: HOME, profile: readProfile(HOME), vorlds: listVorlds(), detected: detected(),
    templates: Object.values(k.template ?? {}).sort((a, b) => (a.order ?? 9) - (b.order ?? 9)).map((t) => ({ id: t.id, label: t.label, description: t.description, crew: t.crew ?? [], parties: (t.parties ?? []).map((p) => p.name) })),
    theme: { palette: theme.palette ?? {}, companion: theme.companion ?? {}, agent_names: theme.agent_names ?? [] },
    creatures: k.default_art?.default_art?.creatures ?? {},
    agent_avatars: (k.default_art?.default_art?.characters?.rows ?? []).filter((r) => r.for === 'agent').map((r) => r.id),
  };
});
route('POST', '/api/detect', () => detected(true));
route('GET', '/api/detect/add-yourself', () => ({ text: addYourselfMessage() }));
route('GET', '/api/profile', () => readProfile(HOME));
route('PUT', '/api/profile', async ({ req }) => {
  const profile = saveProfile(HOME, await body(req));
  for (const id of sockets.keys()) emitTo(id)({ type: 'profile', profile });
  return profile;
});
route('GET', '/api/art/:sheet', ({ p, res }) => {
  const image = sheetImage(allPacks(), String(p.sheet).replace(/\.png$/, ''));
  if (!image) fail('unknown sheet', 404);
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(image);
});

// vorlds
route('POST', '/api/vorlds', async ({ req }) => {
  const { id, starters } = createVorld(await body(req));
  const ctx = vorldCtx(id, { fresh: true });
  for (const x of starters) { try { saveParty(ctx, x, null, { starter: true }); } catch { /* a starter that no longer fits the crew is skipped */ } }
  gameFor(ctx);
  return { id };
});
route('GET', '/api/vorlds/:id/vorld', ({ p }) => vorldView(W(p)));
route('PUT', '/api/vorlds/:id', async ({ p, req }) => {
  const b = await body(req), ctx = W(p);
  const folder = b.bench_base === undefined ? undefined : b.bench_base ? checkBench(ctx, String(b.bench_base).trim()) : null;
  const project = b.project === undefined ? undefined : b.project ? checkProject(ctx, String(b.project).trim()) : null;
  const next = saveVorld(ctx, (d) => {
    if (trim(b.name, 60)) d.name = trim(b.name, 60);
    if (b.about !== undefined) d.about = trim(b.about, 400) ?? '';
    if (folder !== undefined) { if (folder) d.benches = { base: folder }; else delete d.benches; }
    if (project !== undefined) { if (project) d.project = project; else delete d.project; }
  });
  vorldChanged(p.id);
  return vorldView(next);
});

// the crew
route('POST', '/api/vorlds/:id/crew', async ({ p, req }) => {
  const ctx = W(p), b = await body(req);
  const rawFolder = b.bench ? String(b.bench).trim() : '';
  const folder = rawFolder ? checkBench(ctx, rawFolder) : null;
  let added;
  const next = saveVorld(ctx, (d) => {
    const m = cleanMember({ brain: d.crew.find((c) => c.role === 'companion')?.brain, ...b }, new Set(['founder', ...d.crew.map((c) => c.id)]));
    // an initial folder is an extra workbench the member's chats start on; its own Main bench is never replaced
    if (folder) { const name = path.basename(folder) || 'Folder', id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'folder'; m.benches = [{ id: id === 'main' ? 'folder' : id, name, path: folder }]; m.default_bench = m.benches[0].id; }
    d.crew.push(m); added = m.id;
  });
  const game = gameFor(next), n = game.check([]);
  if (n.length) emitTo(p.id)({ type: 'game', notes: n, state: game.snapshot() });
  vorldChanged(p.id);
  return { ...vorldView(next), added };
});
route('PUT', '/api/vorlds/:id/crew/:mid', async ({ p, req }) => {
  const ctx = W(p), b = await body(req);
  if (!ctx.member(p.mid)) fail('unknown crew member', 404);
  const next = saveVorld(ctx, (d) => {
    const m = d.crew.find((x) => x.id === p.mid);
    if (trim(b.name, 40)) m.name = trim(b.name, 40);
    for (const [key, n] of [['job', 40], ['function', 400], ['personality', 200]]) if (b[key] !== undefined) { const v = trim(b[key], n); if (v) m[key] = v; else delete m[key]; }
    if (b.avatar !== undefined) { const v = trim(b.avatar, 40)?.replace(/^portrait_/, ''); if (v) m.avatar = v; else delete m.avatar; }
    if (m.role === 'companion' && ['robot', 'creature', 'person'].includes(b.form)) m.form = b.form;
    if (b.brain) m.brain = { provider: trim(b.brain.provider, 40) || 'none', ...(trim(b.brain.model, 120) ? { model: trim(b.brain.model, 120) } : {}), ...(trim(b.brain.name, 40) ? { name: trim(b.brain.name, 40) } : {}) };
  });
  vorldChanged(p.id);
  return vorldView(next);
});
route('DELETE', '/api/vorlds/:id/crew/:mid', ({ p }) => {
  const ctx = W(p), m = ctx.member(p.mid);
  if (!m) fail('unknown crew member', 404);
  if (m.role === 'companion') fail('the companion stays');
  if (listParties(ctx).some((x) => x.members.includes(p.mid) && partyChats(ctx, x.id).some((t) => partyBusy(t.id)))) fail(`${m.name} is busy in a party; stop it first`, 409);
  removeFromParties(ctx, p.mid);
  for (const g of listGrants(ctx).filter((x) => x.role === p.mid)) revoke(ctx, g.id);
  const next = saveVorld(ctx, (d) => { d.crew = d.crew.filter((x) => x.id !== p.mid); });
  vorldChanged(p.id);
  return vorldView(next);
});

// workbenches: the folders a member works in (several; one is the default; each chat starts on one)
const memberOr404 = (ctx, id) => { if (!ctx.member(id)) fail('unknown crew member', 404); };
route('POST', '/api/vorlds/:id/crew/:mid/benches', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.mid);
  if (!String(b.path ?? '').trim()) fail('pick a folder for the bench');
  if (benchesOf(ctx, p.mid).length >= MAX_BENCHES) fail(`a member can have at most ${MAX_BENCHES} workbenches`);
  const folder = checkBench(ctx, String(b.path).trim());
  const name = trim(b.name, 40) || path.basename(folder);
  const id = newBenchId(ctx, p.mid, name);
  const next = saveVorld(ctx, (d) => { const m = d.crew.find((x) => x.id === p.mid); (m.benches ??= []).push({ id, name, path: folder }); if (b.default) m.default_bench = id; });
  vorldChanged(p.id);
  return { ...vorldView(next), added: id };
});
route('PUT', '/api/vorlds/:id/crew/:mid/benches/:bid', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.mid);
  const bench = benchesOf(ctx, p.mid).find((x) => x.id === p.bid);
  if (!bench) fail('unknown workbench', 404);
  const folder = b.path === undefined ? undefined : b.path ? checkBench(ctx, String(b.path).trim()) : null;   // null on the Main bench = back to the default folder
  if (folder === null && p.bid !== 'main') fail('a workbench needs a folder');
  const next = saveVorld(ctx, (d) => {
    const m = d.crew.find((x) => x.id === p.mid);
    m.benches ??= [];
    let e = m.benches.find((x) => x.id === p.bid);
    if (!e) { e = { id: p.bid, name: bench.name }; m.benches.unshift(e); }
    if (trim(b.name, 40)) e.name = trim(b.name, 40);
    if (folder) e.path = folder; else if (folder === null) delete e.path;
    if (p.bid === 'main' && !e.path && e.name === 'Main bench') m.benches = m.benches.filter((x) => x !== e);
    if (b.default === true) m.default_bench = p.bid;
  });
  vorldChanged(p.id);
  return vorldView(next);
});
route('DELETE', '/api/vorlds/:id/crew/:mid/benches/:bid', ({ p }) => {
  const ctx = W(p); memberOr404(ctx, p.mid);
  if (p.bid === 'main') fail('the Main bench stays');
  if (!benchesOf(ctx, p.mid).some((x) => x.id === p.bid)) fail('unknown workbench', 404);
  const next = saveVorld(ctx, (d) => { const m = d.crew.find((x) => x.id === p.mid); m.benches = (m.benches ?? []).filter((x) => x.id !== p.bid); if (m.default_bench === p.bid) delete m.default_bench; });
  vorldChanged(p.id);
  return vorldView(next);
});

// the vault in a member's house: secret NAMES only ever leave the server (values go in, never out)
route('GET', '/api/vorlds/:id/crew/:mid/vault', ({ p }) => { const ctx = W(p); memberOr404(ctx, p.mid); return { secrets: listSecrets(ctx, p.mid), signin: browse.signInState(ctx, p.mid) }; });
route('POST', '/api/vorlds/:id/crew/:mid/vault/secrets', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.mid);
  const name = setSecret(ctx, p.mid, b.name, b.value);
  return { name, secrets: listSecrets(ctx, p.mid) };
});
route('DELETE', '/api/vorlds/:id/crew/:mid/vault/secrets/:name', ({ p }) => {
  const ctx = W(p); memberOr404(ctx, p.mid);
  removeSecret(ctx, p.mid, p.name);
  for (const g of listGrants(ctx).filter((x) => x.role === p.mid && x.capability === 'secret.use' && x.scope === p.name)) revoke(ctx, g.id);
  return { secrets: listSecrets(ctx, p.mid) };
});
// a member's memory (memory.mjs): the founder reads it, corrects a note, and removes notes or chat summaries
route('GET', '/api/vorlds/:id/crew/:mid/memory', ({ p }) => { const ctx = W(p); memberOr404(ctx, p.mid); return { notes: notes(ctx, p.mid), chats: chats(ctx, p.mid) }; });
route('PUT', '/api/vorlds/:id/crew/:mid/memory/notes/:nid', async ({ p, req }) => { const ctx = W(p); memberOr404(ctx, p.mid); return { notes: editNote(ctx, p.mid, p.nid, (await body(req)).text) }; });
route('DELETE', '/api/vorlds/:id/crew/:mid/memory/notes/:nid', ({ p }) => { const ctx = W(p); memberOr404(ctx, p.mid); return { notes: dropNote(ctx, p.mid, p.nid) }; });
route('DELETE', '/api/vorlds/:id/crew/:mid/memory/chats/:tid', ({ p }) => { const ctx = W(p); memberOr404(ctx, p.mid); return { chats: dropChat(ctx, p.mid, p.tid) }; });
// signing in as a member: the founder logs in to sites in a real window; the logins go to that member's vault
route('GET', '/api/vorlds/:id/crew/:mid/signin', ({ p, q }) => { const ctx = W(p); memberOr404(ctx, p.mid); return browse.signInState(ctx, p.mid, q.get('site') ?? ''); });
route('POST', '/api/vorlds/:id/crew/:mid/signin', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.mid);
  try { return await browse.openSignIn(ctx, p.mid, { url: String(b.url ?? '').trim(), emit: emitTo(p.id) }); } catch (e) { fail(e.message); }
});
route('DELETE', '/api/vorlds/:id/crew/:mid/signin', async ({ p }) => { const ctx = W(p); memberOr404(ctx, p.mid); return browse.forgetSignIns(ctx, p.mid); });

// brains
route('GET', '/api/vorlds/:id/settings', ({ p }) => {
  const ctx = W(p);
  return {
    providers: (ctx.doc.providers ?? []).map((q) => ({ ...withoutSecrets(q), api_key_env: looksLikeEnvName(q.api_key_env) ? q.api_key_env : '', has_key: hasKey(ctx, q.name) || (!!q.api_key_env && !looksLikeEnvName(q.api_key_env)) })), detected: detected(),
    catalog: Object.entries(ctx.providers).map(([id, v]) => ({ id, label: v.label, drivers: Object.keys(v.drivers ?? {}), models: v.models ?? {}, presets: v.presets ?? null })),
    storage: { home: fs.realpathSync(HOME), vorld: fs.realpathSync(ctx.dir) },
  };
});
route('PUT', '/api/vorlds/:id/settings', async ({ p, req }) => {
  const b = await body(req);
  // a key is an environment variable name, or the key itself (kept apart from the vorld file, see keys.mjs); it never goes into the vorld file
  if (Array.isArray(b.providers)) { const ctx = W(p), list = cleanProviders(ctx, b.providers.slice(0, 20)); saveVorld(ctx, (d) => { d.providers = list; }); }
  vorldChanged(p.id);
  return { ok: true };
});
route('GET', '/api/vorlds/:id/models', async ({ p, q }) => {
  const ctx = W(p), id = q.get('provider') ?? '', def = ctx.providers[id];
  if (!def) return { source: 'none', live: false, models: [], tiers: {} };
  const name = q.get('name') || undefined;
  const instance = (ctx.doc.providers ?? []).find((x) => x.id === id && (!name || x.name === name));
  return listModels({ id, def, instance: instance && { ...instance, api_key: keyFor(ctx, instance).key ?? undefined }, current: [q.get('current')].filter(Boolean) });
});

// chats (threads)
route('GET', '/api/vorlds/:id/threads', ({ p, q }) => listThreads(W(p), q.get('role'), q.get('kind')));
route('POST', '/api/vorlds/:id/threads', async ({ p, req }) => {
  const ctx = W(p), { role, title, bench } = await body(req);
  if (!ctx.member(role)) fail('unknown crew member');
  // a chat starts on one workbench and stays there (the member's default unless another is picked)
  if (bench && !benchesOf(ctx, role).some((x) => x.id === bench)) fail('unknown workbench');
  return createThread(ctx, { role, kind: 'chat', title: trim(title, 80) || null, bench: benchOf(ctx, role, bench).id });
});
// the active workbench of a chat: picked on the new chat page, locked once the chat has begun (its CLI session belongs to that folder)
route('PUT', '/api/vorlds/:id/threads/:tid', async ({ p, req }) => {
  const { bench } = await body(req), ctx = W(p), t = getThread(ctx, p.tid);
  if (t.kind !== 'chat') fail('only a chat has a workbench');
  if (!benchesOf(ctx, t.role).some((x) => x.id === bench)) fail('unknown workbench');
  if (readEvents(ctx, p.tid).some((e) => e.type === 'founder.message')) fail('this chat has begun, so its workbench stays');
  return updateThread(ctx, p.tid, { bench });
});
route('GET', '/api/vorlds/:id/threads/:tid', ({ p }) => { const ctx = W(p); return { thread: getThread(ctx, p.tid), events: readEvents(ctx, p.tid) }; });
const chatUploads = new Map();
route('DELETE', '/api/vorlds/:id/threads/:tid', ({ p }) => {
  const ctx = W(p);
  if (partyBusy(p.tid) || isWorking(p.tid)) fail('Stop this chat before deleting it.', 409);
  if (chatUploads.has(p.tid)) fail('Wait for uploads to finish before deleting this chat.', 409);
  deleteThread(ctx, p.tid);
  emitTo(p.id)({ type: 'thread.deleted', thread: p.tid });
  return { ok: true };
});
route('POST', '/api/vorlds/:id/threads/:tid/messages', async ({ p, req }) => {
  const { text, attachments, mode } = await body(req);
  const ctx = W(p), thread = getThread(ctx, p.tid);
  const msg = String(text ?? '').trim(), files = resolveAttachments(ctx, p.tid, attachments);
  if (!msg && !files.length) fail('empty message');
  if (msg.length > 20000) fail('message too long', 413);
  // idle: the message starts now. Working: `mode: "queue"` waits its turn; anything else interrupts the member and runs next.
  if (!busy(p.tid) && mode !== 'queue') {
    if (thread.queue_paused) setQueue(ctx, p.tid, thread.queued ?? []);      // writing again picks the waiting queue back up after this message
    launch(ctx, thread, msg, files);
    return { ok: true };
  }
  const queued = thread.queued ?? [];
  if (thread.queue_paused) setQueue(ctx, p.tid, queued);
  enqueue(ctx, getThread(ctx, p.tid), { id: crypto.randomUUID(), text: msg, attachments: files.map((f) => f.id), files: publicFiles(files) }, mode !== 'queue');
  return { ok: true, queued: true };
});
route('POST', '/api/vorlds/:id/threads/:tid/stop', ({ p }) => {
  const ctx = W(p), thread = getThread(ctx, p.tid);
  if (thread.queued?.length) { setQueue(ctx, p.tid, thread.queued, true); queueChanged(ctx, thread); }      // what the founder stopped is not followed by what they queued
  stopParty(p.tid); stopTurn(p.tid); return { ok: true };
});
const queuedItem = (ctx, tid, qid) => { const thread = getThread(ctx, tid), at = (thread.queued ?? []).findIndex((m) => m.id === qid); if (at < 0) fail('that message is not waiting any more', 404); return { thread, at }; };
route('PUT', '/api/vorlds/:id/threads/:tid/queue/:qid', async ({ p, req }) => {
  const ctx = W(p), { thread, at } = queuedItem(ctx, p.tid, p.qid), msg = String((await body(req)).text ?? '').trim();
  const item = thread.queued[at];
  if (!msg && !item.attachments?.length) fail('empty message');
  if (msg.length > 20000) fail('message too long', 413);
  setQueue(ctx, p.tid, thread.queued.map((m, i) => (i === at ? { ...m, text: msg } : m)), !!thread.queue_paused);
  queueChanged(ctx, thread);
  return { ok: true };
});
route('DELETE', '/api/vorlds/:id/threads/:tid/queue/:qid', ({ p }) => {
  const ctx = W(p), { thread, at } = queuedItem(ctx, p.tid, p.qid);
  setQueue(ctx, p.tid, thread.queued.filter((_, i) => i !== at), !!thread.queue_paused);
  queueChanged(ctx, thread);
  return { ok: true };
});
// "Send now": this message goes next, ahead of the others, and stops the turn that is running; the rest stay queued
route('POST', '/api/vorlds/:id/threads/:tid/queue/:qid/send', ({ p }) => {
  const ctx = W(p), { thread, at } = queuedItem(ctx, p.tid, p.qid);
  const item = thread.queued[at], rest = thread.queued.filter((_, i) => i !== at);
  setQueue(ctx, p.tid, rest);
  enqueue(ctx, getThread(ctx, p.tid), item, true);
  return { ok: true };
});
// carry on with the queue after a Stop
route('POST', '/api/vorlds/:id/threads/:tid/queue/resume', ({ p }) => {
  const ctx = W(p), thread = getThread(ctx, p.tid);
  setQueue(ctx, p.tid, thread.queued ?? []);
  queueChanged(ctx, thread);
  drainQueue(ctx, p.tid);
  return { ok: true };
});
async function sendFile(res, file, download = false) {
  res.writeHead(200, { 'content-type': file.type, 'content-disposition': `${download || !file.type.startsWith('image/') ? 'attachment' : 'inline'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  if (file.kind === 'reference') return pipeline(fs.createReadStream(file.path), res);
  res.end(file.data ?? fs.readFileSync(file.path));
}
route('POST', '/api/vorlds/:id/threads/:tid/references', async ({ p, req }) => {
  const { paths } = await body(req), ctx = W(p);
  getThread(ctx, p.tid);
  return addReferences(ctx, p.tid, paths);
});
route('POST', '/api/vorlds/:id/threads/:tid/attachments', async ({ p, req }) => {
  const ctx = W(p); getThread(ctx, p.tid);
  let name; try { name = decodeURIComponent(req.headers['x-file-name'] ?? 'attachment'); } catch { fail('Invalid file name'); }
  chatUploads.set(p.tid, (chatUploads.get(p.tid) ?? 0) + 1);
  try { return await saveAttachmentStream(ctx, p.tid, name, req); }
  finally {
    const remaining = chatUploads.get(p.tid) - 1;
    if (remaining) chatUploads.set(p.tid, remaining);
    else chatUploads.delete(p.tid);
  }
});
route('GET', '/api/vorlds/:id/threads/:tid/attachments/:aid', ({ p, q, res }) => sendFile(res, getAttachment(W(p), p.tid, p.aid), q.has('download')));
route('POST', '/api/vorlds/:id/threads/:tid/file-access', async ({ p, req }) => allowReplyFile(W(p), p.tid, (await body(req)).path));
route('GET', '/api/vorlds/:id/threads/:tid/file', ({ p, q, res }) => sendFile(res, replyFile(W(p), p.tid, q.get('path')), q.has('download')));

// writs
// every request for access still waiting for the founder, across all threads: the crew walks over and asks in a balloon
route('GET', '/api/vorlds/:id/writs/open', ({ p }) => {
  const ctx = W(p);
  return listThreads(ctx).flatMap((t) => openWrits(ctx, t.id).map((w) => ({ id: w.id, thread: t.id, role: w.role, capability: w.capability, scope: w.scope, why: w.why ?? '', risk: w.risk, signin: !!w.signin, at: w.at })));
});
route('POST', '/api/vorlds/:id/threads/:tid/writs/:wid', async ({ p, req }) => {
  const ctx = W(p), emit = emitTo(p.id), game = gameFor(ctx), b = await body(req);
  const thread = getThread(ctx, p.tid);
  const events = readEvents(ctx, p.tid), ask = events.find((e) => e.type === 'writ.request' && e.id === p.wid);
  if (!ask) fail('unknown request', 404);
  if (events.some((e) => e.type === 'writ.answered' && e.id === p.wid)) fail('already answered', 409);
  if (!(ctx.packs.byKind.permissions?.permissions?.answers ?? []).some((a) => a.id === b.answer)) fail('unknown answer');
  if (b.answer === 'always' && ctx.packs.byKind.permissions?.permissions?.capabilities?.[ask.capability]?.seal === 'every_time') fail('this kind of writ is never given for good; allow it once or for this session');
  const notes = [];
  let scope = ask.scope;
  if (b.answer === 'deny') { deny(ctx, { role: ask.role, capability: ask.capability, scope }); game.event('writ.refused'); }
  else {
    scope = checkScope(ctx, ask.capability, b.scope ?? ask.scope);
    // a secret the member asked for is pasted into the card; it goes straight into their vault, never into the thread
    if (ask.capability === 'secret.use' && b.value) setSecret(ctx, ask.role, scope, b.value);
    if (ask.capability === 'secret.use' && !hasSecret(ctx, ask.role, scope)) fail(`paste the value of ${scope} first`);
    if (ask.signin && !browse.signedInTo(ctx, ask.role, scope)) fail(`sign in to ${scope} first, then allow`);
    if (!holds(ctx, ask.role, ask.capability, scope)) grant(ctx, { role: ask.role, capability: ask.capability, scope: ask.capability.startsWith('fs.') ? `${scope}/**` : scope, answer: b.answer });
    game.event('writ.granted').xp('writ_granted', notes);
  }
  const ev = appendEvent(ctx, p.tid, { type: 'writ.answered', id: p.wid, role: ask.role, answer: b.answer, scope });
  emit({ type: 'thread.event', thread: p.tid, role: ask.role, kind: thread.kind, party: thread.party, ev });
  const n = game.check(notes); if (n.length) emit({ type: 'game', notes: n, state: game.snapshot() });
  // pick the work back up once the member is idle (the founder may answer while their last turn is still ending) and no
  // other request of theirs is waiting: a party room carries on, a chat continues on request
  const resume = thread.kind === 'party' ? b.continue !== false : b.answer !== 'deny' && b.continue !== false;
  if (resume) void (async () => {
    for (let i = 0; i < 600 && (isWorking(p.tid) || partyBusy(p.tid)); i++) await new Promise((r) => setTimeout(r, 500));
    if (isWorking(p.tid) || partyBusy(p.tid) || openWrits(ctx, p.tid).some((w) => w.role === ask.role)) return;
    if (thread.kind === 'party') await resumeParty(ctx, p.tid, ask.role, emit);
    else {
      await turn(ctx, p.tid, accessMessage(ctx, p.tid, ask.role));
    }
    drainQueue(ctx, p.tid);
  })().catch(() => {});
  return { ok: true, scope };
});
route('GET', '/api/vorlds/:id/grants', ({ p }) => listGrants(W(p)));
route('DELETE', '/api/vorlds/:id/grants/:gid', ({ p }) => { revoke(W(p), p.gid); return { ok: true }; });

// folder picker. The two /api/fs routes work before a vorld exists (choosing the project folder while founding one).
const noVorld = () => ({ packs: allPacks(), dir: path.join(HOME, 'vorlds', '_new') });
route('GET', '/api/fs/native', () => ({ native: browseConfig(noVorld()).native_dialog !== false ? nativeDialog()?.label ?? null : null }));
route('POST', '/api/fs/pick', async ({ req }) => {
  const b = await body(req), chosen = await pickNative(b.prompt, b.start);
  if (!chosen) return { path: null };
  try { return { path: checkFolder(noVorld(), 'fs.write', chosen) }; } catch (e) { fail(e.message); }
});
route('GET', '/api/vorlds/:id/fs/browse', ({ p, q }) => browseFolder(W(p), { dir: q.get('path') ?? '', capability: q.get('capability') ?? 'fs.write' }));
route('GET', '/api/vorlds/:id/fs/native', ({ p }) => ({ native: browseConfig(W(p)).native_dialog !== false ? nativeDialog()?.label ?? null : null }));
route('POST', '/api/vorlds/:id/fs/pick', async ({ p, req }) => {
  const ctx = W(p), b = await body(req), chosen = await pickNative(b.prompt, b.start);
  if (!chosen) return { path: null };
  try { return { path: checkFolder(ctx, b.capability === 'fs.read' ? 'fs.read' : 'fs.write', chosen) }; } catch (e) { fail(e.message); }
});

// the crew browser: the latest frame (for a panel opened later), interactive in-app takeover, and the tool bridge
route('GET', '/api/vorlds/:id/browser/:role', ({ p }) => browse.latest(W(p), p.role) ?? {});
route('DELETE', '/api/vorlds/:id/browser/:role', async ({ p }) => { await browse.close(W(p), p.role); return { ok: true }; });
route('POST', '/api/vorlds/:id/browser/:role/interactive', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.role);
  try { return await browse.openInteractive(ctx, p.role, { url: String(b.url ?? '').trim(), signed: !!b.signed, emit: emitTo(p.id) }); } catch (e) { fail(e.message); }
});
route('POST', '/api/vorlds/:id/browser/:role/interact', async ({ p, req }) => {
  const ctx = W(p), b = await body(req); memberOr404(ctx, p.role);
  try { return await browse.interact(ctx, p.role, b); } catch (e) { fail(e.message); }
});
route('DELETE', '/api/vorlds/:id/browser/:role/interactive', async ({ p }) => {
  const ctx = W(p); memberOr404(ctx, p.role);
  return browse.closeInteractive(ctx, p.role, { emit: emitTo(p.id) });
});
route('POST', '/api/vorlds/:id/browser/:role/:tool', async ({ p, q, req }) => {
  const ctx = W(p), emit = emitTo(p.id);
  if (!ctx.member(p.role)) fail('unknown crew member', 404);
  const thread = q.get('thread') ? (() => { try { return getThread(ctx, q.get('thread')); } catch { return null; } })() : null;
  // a site without a writ becomes a writ card in the member's thread right away (the brain is waiting on this call)
  const onRequest = (a) => { if (thread) requestAccess(ctx, thread, p.role, [a], (ev) => emit({ type: 'thread.event', thread: thread.id, role: p.role, kind: thread.kind, party: thread.party, ev })); };
  if (p.tool === 'recall') { try { return { ok: true, output: recall(ctx, p.role, await body(req), thread?.id) }; } catch (e) { return { ok: false, output: `error: ${e.message}` }; } }
  if (p.tool === 'secret_ask') { try { return { ok: true, output: askSecret(ctx, p.role, await body(req), onRequest) }; } catch (e) { return { ok: false, output: `error: ${e.message}` }; } }
  try {
    const res = await browse.callTool(ctx, p.role, p.tool, await body(req), { emit, onRequest });
    const output = typeof res === 'object' && res !== null && 'output' in res ? res.output : res;
    const images = typeof res === 'object' && res !== null ? (res.images ?? (res.image ? [res.image] : undefined)) : undefined;
    if (thread && res?.post && images?.length) {
      for (const img of images) {
        if (img.data) {
          try {
            const data = Buffer.from(img.data, 'base64');
            const att = saveAttachment(ctx, thread.id, `screenshot-${Date.now()}.jpg`, data);
            emit({ type: 'thread.event', thread: thread.id, role: p.role, kind: thread.kind, party: thread.party, ev: { type: 'tool_result', name: p.tool, ok: true, output, attachments: publicFiles([att]) } });
          } catch {}
        }
      }
    }
    return { ok: true, output: redactSecrets(ctx, p.role, output), ...(images ? { images, image: images[0] } : {}) };
  }
  catch (e) { return { ok: false, output: `error: ${e.message}` }; }
});

// parties: a name, a goal and members; their chats are shared rooms (see parties.mjs)
route('GET', '/api/vorlds/:id/parties', ({ p }) => listParties(W(p)));
route('POST', '/api/vorlds/:id/parties', async ({ p, req }) => {
  const ctx = W(p), party = saveParty(ctx, await body(req));
  const game = gameFor(ctx), n = game.check([]); if (n.length) emitTo(p.id)({ type: 'game', notes: n, state: game.snapshot() });
  vorldChanged(p.id);
  return { ...vorldView(vorldCtx(p.id, { fresh: true })), added: party.id };
});
route('PUT', '/api/vorlds/:id/parties/:pid', async ({ p, req }) => { const ctx = W(p); saveParty(ctx, await body(req), p.pid); vorldChanged(p.id); return vorldView(vorldCtx(p.id, { fresh: true })); });
route('DELETE', '/api/vorlds/:id/parties/:pid', ({ p }) => { const ctx = W(p); deleteParty(ctx, p.pid); vorldChanged(p.id); return vorldView(vorldCtx(p.id, { fresh: true })); });
route('POST', '/api/vorlds/:id/parties/:pid/shared/open', ({ p }) => { const ctx = W(p); getParty(ctx, p.pid); return { ok: true, path: openShared(ctx, p.pid) }; });   // the party's shared folder in the file manager
route('GET', '/api/vorlds/:id/parties/:pid/chats', ({ p }) => { const ctx = W(p); getParty(ctx, p.pid); return partyChats(ctx, p.pid); });
route('POST', '/api/vorlds/:id/parties/:pid/chats', async ({ p, req }) => createPartyChat(W(p), p.pid, (await body(req)).title));

// ---------- server ----------
function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('Client not built. Run "npm run dev" (development) or "npm run build".'); }
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, url);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' }[ext] ?? 'application/octet-stream';
  let data = fs.readFileSync(file);
  if (ext === '.html') data = Buffer.from(String(data).replace('</head>', `<meta name="ov-token" content="${TOKEN}"></head>`));
  res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!LOCAL_HOSTS.has(req.headers.host ?? '')) return json(res, 403, { error: 'host not allowed' });
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    if (!apiAuthorized(req.headers['x-ov-token'], TOKEN, req.method, url)) return json(res, 401, { error: 'missing or wrong token' });      // the launch token, or a tool bridge's own token for its own call
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (m) { const data = await r.fn({ req, res, p: m.groups ?? {}, q: url.searchParams }); if (!res.writableEnded) json(res, 200, data); return; }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) { res.destroy?.(); return; }
    json(res, e.status ?? 500, { error: e.message, ...(e.code ? { code: e.code, path: e.path } : {}) });
    if (!e.status) console.error(e);
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('vorld');
  if (url.pathname !== '/ws' || url.searchParams.get('t') !== TOKEN || !LOCAL_HOSTS.has(req.headers.host ?? '') || !id) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id).add(ws);
    ws.on('close', () => sockets.get(id)?.delete(ws));
  });
});

// bring every vorld on disk to the current data format (a backup of vorld.yaml is kept first); newer vorlds stay untouched
for (const r of migrateVorlds()) {
  if (r.status === 'migrated') console.log(`vorld ${r.id}: data format ${r.from} -> ${r.to} (${r.steps.join(', ')}); backup ${r.backup}`);
  else if (r.status === 'newer') console.warn(`vorld ${r.id}: saved by a newer OpenVorld (data format ${r.schema}); left untouched, update OpenVorld to open it`);
  else console.warn(`vorld ${r.id}: could not check its data format: ${r.error}`);
}

// a key typed where the variable name goes is moved into the key store (and scrubbed from the chats)
for (const { id } of listVorlds()) { try { const n = adoptLegacyKeys(vorldCtx(id), saveVorld); if (n) console.log(`vorld ${id}: ${n} API key(s) moved out of the vorld file into the key store`); } catch (e) { console.warn(`vorld ${id}: could not check API keys: ${e.message}`); } }

// messages queued before the app closed stay in their chats, but nothing starts by itself on launch: the founder resumes them
for (const { id } of listVorlds()) {
  try { const ctx = vorldCtx(id); for (const t of listThreads(ctx)) if (t.queued?.length && !t.queue_paused) setQueue(ctx, t.id, t.queued, true); }
  catch (e) { console.warn(`vorld ${id}: could not check queued messages: ${e.message}`); }
}

server.listen(PORT, '127.0.0.1', () => {
  // Desktop asks the OS for a free port, leaving a running browser-mode server alone.
  PORT = server.address?.()?.port ?? PORT;
  process.env.OV_PORT = String(PORT);
  LOCAL_HOSTS.add(`127.0.0.1:${PORT}`); LOCAL_HOSTS.add(`localhost:${PORT}`);
  console.log(`OpenVorld server on http://127.0.0.1:${PORT}  (home: ${HOME})`);
  if (!process.env.OV_TOKEN) console.log(`Open http://127.0.0.1:${PORT}/`);
  if (process.env.OV_DESKTOP === '1') process.send?.({ type: 'desktop:ready', port: PORT });
});

if (process.env.OV_DESKTOP === '1') {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 7000);
    stopAllParties();
    await stopAllTurns();
    await browse.closeAll();
    for (const ws of wss.clients) ws.terminate();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    clearTimeout(timeout); process.exit(0);
  };
  process.on('message', message => {
    if (message?.type === 'desktop:status') process.send?.({ type: 'desktop:status', active: activeTurnCount() });
    if (message?.type === 'desktop:shutdown') shutdown().catch(error => { console.error(error); process.exit(1); });
  });
  process.on('disconnect', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
