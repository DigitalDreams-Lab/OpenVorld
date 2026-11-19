// Runs one turn of a crew member in a thread: picks the brain, builds the prompt, turns writs into tool access,
// drives the provider, streams every agent event to the client, and stores the reply.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as claude from './drivers/claude.mjs';
import * as codex from './drivers/codex.mjs';
import * as antigravity from './drivers/antigravity.mjs';
import * as opencode from './drivers/opencode.mjs';
import * as openai from './drivers/openai.mjs';
import * as scripted from './drivers/scripted.mjs';
import { splitEnvelope } from './envelope.mjs';
import { commandHelp, partyScope, prepareCommands } from './commands.mjs';
import { keyFor } from '../keys.mjs';
import { Transcript } from './steps.mjs';
import { engineTools } from './tools.mjs';
import { appendEvent, getThread, updateThread, history, readEvents } from '../threads.mjs';
import { grantsOf, folderGrants, consumeOnce, holds, checkScope } from '../gate.mjs';
import { benchOf, benchesOf, projectOf } from '../benches.mjs';
import { heldSecrets, redactEvent, redactSecrets, vaultHelp } from '../house.mjs';
import { browserFor } from './browse.mjs';
import { gameFor } from '../game.mjs';
import { profileContext } from '../profile.mjs';
import { applyMemory, memoryContext } from '../memory.mjs';
import { attachmentPrompt, publicFiles, threadAttachments, getAttachment, saveAttachment, imageType } from '../attachments.mjs';

