// Crew memory: what a member keeps between chats, in their private house (<vorld>/houses/<member>/memory/):
//   notes.json  the notebook: short facts the member chose to keep ("remember" in the ov block). Shown in every turn.
//   chats.json  one summary per chat the member took part in ("summary" in the ov block). The latest few start a new chat.
// Older chats are found again with the recall tool, which searches these summaries and the chats themselves.
// The founder can read, edit and delete all of it in the member's settings. Limits and wording: interactions.yaml > agent.memory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { houseDir, redactSecrets } from './house.mjs';
import { listThreads, readEvents } from './threads.mjs';

const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const cfg = (ctx) => ctx.interactions?.agent?.memory ?? {};
export const memoryOn = (ctx) => cfg(ctx).enabled !== false;

const fileOf = (ctx, id, name) => path.join(houseDir(ctx, id), 'memory', name);
function load(ctx, id, name) {
  try { const list = JSON.parse(fs.readFileSync(fileOf(ctx, id, name), 'utf8')); return Array.isArray(list) ? list : []; }
  catch (e) { if (e.code === 'ENOENT') return []; throw new Error(`the memory file ${name} could not be read; it has been kept as it is`); }
}
function save(ctx, id, name, list) {
  const f = fileOf(ctx, id, name);
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f + '.tmp', JSON.stringify(list, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const day = (iso) => String(iso ?? '').slice(0, 10);

// ---------- the notebook ----------
export const notes = (ctx, id) => load(ctx, id, 'notes.json');

/** Apply what a member asked for in one reply. Returns the notes added (for the chat), never throws. */
export function applyMemory(ctx, role, threadId, { remember = [], forget = [], summary } = {}) {
  if (!memoryOn(ctx)) return [];
  try {
    const c = cfg(ctx), max = c.notes_max ?? 40;
    let list = notes(ctx, role).filter((n) => !forget.includes(n.id));
    const added = [];
    for (const raw of remember) {
      const text = clip(redactSecrets(ctx, role, raw), c.note_chars ?? 300);
      if (!text || list.length >= max || list.some((n) => n.text.toLowerCase() === text.toLowerCase())) continue;
      const n = { id: crypto.randomBytes(3).toString('hex'), text, at: new Date().toISOString(), chat: threadId };
      list.push(n); added.push(n.text);
    }
    if (added.length || forget.length) save(ctx, role, 'notes.json', list);
    if (summary) setSummary(ctx, role, threadId, redactSecrets(ctx, role, summary));
    return added;
  } catch { return []; }
}
export function editNote(ctx, id, nid, text) {
  const list = notes(ctx, id), n = list.find((x) => x.id === nid);
  if (!n) bad('that note is gone', 404);
  n.text = clip(text, cfg(ctx).note_chars ?? 300);
  if (!n.text) bad('a note needs some text');
  save(ctx, id, 'notes.json', list);
  return list;
}
export function dropNote(ctx, id, nid) { const list = notes(ctx, id).filter((x) => x.id !== nid); save(ctx, id, 'notes.json', list); return list; }

// ---------- chat summaries ----------
/** The member's chat summaries, newest first, each with its chat's current title. */
export function chats(ctx, id) {
  const titles = new Map(listThreads(ctx).map((t) => [t.id, t.title]));
  return load(ctx, id, 'chats.json').map((s) => ({ ...s, title: titles.get(s.chat) ?? null })).sort((a, b) => b.at.localeCompare(a.at));
}
function setSummary(ctx, id, chat, text) {
  const summary = clip(text, cfg(ctx).summary_chars ?? 600);
  if (!summary) return;
  save(ctx, id, 'chats.json', [...load(ctx, id, 'chats.json').filter((s) => s.chat !== chat), { chat, summary, at: new Date().toISOString() }]);
}
export function dropChat(ctx, id, chat) { save(ctx, id, 'chats.json', load(ctx, id, 'chats.json').filter((s) => s.chat !== chat)); return chats(ctx, id); }

// ---------- what a member is shown ----------
/** The notebook (always) and the latest chat summaries (when a chat starts fresh), as prompt text. */
export function memoryContext(ctx, role, threadId, { recent = true } = {}) {
  if (!memoryOn(ctx)) return '';
  try {
    const c = cfg(ctx), list = notes(ctx, role);
    const lines = [`Your notebook (${list.length} of ${c.notes_max ?? 40} notes; only you and the founder see it):`,
      ...(list.length ? list.map((n) => `- [${n.id}] ${n.text}`) : ['- (empty)'])];
    const past = recent ? chats(ctx, role).filter((s) => s.chat !== threadId).slice(0, c.recent_chats ?? 5) : [];
    if (past.length) lines.push('', 'Your latest other chats:', ...past.map((s) => `- [chat ${s.chat}] "${s.title ?? 'Chat'}" (${day(s.at)}): ${s.summary}`));
    return [lines.join('\n'), c.instructions ?? ''].filter(Boolean).join('\n\n');
  } catch { return ''; }
}

// ---------- recall ----------
/** The chats a member may look back at: their own chats, and party rooms they spoke in. */
function chatsOf(ctx, role) {
  return listThreads(ctx).flatMap((t) => {
    if (t.role !== role && t.kind !== 'party') return [];
    const events = readEvents(ctx, t.id).filter((e) => e.type === 'founder.message' || e.type === 'agent.text');
    return t.role === role || events.some((e) => e.role === role) ? [{ t, events }] : [];
  });
}
const speakerOf = (ctx, role, e) => e.type === 'founder.message' ? 'Founder' : e.role === role || !e.role ? 'You' : ctx.member(e.role)?.name ?? e.role;

/**
 * The recall tool. With `chat`: that chat's latest messages. With `query`: the chats that match best, with their summary
 * and a matching line. With neither: the latest chats.
 */
export function recall(ctx, role, { query = '', chat = '' } = {}) {
  if (!memoryOn(ctx)) return 'Memory is switched off in this vorld.';
  const c = cfg(ctx), all = chatsOf(ctx, role), summaries = new Map(chats(ctx, role).map((s) => [s.chat, s.summary]));
  const head = ({ t }) => `[chat ${t.id}] "${t.title ?? 'Chat'}" (${day(t.updated_at)})${summaries.has(t.id) ? `: ${summaries.get(t.id)}` : ''}`;
  let out;
  if (chat) {
    const found = all.find(({ t }) => t.id === String(chat).trim());
    if (!found) return `No chat ${chat} that you took part in.`;
    const lines = []; let size = 0;
    for (const e of [...found.events].reverse()) {
      const line = `${speakerOf(ctx, role, e)}: ${String(e.text ?? '').trim()}`;
      if (size + line.length > (c.recall_chars ?? 8000) && lines.length) break;
      lines.unshift(line); size += line.length;
    }
    out = `${head(found)}\n\n${lines.join('\n\n') || '(no messages)'}`;
  } else {
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
    const hits = (s) => words.reduce((n, w) => n + (String(s ?? '').toLowerCase().includes(w) ? 1 : 0), 0);
    const ranked = all.map((x) => {
      const best = x.events.map((e) => ({ e, n: hits(e.text) })).sort((a, b) => b.n - a.n)[0];
      return { ...x, best, score: 3 * hits(`${x.t.title} ${summaries.get(x.t.id) ?? ''}`) + (best?.n ?? 0) };
    }).filter((x) => !words.length || x.score > 0)
      .sort((a, b) => b.score - a.score || b.t.updated_at.localeCompare(a.t.updated_at)).slice(0, c.recall_results ?? 5);
    if (!ranked.length) return words.length ? `Nothing in your past chats matches "${clip(query, 80)}".` : 'You have no past chats yet.';
    out = ranked.map((x) => {
      const quote = words.length && x.best?.n ? `\n  > ${speakerOf(ctx, role, x.best.e)}: ${clip(x.best.e.text, 240)}` : '';
      return `- ${head(x)}${quote}`;
    }).join('\n') + '\n\nCall recall with a chat id to read that chat.';
  }
  return redactSecrets(ctx, role, out);
}
