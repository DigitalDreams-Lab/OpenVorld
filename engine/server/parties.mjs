// Parties: a named group of crew members with a goal, and a shared room to talk in.
//
// A party has a name, a goal and one or more members (the first is the leader). Its chats are threads of kind "party":
// ONE shared transcript, every message tagged with who said it. When the founder writes in the room:
//   1. the leader answers (or the member the founder @mentions);
//   2. a member who needs a teammate writes @Name in the reply, and that teammate takes the next turn;
//   3. a reply that @mentions nobody ends the job. A cap on turns per message keeps a chat from running away.
// The party joins the founder for a conversation and stays nearby between messages. A member who
// asks for a writ pauses the room; the founder's answer picks it up again.
//
// Files: <vorld>/parties/<id>.json. Chats: threads/<tid>.jsonl like any other thread.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createThread, getThread, listThreads, readEvents, appendEvent, updateThread } from './threads.mjs';
import { runTurn, isWorking, stopTurn, openWrits } from './agents/runner.mjs';
import { publicFiles } from './attachments.mjs';
import { gameFor } from './game.mjs';

const dirOf = (ctx) => path.join(ctx.dir, 'parties');
const fileOf = (ctx, id) => path.join(dirOf(ctx), `${id}.json`);
const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const MAX_MEMBERS = 12;

export function listParties(ctx) {
  if (!fs.existsSync(dirOf(ctx))) return [];
  return fs.readdirSync(dirOf(ctx)).filter((f) => f.endsWith('.json')).flatMap((f) => { try { return [JSON.parse(fs.readFileSync(path.join(dirOf(ctx), f), 'utf8'))]; } catch { return []; } })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export function getParty(ctx, id) {
  if (!/^[\w-]{6,64}$/.test(String(id))) bad('unknown party', 404);
  try { return JSON.parse(fs.readFileSync(fileOf(ctx, id), 'utf8')); } catch { bad('unknown party', 404); }
}
function write(ctx, p) {
  fs.mkdirSync(dirOf(ctx), { recursive: true });
  p.updated_at = new Date().toISOString();
  fs.writeFileSync(fileOf(ctx, p.id) + '.tmp', JSON.stringify(p, null, 2));
  fs.renameSync(fileOf(ctx, p.id) + '.tmp', fileOf(ctx, p.id));
  return p;
}

/** Create or update a party: a name, a goal and 1 to MAX_MEMBERS crew members (the first leads). */
export function saveParty(ctx, input, id = null, { starter = false } = {}) {
  const name = str(input.name, 60);
  if (!name) bad('a party needs a name');
  const wanted = Array.isArray(input.members) ? input.members.map(String) : [];
  const members = [...new Set(wanted)].filter((m) => ctx.member(m));
  if (!members.length) bad('a party needs at least one member');
  if (members.length > MAX_MEMBERS) bad(`a party can have at most ${MAX_MEMBERS} members`);
  const now = new Date().toISOString();
  const p = id ? getParty(ctx, id) : { id: crypto.randomUUID(), created_at: now };
  Object.assign(p, { name, goal: str(input.goal, 2000), members });
  if (!id && !starter) gameFor(ctx).event('party.created');
  return write(ctx, p);
}
export function deleteParty(ctx, id) {
  const p = getParty(ctx, id);
  if (partyChats(ctx, p.id).some((t) => partyBusy(t.id))) bad('this party is busy; stop it first', 409);
  fs.rmSync(fileOf(ctx, id), { force: true });
  return { ok: true };
}
/** A crew member left: take them out of every party. */
export function removeFromParties(ctx, member) {
  for (const p of listParties(ctx)) if (p.members.includes(member)) write(ctx, { ...p, members: p.members.filter((m) => m !== member) });
}

// ---------- chats ----------
export const partyChats = (ctx, id) => listThreads(ctx, null, 'party').filter((t) => t.party === id);
export function createPartyChat(ctx, id, title) {
  const p = getParty(ctx, id);
  return createThread(ctx, { role: null, kind: 'party', party: p.id, title: str(title, 80) || null });
}

// ---------- the room ----------
const chains = new Set();            // party chats whose job is running now
const stopped = new Set();
export const partyBusy = (tid) => chains.has(tid) || isWorking(tid);
export function stopParty(tid) { if (chains.has(tid)) stopped.add(tid); stopTurn(tid); }
export function stopAllParties() { for (const tid of chains) stopParty(tid); }

const cfg = (ctx) => ({ max_turns: 12, message_chars: 2500, room_events: 40, ...(ctx.interactions.party ?? {}) });
const nameOf = (ctx, id) => ctx.member(id)?.name ?? id;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first @mentioned teammate in a text (not `self`), earliest wins. Code blocks do not count. */
export function mentionOf(ctx, text, members, self = null) {
  const clean = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  let best = null;
  for (const id of members) {
    if (id === self) continue;
    const m = ctx.member(id); if (!m) continue;
    for (const alias of new Set([m.name, m.name.split(/\s+/)[0]])) {
      const hit = new RegExp(`@${esc(alias)}(?![\\p{L}\\p{N}_])`, 'iu').exec(clean);
      if (hit && (!best || hit.index < best.at)) best = { id, at: hit.index };
    }
  }
  return best?.id ?? null;
}

/** `@all`, `@everyone`, `@everybody`, `@team` or `@crew` in the founder's message (code blocks do not count), unless a member goes by that name. */
const ALL_WORDS = /(?:^|[^\p{L}\p{N}_])@(all|everyone|everybody|team|crew)(?![\p{L}\p{N}_])/iu;
export function asksEveryone(ctx, text, members) {
  const hit = ALL_WORDS.exec(String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' '));
  if (!hit) return false;
  const word = hit[1].toLowerCase();
  return !members.some((id) => { const m = ctx.member(id); return m && [m.name, m.name.split(/\s+/)[0]].some((a) => a.toLowerCase() === word); });
}