const active = new Map(); // threadId -> AbortController
export const isWorking = (id) => active.has(id);
export const stopTurn = (threadId) => active.get(threadId)?.abort();
export const activeTurnCount = () => active.size;
export async function stopAllTurns() {
  for (const controller of active.values()) controller.abort();
  const deadline = Date.now() + 3000;
  while (active.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
}
const TEST_RE = /\b(test|tests|vitest|jest|pytest|mocha|go test|cargo test|xcodebuild test|gradlew test)\b/;

/** The brain a member thinks with: { provider, driver, model, cfg, label }, or the scripted stand-in. */
export function brainOf(ctx, id) {
  const m = ctx.member(id);
  const b = m?.brain;
  if (!b?.provider || b.provider === 'none') return { provider: 'none', driver: 'scripted', label: 'no brain' };
  const p = ctx.providers[b.provider];
  const inst = (ctx.doc.providers ?? []).find((x) => x.id === b.provider && (!b.name || x.name === b.name)) ?? {};
  const tier = m.model_tier ?? 'balanced';
  return { provider: b.provider, driver: Object.keys(p?.drivers ?? {})[0] ?? 'cli', model: b.model || inst.models?.[tier] || p?.models?.tiers?.[tier], cfg: (({ key, missing }) => ({ ...inst, api_key: key ?? undefined, key_missing: missing ?? undefined }))(keyFor(ctx, inst)), label: p?.label ?? b.provider };
}

function systemPrompt(ctx, id, benchId, scope = {}, threadId = null) {
  const m = ctx.member(id);
  const crew = ctx.crew.filter((c) => c.id !== id).map((c) => `${c.name} (${c.job}${c.function ? `: ${c.function}` : ''})`).join('; ') || 'nobody yet';
  const vars = { name: m.name, job: m.job, function: m.function || 'whatever the founder asks', voice: m.voice, vorld: ctx.doc.name, about: ctx.doc.about || 'not described yet', crew,
    project: projectOf(ctx).path, workbench: benchOf(ctx, id, benchId).path };
  const base = String(m.prompt).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  // every workbench the founder chose is open to the member in every chat; the chat's own bench is where it starts
  const mine = benchesOf(ctx, id).filter((b) => b.chosen), active = benchOf(ctx, id, benchId);
  const benchNote = mine.length ? `Your workbenches (you can read and change files on all of them, in any chat): ${mine.map((b) => `${b.name} (${b.path})`).join('; ')}. This chat's active workbench is ${active.name} (${active.path}): start there and put new files there unless the founder says otherwise.` : '';
  const writs = grantsOf(ctx, id).map((g) => `${g.capability} ${g.scope}`).join('; ') || 'none';
  const env = ctx.interactions.envelope ?? {};
  return [base, profileContext(ctx.home), memoryContext(ctx, id, threadId), benchNote, `Your writs (access): ${writs}. You have no other access; if you need more, ask for it in the "access" list so the founder can grant it.`,
    env.instructions ?? '', vaultHelp(ctx, id), commandHelp(ctx, id, scope)].filter(Boolean).join('\n\n');
}

/**
 * One turn: the founder's text goes to the member of the thread, the reply streams back. Resolves with { ok, shown, meta }
 * once the reply is stored.
 * A party's room has several speakers: the party passes `role` (who speaks now) and `prompt` (what that member is told:
 * the room so far), and records the messages itself (`record: false`). Such a turn keeps no CLI session of its own.
 */
export async function runTurn(ctx, threadId, text, emit, attachments = [], { fromFounder = true, role: speakerRole = null, prompt = null, record = true } = {}) {
  if (active.has(threadId)) throw Object.assign(new Error('this crew member is still working on the last message'), { status: 409 });
  const thread = getThread(ctx, threadId);
  const ac = new AbortController();
  active.set(threadId, ac);
  const game = gameFor(ctx), notes = [];
  try {
    if (record) appendEvent(ctx, threadId, { type: fromFounder ? 'founder.message' : 'brief', text, ...(attachments.length ? { attachments: publicFiles(attachments) } : {}) });
    if (record && fromFounder) {
      game.event('chat.sent').xp('chat_message', notes);
      const hour = new Date().getHours();
      if (hour >= 2 && hour < 4) game.event('chat.night');
    }
    updateThread(ctx, threadId, { state: 'working' });
    const role = speakerRole ?? thread.role;
    const r = await speak(ctx, thread, prompt ?? text, emit, ac.signal, attachments, role, !!speakerRole);
    const patch = { state: 'waiting' };
    if (!speakerRole) { patch.session_id = r.sessionId ?? thread.session_id; if (r.sessionProvider) patch.session_provider = r.sessionProvider; }
    if (!thread.title && !speakerRole) patch.title = r.meta?.title || text.slice(0, 48) || attachments[0]?.name || 'Chat';
    const t = updateThread(ctx, threadId, patch);
    if (r.ok) emit({ type: 'thread.event', thread: threadId, role, kind: thread.kind, party: thread.party, ev: { type: 'turn.done', text: r.shown, meta: r.meta, thread: t } });
    return r;
  } finally {
    active.delete(threadId);
    try { if (getThread(ctx, threadId).state === 'working') updateThread(ctx, threadId, { state: 'waiting' }); } catch { /* deleted */ }
    const n = game.check(notes); if (n.length) emit({ type: 'game', notes: n, state: game.snapshot() });
  }
}

/**
 * The session a chat may continue. A CLI brain keeps its own conversation under a session id that only that brain can resume,
 * so the id is used only while the member still has the brain it came from (a chat that switched from Claude Code to Codex must
 * not hand Codex a Claude Code id). Chats saved before the brain was recorded are tried, and fall back if the brain says it is gone.
 */
export function sessionFor(thread, brain, inRoom) {
  if (inRoom || !thread.session_id) return null;
  return !thread.session_provider || thread.session_provider === brain.provider ? thread.session_id : null;
}
/** What a brain says when the session it was asked to resume no longer exists. */
export const SESSION_LOST = /no rollout found|no conversation found|session[^.]{0,40}not found|could not (find|resume)[^.]{0,30}(session|conversation|thread)|thread\/resume failed/i;

/** The conversation so far as plain text, newest turns kept, for a brain that starts a chat fresh (it was switched, or its session is gone). */
export function catchUp(turns, maxChars = 12000) {
  const lines = []; let size = 0;
  for (const t of [...turns].reverse()) {
    const line = `${t.role === 'user' ? 'Founder' : 'You'}: ${String(t.content ?? '').trim()}`;
    if (size + line.length > maxChars && lines.length) break;
    lines.unshift(line.slice(0, maxChars)); size += line.length;
  }
  return lines.length ? `This chat is already under way; you are picking it up with a fresh mind. The conversation so far:\n\n${lines.join('\n\n')}\n\n---\nThe founder's new message:\n` : '';
}

async function speak(ctx, thread, text, emit, signal, attachments, role, inRoom) {
  const threadId = thread.id;
  const brain = brainOf(ctx, role);
  const reactions = ctx.interactions.reactions ?? {};
  const send = (ev) => emit({ type: 'thread.event', thread: threadId, role, kind: thread.kind, party: thread.party, ev });
  send({ type: 'turn.start', brain: brain.label, speaker: role, reaction: reactions['turn.start'] });

  // writs -> tool access
  const ws = benchOf(ctx, role, thread.bench), cwd = ws.path;
  fs.mkdirSync(cwd, { recursive: true });
  const writeDirs = [...new Set([...folderGrants(ctx, role, 'fs.write'), ...benchesOf(ctx, role).filter((b) => b.chosen).map((b) => b.path), ...(ws.chosen ? [cwd] : [])])];
  const allFiles = threadAttachments(ctx, threadId);
  const uploadDirs = [...new Set(allFiles.filter((f) => f.kind !== 'reference').map((f) => path.dirname(f.path)))];
  const referenceFiles = [...allFiles.filter((f) => f.kind === 'reference').map((f) => f.path)];
  // the project folder is shared: every member reads it; changing it is an fs.write writ like any other folder
  const project = projectOf(ctx);
  // a read writ names a folder, or one file the founder allowed for the session (a file is read like a reference, never added as a folder)
  const readGrants = folderGrants(ctx, role, 'fs.read'), isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  referenceFiles.push(...readGrants.filter((p) => !isDir(p) && fs.existsSync(p)));
  const readDirs = [...new Set([...(project.exists ? [project.path] : []), ...readGrants.filter(isDir), ...uploadDirs])];
  const cmdGrants = grantsOf(ctx, role).filter((g) => g.capability === 'cmd.run').map((g) => g.scope);
  const netGrants = grantsOf(ctx, role).filter((g) => g.capability === 'net.fetch').map((g) => g.scope);
  const tools = [];
  if (readDirs.length || writeDirs.length || referenceFiles.length) tools.push('Read', 'Glob', 'Grep');
  if (writeDirs.length) tools.push('Edit', 'Write', 'MultiEdit');
  if (cmdGrants.length) tools.push('Bash');
  const allowed = [...tools.filter((t) => t !== 'Bash'), ...cmdGrants.map((c) => `Bash(${c})`)];
  const addDirs = [...new Set([...readDirs, ...writeDirs])].filter((d) => d !== cwd);
  const agentCfg = ctx.interactions.agent ?? {};
  for (const t of agentCfg.claude_code?.always_tools ?? []) if (!tools.includes(t)) { tools.push(t); allowed.push(t); }
  if (netGrants.length) { tools.push('WebFetch'); allowed.push(...(netGrants.includes('*') ? ['WebFetch', 'WebSearch'] : netGrants.map((d) => `WebFetch(domain:${d})`))); if (netGrants.includes('*')) tools.push('WebSearch'); }

  // every driver's events fold into one ordered transcript (text, thinking, tools with results, plan)
  const tr = new Transcript(agentCfg.transcript);
  const asks = [];
  const onEvent = (raw) => {
    const e = redactEvent(ctx, role, raw);          // vault values never reach the chat or the transcript
    if (e.type === 'access') { asks.push(e); return; }
    if (e.type === 'delta') { tr.text(e.text); send({ type: 'delta', text: e.text }); return; }
    if (e.type === 'thinking') { tr.thinking(e.text); send({ type: 'thinking', text: e.text }); return; }
    if (e.type === 'plan') { tr.plan(e.items); send({ type: 'plan', items: e.items }); return; }
    if (e.type === 'tool') {
      const step = tr.tool(e);
      send({ type: 'tool', id: step.id, kind: e.kind, name: e.name, target: e.target, detail: step.detail, reaction: reactions[e.kind] });
      return;
    }
    if (e.type === 'tool_result') {
      const step = tr.result(e);
      const files = (e.images ?? []).slice(0, 8).flatMap((image, i) => {
        try {
          const existing = image.path && allFiles.find((f) => fs.realpathSync(f.path) === image.path);
          if (existing) return publicFiles([existing]);
          if (typeof image.data !== 'string' || image.data.length > 28 * 1024 * 1024) return [];
          const data = Buffer.from(image.data, 'base64'), type = imageType(data); if (!type) return [];
          return [saveAttachment(ctx, threadId, `tool-image-${i + 1}.${type.split('/')[1]}`, data)];
        } catch { return []; }
      });
      if (step && files.length) step.attachments = files;
      let test = null;
      if (['Bash', 'shell', 'run_command', 'bash'].includes(e.name) && TEST_RE.test(e.target ?? step?.target ?? '')) { test = e.ok ? 'pass' : 'fail'; if (step) step.test = test; }
      send({ type: 'tool_result', id: step?.id ?? e.id, ok: e.ok, output: step?.output ?? '', attachments: files, ms: step?.ms ?? null, test,
        reaction: test ? reactions[`test.${test}`] : !e.ok ? reactions['tool.error'] : null });
    }
  };
  const lang = ctx.interactions.envelope?.block_lang ?? 'ov';
  const strip = (t) => splitEnvelope(t, lang).text;
  const steps = () => { const s = tr.final(strip); return s.some((x) => x.t !== 'text') ? s : undefined; };

  try {
    const web = browserFor(ctx, role, threadId, { emit, onRequest: (a) => asks.push(a) });
    const scope = { party: partyScope(ctx, thread) };
    const system = [systemPrompt(ctx, role, thread.bench, scope, threadId), web.call ? ctx.interactions.agent?.browser?.instructions : ''].filter(Boolean).join('\n\n');
    // with no session to resume, a CLI brain is told the conversation so far; the API driver is handed the history itself
    const drive = async (sessionId) => {
    const catchup = !inRoom && !sessionId && brain.driver !== 'openai' ? catchUp(history(ctx, threadId).slice(0, -1)) : '';
    // Resumed CLI sessions retain their first system prompt, so refresh personal context and the notebook in the new turn too.
    const personal = sessionId && brain.driver !== 'openai' ? [profileContext(ctx.home), memoryContext(ctx, role, threadId, { recent: false })].filter(Boolean).join('\n\n') : '';
    const common = { system, prompt: [personal, catchup + attachmentPrompt(text, attachments)].filter(Boolean).join('\n\n'), sessionId, cwd, model: brain.model, signal, onEvent };
    let result;
    if (brain.driver === 'scripted') result = await scripted.run({ ctx, role, onEvent });
    else if (brain.provider === 'claude-code') result = await claude.run({ ...common, env: heldSecrets(ctx, role), tools, allowed: [...allowed, ...(web.allowed ?? [])], addDirs, mcp: web.mcp });
    else if (brain.provider === 'codex') result = await codex.run({ ...common, env: heldSecrets(ctx, role), mcp: web.mcp, ...codex.sandboxOf(writeDirs, cwd), web: netGrants.includes('*'), onAccess: (a) => asks.push(a) });
    else if (brain.provider === 'antigravity') result = await antigravity.run({ ...common, addDirs, writable: writeDirs.length > 0 });
    else if (brain.provider === 'opencode') result = await opencode.run({ ...common, addDirs, writable: writeDirs.length > 0, cmdAllow: cmdGrants, web: netGrants.length > 0 });
    else if (brain.driver === 'openai') {
      const et = agentCfg.engine_tools ?? {};
      const engine = et.enabled === false ? null : engineTools({ ctx, role, cwd, readRoots: [...readDirs, ...referenceFiles], writeRoots: writeDirs, commands: cmdGrants, domains: netGrants, limits: et, browser: web.call, scope, onCommand: (commands) => emit({ type: 'command', role, thread: threadId, commands }), onRequest: (a) => asks.push(a) });
      const prior = (inRoom ? [] : history(ctx, threadId).slice(0, -1)).map((turn) => {
        if (!turn.attachments?.length) return turn;
        const files = turn.attachments.flatMap((f) => { try { return [getAttachment(ctx, threadId, f.id)]; } catch { return []; } });
        return { role: turn.role, content: attachmentPrompt(turn.content, files) };
      });
      result = await openai.run({ ...common, history: prior, cfg: brain.cfg, tools: engine, maxRounds: et.max_rounds ?? 16 });
    } else throw new Error(`${brain.label} is not supported in this version; pick another brain in settings`);
    return result;
    };
    const sessionId = sessionFor(thread, brain, inRoom);
    let result;
    try { result = await drive(sessionId); }
    catch (e) { if (!sessionId || !SESSION_LOST.test(e.message ?? '')) throw e; result = await drive(null); }      // its session is gone: start fresh, with the conversation so far

    const { text: shown, meta } = splitEnvelope(redactSecrets(ctx, role, result.text ?? ''), lang);
    const { access, commands: askedCommands, remember, forget, summary, ...metaShown } = meta;
    const noted = applyMemory(ctx, role, threadId, { remember, forget, summary });
    if (noted.length) metaShown.noted = noted;
    const done = prepareCommands(ctx, role, askedCommands, scope);
    if (done.commands.length) metaShown.did = done.commands.map((c) => c.label);
    appendEvent(ctx, threadId, { type: 'agent.text', role, text: shown, meta: metaShown, steps: steps() });
    requestAccess(ctx, thread, role, [...asks, ...(access ?? [])], send);
    if (done.commands.length) emit({ type: 'command', role, thread: threadId, commands: done.commands });
    return { ok: true, shown, meta: metaShown, sessionId: result.sessionId ?? thread.session_id, sessionProvider: result.sessionId ? brain.provider : thread.session_provider };
  } catch (err) {
    // keep what the member did before it stopped, so the chat still shows it
    const partial = tr.final(strip);
    if (partial.length) appendEvent(ctx, threadId, { type: 'agent.text', role, text: partial.filter((x) => x.t === 'text').map((x) => x.text).join('\n\n'), meta: {}, steps: partial, partial: true });
    requestAccess(ctx, thread, role, asks, send);
    appendEvent(ctx, threadId, { type: 'turn.error', role, message: err.message });
    send({ type: 'turn.error', message: err.message, speaker: role, reaction: reactions['turn.error'] });
    return { ok: false, error: err.message };
  } finally {
    consumeOnce(ctx, role);                          // "allow once" ends with this turn
  }
}

/** Writ requests still waiting for the founder in a thread. */
export function openWrits(ctx, threadId) {
  const events = readEvents(ctx, threadId), answered = new Set(events.filter((e) => e.type === 'writ.answered').map((e) => e.id));
  return events.filter((e) => e.type === 'writ.request' && !answered.has(e.id));
}

/**
 * Turn what a member needs into writ requests the founder sees in the chat (deduplicated, never for access they
 * already hold, never for scopes that can never be granted). Answered through POST .../writs/:id.
 */
export function requestAccess(ctx, thread, role, asks, send) {
  const seen = new Set();
  const caps = ctx.packs.byKind.permissions?.permissions?.capabilities ?? {};
  const open = openWrits(ctx, thread.id);
  for (const a of asks) {
    if (!caps[a.capability]) continue;
    let scope;
    try { scope = checkScope(ctx, a.capability, a.scope); } catch { continue; }
    const key = `${a.capability}|${scope}`;
    if (seen.has(key) || (!a.signin && holds(ctx, role, a.capability, scope))) continue;
    seen.add(key);
    if (open.some((e) => e.role === role && e.capability === a.capability && e.scope === scope)) continue;
    const req = { type: 'writ.request', id: crypto.randomUUID(), role, capability: a.capability, scope, why: a.why ?? '', risk: caps[a.capability].risk ?? 'medium', ...(a.signin ? { signin: true } : {}) };
    appendEvent(ctx, thread.id, req);
    send({ ...req, reaction: ctx.interactions.reactions?.['writ.request'] });
  }
}
