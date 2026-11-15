// Quests: workflows the crew runs instead of one long chat. A quest is a goal and a list of steps; each step goes to
// one crew member, and what a step returns is handed to the next one. A step with `seal: true` waits for the founder
// to approve its result (the Seal) or send it back with a note. A step that asks for access waits for the writ.
//
// Every step runs in its own thread (kind "quest"), so its transcript, tool calls and writ cards look exactly like a chat.
// Files: <world>/quests/<id>.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createThread, readEvents, appendEvent } from './threads.mjs';
import { runTurn, isWorking, stopTurn, openWrits } from './agents/runner.mjs';
import { gameFor } from './game.mjs';

const dirOf = (ctx) => path.join(ctx.dir, 'quests');
const fileOf = (ctx, id) => path.join(dirOf(ctx), `${id}.json`);
const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const OUTPUT_MAX = 8000;           // characters of one step's result handed to the next steps

export function listQuests(ctx) {
  if (!fs.existsSync(dirOf(ctx))) return [];
  return fs.readdirSync(dirOf(ctx)).filter((f) => f.endsWith('.json')).flatMap((f) => { try { return [JSON.parse(fs.readFileSync(path.join(dirOf(ctx), f), 'utf8'))]; } catch { return []; } })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function getQuest(ctx, id) {
  if (!/^[\w-]{6,64}$/.test(String(id))) bad('unknown quest', 404);
  try { return JSON.parse(fs.readFileSync(fileOf(ctx, id), 'utf8')); } catch { bad('unknown quest', 404); }
}
function write(ctx, q) {
  fs.mkdirSync(dirOf(ctx), { recursive: true });
  q.updated_at = new Date().toISOString();
  fs.writeFileSync(fileOf(ctx, q.id) + '.tmp', JSON.stringify(q, null, 2));
  fs.renameSync(fileOf(ctx, q.id) + '.tmp', fileOf(ctx, q.id));
  return q;
}
export function deleteQuest(ctx, id) {
  const q = getQuest(ctx, id);
  if (['running', 'waiting'].includes(q.status)) bad('stop this quest before deleting it', 409);
  fs.rmSync(fileOf(ctx, id), { force: true });
  return { ok: true };
}

/** Find a crew member by id, name, first name or job title (how a companion names them). */
function memberRef(ctx, ref) {
  const k = String(ref ?? '').trim().toLowerCase();
  if (!k) return null;
  return ctx.crew.find((c) => c.id === k) ?? ctx.crew.find((c) => c.name.toLowerCase() === k) ?? ctx.crew.find((c) => c.name.split(/\s+/)[0].toLowerCase() === k) ?? ctx.crew.find((c) => c.job.toLowerCase() === k) ?? null;
}

/** Clean steps from input. `strict` throws on a step for nobody; otherwise such steps are dropped. */
function cleanSteps(ctx, steps, strict) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 20).flatMap((s) => {
    const m = memberRef(ctx, s?.agent);
    const task = str(s?.task, 2000);
    if (!m || !task) { if (strict) bad(m ? 'every step needs a task' : `nobody called "${str(s?.agent, 40)}" is on the crew`); return []; }
    return [{ id: str(s.id, 40) || crypto.randomUUID().slice(0, 8), agent: m.id, task, seal: !!s.seal }];
  });
}

/** Create or update a quest (only while it is not running). */
export function saveQuest(ctx, input, id = null, { starter = false } = {}) {
  const now = new Date().toISOString();
  const q = id ? getQuest(ctx, id) : { id: crypto.randomUUID(), status: 'draft', runs: 0, run: null, created_at: now };
  if (['running', 'waiting'].includes(q.status)) bad('stop this quest before editing it', 409);
  const title = str(input.title, 80);
  if (!title) bad('a quest needs a title');
  const steps = cleanSteps(ctx, input.steps, true);
  if (!steps.length) bad('a quest needs at least one step');
  Object.assign(q, { title, goal: str(input.goal, 2000), steps });
  if (!id && !starter) gameFor(ctx).event('quest.created');
  return write(ctx, q);
}

/** A quest the companion drafted in a chat (envelope `quest`): saved as a draft for the founder to check. */
export function draftQuest(ctx, raw, threadId) {
  const steps = cleanSteps(ctx, raw?.steps, false);
  const title = str(raw?.title, 80);
  if (!title || !steps.length) return null;
  const now = new Date().toISOString();
  const q = write(ctx, { id: crypto.randomUUID(), title, goal: str(raw.goal, 2000), steps, status: 'draft', runs: 0, run: null, created_at: now, from_thread: threadId ?? null });
  gameFor(ctx).event('quest.created');
  if (threadId) appendEvent(ctx, threadId, { type: 'quest.draft', quest: q.id, title: q.title, steps: q.steps.length });
  return q;
}

