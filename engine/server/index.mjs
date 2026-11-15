// openVorld local server. Binds to 127.0.0.1 only; every API call and the WebSocket need the per-launch token
// (injected into the page it serves), and Host must be localhost (DNS-rebinding guard).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer } from 'ws';
import { HOME, allPacks, listVorlds, vorldCtx, saveVorld, createVorld, cleanMember, detected } from './vorld.mjs';
import { atlasFor, sheetFiles } from './art.mjs';
import { gameFor } from './game.mjs';
import { listThreads, createThread, getThread, readEvents, appendEvent } from './threads.mjs';
import { runTurn, stopTurn, brainOf, isWorking } from './agents/runner.mjs';
import { listQuests, getQuest, saveQuest, deleteQuest, draftQuest, startQuest, stopQuest, retry, seal, advance, recoverQuests } from './quests.mjs';
import { saveAttachmentStream, getAttachment, resolveAttachments, replyFile, addReferences } from './attachments.mjs';
import { listGrants, grant, revoke, checkFolder, checkScope, deny } from './gate.mjs';
import { browseFolder, pickNative, nativeDialog, browseConfig } from './browse.mjs';
import { workspaceOf, defaultSpace, checkWorkspace, projectOf, checkProject } from './workspace.mjs';
import { listModels } from './models.mjs';
import { REPO, resolveTheme } from '../../tools/lib/packs.mjs';

const PORT = Number(process.env.OV_PORT ?? 4317);
const TOKEN = process.env.OV_TOKEN || crypto.randomBytes(24).toString('hex');
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
  const working = new Set(listThreads(ctx).filter((t) => t.state === 'working' && isWorking(t.id)).map((t) => t.role));
  const k = ctx.packs.byKind;
  const scenery = k.scenery?.scenery ?? {};
  return {
    vorld: { id: ctx.id, name: ctx.doc.name, about: ctx.doc.about ?? '', project: (({ path: p, chosen, exists }) => ({ path: p, chosen, exists }))(projectOf(ctx)) },
    crew: ctx.crew.map((c) => {
      const b = brainOf(ctx, c.id), ws = workspaceOf(ctx, c.id);
      return { id: c.id, role: c.role, order: c.order, name: c.name, job: c.job, function: c.function, personality: ctx.doc.crew.find((m) => m.id === c.id)?.personality ?? '', look: c.look, home: c.home,
        brain: c.brain ?? null, brain_label: b.provider === 'none' ? null : `${b.label}${b.model ? ' · ' + b.model : ''}`, working: working.has(c.id),
        workspace: { path: ws.path, source: ws.source, chosen: ws.chosen, default_path: path.join(defaultSpace(ctx).path, c.id) } };
    }),
    theme: { palette: ctx.theme.palette ?? {}, buildings: ctx.theme.buildings ?? {}, strings: ctx.theme.strings ?? {} },
    interactions: { reactions: ctx.interactions.reactions ?? {}, chat: ctx.interactions.agent?.chat ?? {} },
    permissions: { answers: k.permissions?.permissions?.answers ?? [], capabilities: Object.fromEntries(Object.entries(k.permissions?.permissions?.capabilities ?? {}).map(([id, c]) => [id, { label: c.label ?? id, risk: c.risk ?? 'medium' }])) },
    workspace: { default_space: defaultSpace(ctx).path, default_is_custom: defaultSpace(ctx).custom },
    scenery: ctx.scenery(),
    art: { scenery, creatures: k.default_art?.default_art?.creatures ?? {}, house_sprites: k.default_art?.default_art?.illustrated_houses ?? [], atlas: atlasFor(ctx) },
    deeds: game.deedList().map(({ id, name, desc, hint, xp, icon, hidden }) => ({ id, name, desc, hint, xp, icon, hidden: !!hidden })),
    state: game.snapshot(),
  };
}
const vorldChanged = (id) => emitTo(id)({ type: 'vorld' });

