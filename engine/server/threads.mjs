// Threads: one conversation with one crew member (kind "chat"), or one step of a quest (kind "quest"). Index in
// threads/index.json, events in threads/<id>.jsonl (append-only, so a crash never corrupts history).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dirOf = (ctx) => path.join(ctx.dir, 'threads');
const indexFile = (ctx) => path.join(dirOf(ctx), 'index.json');

function readIndex(ctx) {
  try {
    const list = JSON.parse(fs.readFileSync(indexFile(ctx), 'utf8'));
    if (!Array.isArray(list)) throw new Error('invalid thread index');
    return list;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    // A failed read must never look like an empty history or be overwritten by a new chat.
    throw Object.assign(new Error('Saved chats could not be read. Your history has been kept; check the vorld data folder.'), { status: 500, cause: e });
  }
}
function writeIndex(ctx, list) {
  fs.mkdirSync(dirOf(ctx), { recursive: true });
  fs.writeFileSync(indexFile(ctx) + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(indexFile(ctx) + '.tmp', indexFile(ctx));
}

export function listThreads(ctx, role, kind) {
  return readIndex(ctx).filter((t) => (!role || t.role === role) && (!kind || t.kind === kind)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function getThread(ctx, id) {
  const t = readIndex(ctx).find((x) => x.id === id);
  if (!t) throw Object.assign(new Error('thread not found'), { status: 404 });
  return t;
}
export function createThread(ctx, { role, kind = 'chat', title, ...extra }) {
  const now = new Date().toISOString();
  const t = { id: crypto.randomUUID(), role, kind, title: title || null, state: 'open', created_at: now, updated_at: now, session_id: null, ...extra };
  writeIndex(ctx, [...readIndex(ctx), t]);
  return t;
}
export function updateThread(ctx, id, patch) {
  const list = readIndex(ctx);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw Object.assign(new Error('thread not found'), { status: 404 });
  list[i] = { ...list[i], ...patch, updated_at: new Date().toISOString() };
  writeIndex(ctx, list);
  return list[i];
}
export function appendEvent(ctx, id, ev) {
  fs.mkdirSync(dirOf(ctx), { recursive: true });
  const line = { at: new Date().toISOString(), ...ev };
  fs.appendFileSync(path.join(dirOf(ctx), `${id}.jsonl`), JSON.stringify(line) + '\n');
  return line;
}
export function readEvents(ctx, id) {
  const f = path.join(dirOf(ctx), `${id}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
/** Conversation history as plain turns, for stateless drivers (APIs). */
export function history(ctx, id, max = 30) {
  return readEvents(ctx, id).filter((e) => e.type === 'founder.message' || e.type === 'agent.text').slice(-max)
    .map((e) => ({ role: e.type === 'founder.message' ? 'user' : 'assistant', content: e.text, ...(e.attachments?.length ? {attachments:e.attachments} : {}) }));
}