// ---------- running ----------
const busy = new Set();           // quests being advanced right now (one advance at a time per quest)
const view = (ctx, q) => ({ type: 'quest', quest: q });
const lastText = (ctx, tid) => [...readEvents(ctx, tid)].reverse().find((e) => e.type === 'agent.text')?.text ?? '';
const say = (ctx, emit, role, text, extra = []) => emit({ type: 'command', role, commands: [...extra, { do: 'say', text, label: `says "${text}"` }] });
const balloon = (ctx, key, fallback) => ctx.theme.strings?.balloon?.[key] ?? fallback;

/** What a crew member is told for its step: the quest, its own task, and what the earlier steps produced. */
export function briefOf(ctx, q, i) {
  const step = q.steps[i];
  const earlier = q.steps.slice(0, i).map((s, k) => {
    const m = ctx.member(s.agent);
    const out = q.run?.outputs?.[k] ?? '';
    return `### Step ${k + 1}: ${m?.name ?? s.agent} (${m?.job ?? ''})\nTask: ${s.task}\nResult:\n${out.length > OUTPUT_MAX ? out.slice(0, OUTPUT_MAX) + '\n… (cut)' : out || '(no text)'}`;
  });
  return [`You are on a quest: "${q.title}".`, q.goal ? `Goal of the whole quest: ${q.goal}` : '', `Your step (${i + 1} of ${q.steps.length}): ${step.task}`,
    earlier.length ? `What the earlier steps produced:\n\n${earlier.join('\n\n')}` : '',
    i < q.steps.length - 1 ? 'Do your step now and reply with its result. Your reply is handed to the next step as it is, so make it complete and self-contained.' : 'This is the last step. Do it now and reply with the final result of the quest.',
    step.seal ? 'The founder will review your result before the quest goes on.' : ''].filter(Boolean).join('\n\n');
}

/** Start (or start again) a quest from its first step. */
export function startQuest(ctx, id, emit) {
  const q = getQuest(ctx, id);
  if (['running', 'waiting'].includes(q.status)) bad('this quest is already running', 409);
  for (const s of q.steps) if (!ctx.member(s.agent)) bad('a step names someone who left the crew; edit the quest first');
  q.status = 'running'; q.runs = (q.runs ?? 0) + 1;
  q.run = { n: q.runs, started_at: new Date().toISOString(), step: 0, threads: [], outputs: [], waiting: null, error: null };
  write(ctx, q); emit(view(ctx, q));
  void runStep(ctx, q.id, emit);
  return q;
}

/** Run the current step in a new thread of its member. */
async function runStep(ctx, id, emit) {
  const q = getQuest(ctx, id), i = q.run.step, step = q.steps[i];
  const t = createThread(ctx, { role: step.agent, kind: 'quest', title: `${q.title} · step ${i + 1}`, quest: q.id, step: i });
  q.run.threads[i] = t.id; q.status = 'running'; q.run.waiting = null; q.run.error = null;
  write(ctx, q); emit(view(ctx, q));
  emit({ type: 'command', role: step.agent, commands: [{ do: 'walk_to', to: { kind: 'plaza' }, label: 'walks to the quest board' }, { do: 'say', text: balloon(ctx, 'on_quest', 'On it!'), label: 'says' }] });
  await turn(ctx, q.id, t.id, briefOf(ctx, q, i), emit, false);
}

/** One turn inside a quest step's thread, then decide what the quest does next. */
async function turn(ctx, id, tid, text, emit, fromFounder) {
  try { await runTurn(ctx, tid, text, emit, [], { fromFounder }); }
  catch (e) { appendEvent(ctx, tid, { type: 'turn.error', message: e.message }); }
  await advance(ctx, id, emit);
}

/**
 * Look at the current step's thread and move the quest on: wait for a writ, wait for the Seal, fail on an error,
 * or hand the result to the next step. Safe to call any time (it does nothing while the member is still working).
 */