/** Who answers a founder's message: everyone, in the party's order, for `@all`; else the first @mentioned member, else the leader. Only the founder can ask everyone. */
export function founderSpeakers(ctx, text, members) {
  if (asksEveryone(ctx, text, members)) return [...members];
  return [mentionOf(ctx, text, members) ?? members[0]];
}

/** The room as plain lines, newest last: what the member is told to react to. */
function transcript(ctx, tid) {
  const { message_chars: max, room_events: n } = cfg(ctx);
  const cut = (t) => (t.length > max ? t.slice(0, max) + ' … (cut)' : t);
  const lines = readEvents(ctx, tid).flatMap((e) => {
    if (e.type === 'founder.message') return [`Founder: ${cut(e.text)}`];
    if (e.type === 'agent.text' && !e.partial) return [`${nameOf(ctx, e.role)}: ${cut(e.text)}`];
    if (e.type === 'writ.answered') return [`[The founder ${e.answer === 'deny' ? 'refused' : 'granted'} ${nameOf(ctx, e.role)} access to ${e.scope}]`];
    return [];
  });
  return lines.slice(-n).join('\n\n');
}

/** What one member is told on its turn. */
export function roomPrompt(ctx, party, tid, role) {
  const m = ctx.member(role);
  const team = party.members.map((id) => ctx.member(id)).filter(Boolean)
    .map((x) => `${x.name} (${x.job || 'crew'}${x.function ? `: ${x.function}` : ''})${x.id === party.members[0] ? ' - leader' : ''}${x.id === role ? ' - you' : ''}`).join('; ');
  return [
    `You are ${m.name} in the party "${party.name}".`,
    party.goal ? `The party's goal: ${party.goal}` : '',
    `Party members: ${team}.`,
    'This is the party room: everybody sees every message. Below is the conversation so far.',
    transcript(ctx, tid),
    `Now it is your turn, ${m.name}. Do the part of the work that is yours and reply in the room. If you need a teammate to act next, write @Name in your reply and say exactly what you need from them; that teammate speaks next. Mention nobody unless you need them to act. When the job (or your part of it, with nobody else needed) is finished, reply with the result and mention nobody: that ends the job.`,
  ].filter(Boolean).join('\n\n');
}