/** One turn in a thread; quest threads then move their quest on, and a companion's drafted quest is saved. */
async function turn(ctx, tid, text, files = []) {
  const emit = emitTo(ctx.id), thread = getThread(ctx, tid);
  try {
    const r = await runTurn(ctx, tid, text, emit, files);
    if (r?.meta?.quest) { const q = draftQuest(ctx, r.meta.quest, tid); if (q) { emit({ type: 'quest', quest: q }); emit({ type: 'thread.event', thread: tid, role: thread.role, ev: { type: 'quest.draft', quest: q.id, title: q.title } }); } }
  } catch (e) { emit({ type: 'thread.event', thread: tid, role: thread.role, ev: { type: 'turn.error', message: e.message } }); }
  if (thread.kind === 'quest' && thread.quest) await advance(ctx, thread.quest, emit);
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
const W = (p) => vorldCtx(p.id);

route('GET', '/api/boot', () => {
  const k = allPacks().byKind, theme = resolveTheme(k, k.defaults?.defaults?.theme ?? 'default') ?? {};
  return {
    version: VERSION, home: HOME, vorlds: listVorlds(), detected: detected(),
    templates: Object.values(k.template ?? {}).sort((a, b) => (a.order ?? 9) - (b.order ?? 9)).map((t) => ({ id: t.id, label: t.label, description: t.description, crew: t.crew ?? [], quests: (t.quests ?? []).map((q) => q.title) })),
    theme: { palette: theme.palette ?? {}, companion: theme.companion ?? {}, agent_names: theme.agent_names ?? [] },
    creatures: k.default_art?.default_art?.creatures ?? {},
  };
});
route('POST', '/api/detect', () => detected(true));
route('GET', '/api/art/:sheet', ({ p, res }) => {
  const s = sheetFiles(allPacks())[String(p.sheet).replace(/\.png$/, '')];
  if (!s?.file) fail('unknown sheet', 404);
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(fs.readFileSync(s.file));
});

// vorlds
route('POST', '/api/vorlds', async ({ req }) => {
  const { id, starters } = createVorld(await body(req));
  const ctx = vorldCtx(id, { fresh: true });
  for (const q of starters) { try { saveQuest(ctx, q, null, { starter: true }); } catch { /* a starter that no longer fits the crew is skipped */ } }
  gameFor(ctx);
  return { id };
});
route('GET', '/api/vorlds/:id/vorld', ({ p }) => vorldView(W(p)));
route('PUT', '/api/vorlds/:id', async ({ p, req }) => {
  const b = await body(req), ctx = W(p);
  const folder = b.workspace_base === undefined ? undefined : b.workspace_base ? checkWorkspace(ctx, String(b.workspace_base).trim()) : null;
  const project = b.project === undefined ? undefined : b.project ? checkProject(ctx, String(b.project).trim()) : null;
  const next = saveVorld(ctx, (d) => {
    if (trim(b.name, 60)) d.name = trim(b.name, 60);
    if (b.about !== undefined) d.about = trim(b.about, 400) ?? '';
    if (folder !== undefined) { if (folder) d.workspace = { base: folder }; else delete d.workspace; }
    if (project !== undefined) { if (project) d.project = project; else delete d.project; }
  });
  vorldChanged(p.id);
  return vorldView(next);
});

// the crew
route('POST', '/api/vorlds/:id/crew', async ({ p, req }) => {
  const ctx = W(p), b = await body(req);
  const rawFolder = b.workspace ? String(b.workspace).trim() : '';
  const folder = rawFolder ? checkWorkspace(ctx, rawFolder) : null;
  let added;
  const next = saveVorld(ctx, (d) => {
    const m = cleanMember({ brain: d.crew.find((c) => c.role === 'companion')?.brain, ...b }, new Set(['founder', ...d.crew.map((c) => c.id)]));
    if (folder) m.workspace = folder;
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
  const folder = b.workspace === undefined ? undefined : b.workspace ? checkWorkspace(ctx, String(b.workspace).trim()) : null;
  const next = saveVorld(ctx, (d) => {
    const m = d.crew.find((x) => x.id === p.mid);
    if (trim(b.name, 40)) m.name = trim(b.name, 40);
    for (const [key, n] of [['job', 40], ['function', 400], ['personality', 200]]) if (b[key] !== undefined) { const v = trim(b[key], n); if (v) m[key] = v; else delete m[key]; }
    if (m.role === 'companion' && ['robot', 'creature', 'person'].includes(b.form)) m.form = b.form;
    if (b.brain) m.brain = { provider: trim(b.brain.provider, 40) || 'none', ...(trim(b.brain.model, 120) ? { model: trim(b.brain.model, 120) } : {}), ...(trim(b.brain.name, 40) ? { name: trim(b.brain.name, 40) } : {}) };
    if (folder !== undefined) { if (folder) m.workspace = folder; else delete m.workspace; }
  });
  vorldChanged(p.id);
  return vorldView(next);
});
route('DELETE', '/api/vorlds/:id/crew/:mid', ({ p }) => {
  const ctx = W(p), m = ctx.member(p.mid);
  if (!m) fail('unknown crew member', 404);
  if (m.role === 'companion') fail('the companion stays');
  if (listQuests(ctx).some((q) => ['running', 'waiting'].includes(q.status) && q.steps.some((s) => s.agent === p.mid))) fail(`${m.name} is on a running quest; stop it first`, 409);
  for (const g of listGrants(ctx).filter((x) => x.role === p.mid)) revoke(ctx, g.id);
  const next = saveVorld(ctx, (d) => { d.crew = d.crew.filter((x) => x.id !== p.mid); });
  vorldChanged(p.id);
  return vorldView(next);
});

// brains
route('GET', '/api/vorlds/:id/settings', ({ p }) => {
  const ctx = W(p);
  return {
    providers: withoutSecrets(ctx.doc.providers ?? []), detected: detected(),
    catalog: Object.entries(ctx.providers).map(([id, v]) => ({ id, label: v.label, drivers: Object.keys(v.drivers ?? {}), models: v.models ?? {}, presets: v.presets ?? null })),
    storage: { home: fs.realpathSync(HOME), vorld: fs.realpathSync(ctx.dir) },
  };
});
route('PUT', '/api/vorlds/:id/settings', async ({ p, req }) => {
  const b = await body(req);
  if (Array.isArray(b.providers)) saveVorld(W(p), (d) => { d.providers = withoutSecrets(b.providers).slice(0, 20); });   // keys are never stored: use api_key_env
  vorldChanged(p.id);
  return { ok: true };
});
route('GET', '/api/vorlds/:id/models', async ({ p, q }) => {
  const ctx = W(p), id = q.get('provider') ?? '', def = ctx.providers[id];
  if (!def) return { source: 'none', live: false, models: [], tiers: {} };
  const name = q.get('name') || undefined;
  const instance = (ctx.doc.providers ?? []).find((x) => x.id === id && (!name || x.name === name));
  return listModels({ id, def, instance, current: [q.get('current')].filter(Boolean) });
});

// chats (threads)
route('GET', '/api/vorlds/:id/threads', ({ p, q }) => listThreads(W(p), q.get('role'), q.get('kind')));
route('POST', '/api/vorlds/:id/threads', async ({ p, req }) => {
  const ctx = W(p), { role, title } = await body(req);
  if (!ctx.member(role)) fail('unknown crew member');
  return createThread(ctx, { role, kind: 'chat', title: trim(title, 80) || null });
});
route('GET', '/api/vorlds/:id/threads/:tid', ({ p }) => { const ctx = W(p); return { thread: getThread(ctx, p.tid), events: readEvents(ctx, p.tid) }; });
route('POST', '/api/vorlds/:id/threads/:tid/messages', async ({ p, req }) => {
  const ctx = W(p), thread = getThread(ctx, p.tid);
  if (isWorking(p.tid)) fail('this crew member is still working', 409);
  if (thread.kind === 'quest') { const qs = getQuest(ctx, thread.quest); if (['running'].includes(qs.status)) fail('this quest step is running; wait for it', 409); }
  const { text, attachments } = await body(req);
  const msg = String(text ?? '').trim(), files = resolveAttachments(ctx, p.tid, attachments);
  if (!msg && !files.length) fail('empty message');
  if (msg.length > 20000) fail('message too long', 413);
  void turn(ctx, p.tid, msg, files);
  return { ok: true };
});
route('POST', '/api/vorlds/:id/threads/:tid/stop', ({ p }) => { stopTurn(p.tid); return { ok: true }; });
async function sendFile(res, file, download = false) {
  res.writeHead(200, { 'content-type': file.type, 'content-disposition': `${download || !file.type.startsWith('image/') ? 'attachment' : 'inline'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  if (file.kind === 'reference') return pipeline(fs.createReadStream(file.path), res);
  res.end(file.data ?? fs.readFileSync(file.path));
}
route('POST', '/api/vorlds/:id/threads/:tid/references', async ({ p, req }) => { const ctx = W(p); getThread(ctx, p.tid); return addReferences(ctx, p.tid, (await body(req)).paths); });
route('POST', '/api/vorlds/:id/threads/:tid/attachments', async ({ p, req }) => {
  const ctx = W(p); getThread(ctx, p.tid);
  let name; try { name = decodeURIComponent(req.headers['x-file-name'] ?? 'attachment'); } catch { fail('Invalid file name'); }
  return saveAttachmentStream(ctx, p.tid, name, req);
});
route('GET', '/api/vorlds/:id/threads/:tid/attachments/:aid', ({ p, q, res }) => sendFile(res, getAttachment(W(p), p.tid, p.aid), q.has('download')));
route('GET', '/api/vorlds/:id/threads/:tid/file', ({ p, q, res }) => sendFile(res, replyFile(W(p), p.tid, q.get('path')), q.has('download')));

// writs
route('POST', '/api/vorlds/:id/threads/:tid/writs/:wid', async ({ p, req }) => {
  const ctx = W(p), emit = emitTo(p.id), game = gameFor(ctx), b = await body(req);
  const events = readEvents(ctx, p.tid), ask = events.find((e) => e.type === 'writ.request' && e.id === p.wid);
  if (!ask) fail('unknown request', 404);
  if (events.some((e) => e.type === 'writ.answered' && e.id === p.wid)) fail('already answered', 409);
  if (!(ctx.packs.byKind.permissions?.permissions?.answers ?? []).some((a) => a.id === b.answer)) fail('unknown answer');
  const notes = [];
  let scope = ask.scope;
  if (b.answer === 'deny') { deny(ctx, { role: ask.role, capability: ask.capability, scope }); game.event('writ.refused'); }
  else {
    scope = checkScope(ctx, ask.capability, b.scope ?? ask.scope);
    grant(ctx, { role: ask.role, capability: ask.capability, scope: ask.capability.startsWith('fs.') ? `${scope}/**` : scope, answer: b.answer });
    game.event('writ.granted').xp('writ_granted', notes);
  }
  const ev = appendEvent(ctx, p.tid, { type: 'writ.answered', id: p.wid, role: ask.role, answer: b.answer, scope });
  emit({ type: 'thread.event', thread: p.tid, role: ask.role, ev });
  const n = game.check(notes); if (n.length) emit({ type: 'game', notes: n, state: game.snapshot() });
  // pick the work back up: always inside a quest (a refusal too, so the member can adapt), on request in a chat
  const thread = getThread(ctx, p.tid);
  if (!isWorking(p.tid) && (thread.kind === 'quest' || (b.answer !== 'deny' && b.continue !== false))) {
    const label = ctx.packs.byKind.permissions?.permissions?.capabilities?.[ask.capability]?.label ?? ask.capability;
    void turn(ctx, p.tid, b.answer === 'deny' ? `Access refused: you may not ${label} ${scope}. Carry on without it.` : `Access granted: you may ${label} ${scope}. Please continue.`);
  }
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

// quests
route('GET', '/api/vorlds/:id/quests', ({ p }) => listQuests(W(p)));
route('GET', '/api/vorlds/:id/quests/:qid', ({ p }) => getQuest(W(p), p.qid));
route('POST', '/api/vorlds/:id/quests', async ({ p, req }) => { const ctx = W(p), q = saveQuest(ctx, await body(req)); const g = gameFor(ctx), n = g.check([]); if (n.length) emitTo(p.id)({ type: 'game', notes: n, state: g.snapshot() }); emitTo(p.id)({ type: 'quest', quest: q }); return q; });
route('PUT', '/api/vorlds/:id/quests/:qid', async ({ p, req }) => { const q = saveQuest(W(p), await body(req), p.qid); emitTo(p.id)({ type: 'quest', quest: q }); return q; });
route('DELETE', '/api/vorlds/:id/quests/:qid', ({ p }) => { const r = deleteQuest(W(p), p.qid); emitTo(p.id)({ type: 'quest', removed: p.qid }); return r; });
route('POST', '/api/vorlds/:id/quests/:qid/start', ({ p }) => startQuest(W(p), p.qid, emitTo(p.id)));
route('POST', '/api/vorlds/:id/quests/:qid/stop', ({ p }) => stopQuest(W(p), p.qid, emitTo(p.id)));
route('POST', '/api/vorlds/:id/quests/:qid/retry', ({ p }) => retry(W(p), p.qid, emitTo(p.id)));
route('POST', '/api/vorlds/:id/quests/:qid/seal', async ({ p, req }) => seal(W(p), p.qid, await body(req), emitTo(p.id)));

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
    if (req.headers['x-ov-token'] !== TOKEN) return json(res, 401, { error: 'missing or wrong token' });
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (m) { const data = await r.fn({ req, res, p: m.groups ?? {}, q: url.searchParams }); if (!res.writableEnded) json(res, 200, data); return; }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) { res.destroy?.(); return; }
    json(res, e.status ?? 500, { error: e.message });
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

for (const w of listVorlds()) { try { recoverQuests(vorldCtx(w.id)); } catch { /* a broken vorld never stops the server */ } }
server.listen(PORT, '127.0.0.1', () => {
  console.log(`openVorld server on http://127.0.0.1:${PORT}  (home: ${HOME})`);
  if (!process.env.OV_TOKEN) console.log(`Open http://127.0.0.1:${PORT}/`);
});