export async function advance(ctx, id, emit) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const q = getQuest(ctx, id);
    if (q.status !== 'running' && q.status !== 'waiting') return;
    const i = q.run.step, step = q.steps[i], tid = q.run.threads[i];
    if (!tid || isWorking(tid)) return;
    const events = readEvents(ctx, tid);
    const lastReply = events.findLastIndex((e) => e.type === 'agent.text' && !e.partial), lastError = events.findLastIndex((e) => e.type === 'turn.error');
    if (openWrits(ctx, tid).length) {
      q.status = 'waiting'; q.run.waiting = 'writ'; write(ctx, q); emit(view(ctx, q));
      say(ctx, emit, step.agent, balloon(ctx, 'needs_writ', 'Needs access'));
      return;
    }
    if (lastError > lastReply) {
      q.status = 'failed'; q.run.error = events[lastError].message; q.run.waiting = null; write(ctx, q); emit(view(ctx, q));
      return;
    }
    q.run.outputs[i] = lastText(ctx, tid);
    if (step.seal && q.run.sealed !== i) {
      q.status = 'waiting'; q.run.waiting = 'seal'; write(ctx, q); emit(view(ctx, q));
      say(ctx, emit, step.agent, balloon(ctx, 'needs_seal', 'Needs your seal'));
      return;
    }
    // the step is done
    const game = gameFor(ctx), notes = [];
    game.event('step.done').xp('step_done', notes);
    emit({ type: 'command', role: step.agent, commands: [{ do: 'go_home', label: 'goes home' }] });
    if (i + 1 < q.steps.length) {
      q.run.step = i + 1; q.run.sealed = null; write(ctx, q);
      const n = game.check(notes); if (n.length) emit({ type: 'game', notes: n, state: game.snapshot() });
      busy.delete(id);
      await runStep(ctx, id, emit);
      return;
    }
    q.status = 'done'; q.run.waiting = null; q.run.finished_at = new Date().toISOString(); write(ctx, q);
    game.event('quest.done').xp('quest_done', notes, (ctx.interactions.xp?.quest_per_step ?? 0) * q.steps.length);
    if (q.steps.length >= 5) game.event('quest.done_5_steps');
    const n = game.check(notes); emit({ type: 'game', notes: n, state: game.snapshot() });
    emit(view(ctx, q));
    say(ctx, emit, step.agent, balloon(ctx, 'quest_done', 'Quest done!'), [{ do: 'emote', kind: 'cheer', label: 'cheers' }]);
  } finally { busy.delete(id); }
}

/** The founder's Seal on a waiting step: approve it (the quest goes on) or send it back with a note (the member redoes it). */
export async function seal(ctx, id, { approve, note }, emit) {
  const q = getQuest(ctx, id);
  if (q.status !== 'waiting' || q.run.waiting !== 'seal') bad('this quest is not waiting for your seal', 409);
  const i = q.run.step, tid = q.run.threads[i], game = gameFor(ctx), notes = [];
  if (approve) {
    q.run.sealed = i; q.status = 'running'; write(ctx, q);
    appendEvent(ctx, tid, { type: 'sealed' });
    game.event('seal.given').xp('seal_given', notes);
    const n = game.check(notes); if (n.length) emit({ type: 'game', notes: n, state: game.snapshot() });
    await advance(ctx, id, emit);
    return getQuest(ctx, id);
  }
  const text = str(note, 4000);
  if (!text) bad('write what should change');
  q.status = 'running'; q.run.waiting = null; write(ctx, q); emit(view(ctx, q));
  game.event('seal.returned'); game.check(notes);
  void turn(ctx, id, tid, `The founder sent your result back. Change this and reply with the full new result:\n\n${text}`, emit, true);
  return q;
}

/** Try the current step again after an error (same thread, so the member keeps its context). */
export function retry(ctx, id, emit) {
  const q = getQuest(ctx, id);
  if (q.status !== 'failed' && q.status !== 'stopped') bad('only a failed or stopped quest can be retried', 409);
  const tid = q.run?.threads?.[q.run.step];
  q.status = 'running'; q.run.error = null; write(ctx, q); emit(view(ctx, q));
  if (!tid) void runStep(ctx, id, emit);
  else void turn(ctx, id, tid, 'Something went wrong last time. Please try your step again and reply with its result.', emit, false);
  return q;
}

/** Stop a running quest (the member's current turn is stopped too). */
export function stopQuest(ctx, id, emit) {
  const q = getQuest(ctx, id);
  if (!['running', 'waiting'].includes(q.status)) return q;
  const tid = q.run?.threads?.[q.run.step];
  q.status = 'stopped'; q.run.waiting = null; write(ctx, q);
  if (tid) stopTurn(tid);
  emit(view(ctx, q));
  emit({ type: 'command', role: q.steps[q.run.step]?.agent, commands: [{ do: 'go_home', label: 'goes home' }] });
  return q;
}

/** Quests left running when the server stopped cannot finish their turn: mark them stopped so the founder can retry. */
export function recoverQuests(ctx) {
  for (const q of listQuests(ctx)) if (q.status === 'running') { q.status = 'stopped'; q.run.error = 'The game was closed while this step was running.'; write(ctx, q); }
}