/**
 * The founder writes in a party chat: the room takes turns until the job is done (or someone needs the founder).
 * Resolves when the room goes quiet. `files` are given to the first speaker.
 */
export async function runParty(ctx, tid, text, files, emit) {
  const thread = getThread(ctx, tid);
  if (thread.kind !== 'party') bad('not a party chat');
  const party = getParty(ctx, thread.party);
  const members = party.members.filter((m) => ctx.member(m));
  if (!members.length) bad('this party has no members left');
  if (partyBusy(tid)) bad('the party is still working', 409);
  const msg = String(text ?? '').trim();
  appendEvent(ctx, tid, { type: 'founder.message', text: msg, ...(files.length ? { attachments: publicFiles(files) } : {}) });
  if (!thread.title) updateThread(ctx, tid, { title: msg.slice(0, 48) || files[0]?.name || 'Party chat' });
  const game = gameFor(ctx), notes = [];
  game.event('chat.sent').xp('chat_message', notes);
  const n0 = game.check(notes); if (n0.length) emit({ type: 'game', notes: n0, state: game.snapshot() });
  await chain(ctx, tid, party, members, founderSpeakers(ctx, msg, members), files, emit);
}

/** The founder answered a writ of a member in the room: that member carries on. */
export async function resumeParty(ctx, tid, role, emit) {
  const thread = getThread(ctx, tid);
  const party = getParty(ctx, thread.party);
  const members = party.members.filter((m) => ctx.member(m));
  if (!members.includes(role) || partyBusy(tid)) return;
  const waiting = (thread.queue ?? []).filter((m) => members.includes(m) && m !== role);   // @all: the others still wait for their turn
  await chain(ctx, tid, party, members, [role, ...waiting], [], emit);
}

async function chain(ctx, tid, party, members, first, files, emit) {
  chains.add(tid); stopped.delete(tid);
  const { max_turns: cap } = cfg(ctx);
  const spoke = new Set();
  const queue = [first].flat().filter(Boolean), asked = new Set(queue);   // asked: the founder's own picks, who also get the attached files
  let turns = 0, paused = false, limit = false, ok = true;
  // A conversation brings the party to the founder. Keep them there between replies instead of
  // replacing each member's movement queue with a trip to the hall and another trip home.
  emit({ type: 'party.gather', thread: tid, party: party.id, members });
  try {
    while (queue.length && !stopped.has(tid)) {
      const speaker = queue.shift();
      if (turns >= cap) { limit = true; break; }
      turns++;
      updateThread(ctx, tid, { speaker, queue: [...queue] });
      const r = await runTurn(ctx, tid, '', emit, asked.delete(speaker) ? files : [], { fromFounder: false, role: speaker, prompt: roomPrompt(ctx, party, tid, speaker), record: false })
        .catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { ok = false; break; }
      spoke.add(speaker);
      if (openWrits(ctx, tid).some((w) => w.role === speaker)) { paused = true; break; }   // the queue stays saved on the thread: answering the writ carries on with the rest
      const next = mentionOf(ctx, r.shown, members, speaker);
      if (next) gameFor(ctx).event('party.handoff');
      if (next && !queue.includes(next)) queue.push(next);
    }
  } finally {
    chains.delete(tid);
    const wasStopped = stopped.delete(tid);
    try { updateThread(ctx, tid, { speaker: null, state: 'waiting', queue: paused ? queue : [] }); } catch { /* the chat was deleted */ }
    if (limit) appendEvent(ctx, tid, { type: 'party.paused', turns, text: `The party paused after ${turns} turns. Say "continue" to let it carry on.` });
    if (ok && !paused && !limit && !wasStopped && spoke.size) {
      const game = gameFor(ctx), notes = [];
      game.event('party.job_done').xp('party_done', notes);
      if (spoke.size >= 3) game.event('party.big_job');
      const n = game.check(notes); emit({ type: 'game', notes: n, state: game.snapshot() });
    }
    emit({ type: 'party.idle', thread: tid });
  }
}
