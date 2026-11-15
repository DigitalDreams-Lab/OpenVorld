// OpenCode CLI driver (`opencode run --format json`). Prompt goes on stdin; writs are enforced via OPENCODE_PERMISSION.
import path from 'node:path';
import { runJsonLines } from './proc.mjs';
import { kindOf, targetOf, detailOf } from '../steps.mjs';
import { commandPattern, redact } from '../../gate.mjs';

const PERM_RE = /specified a rule|rejected permission|PermissionDenied|PermissionRejected/i;

/** Build the CLI arguments for one headless OpenCode turn (exported for unit tests). */
export function argsFor({ sessionId, model, images = [] }) {
  return [
    'run',
    '--format', 'json',
    '--thinking',
    ...(sessionId ? ['-s', sessionId] : []),
    ...(model ? ['-m', model] : []),
    ...images.flatMap((f) => ['-f', f.path]),
  ];
}

/** Map OpenVorld writs onto an OPENCODE_PERMISSION ruleset object. */
export function permissionsFor({ addDirs = [], writable = false, cmdAllow = [], web = false }) {
  return {
    read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.env.example': 'allow' },
    edit: writable ? 'allow' : 'deny',
    bash: cmdAllow.length
      ? { '*': 'deny', ...Object.fromEntries(cmdAllow.flatMap((c) => [c, c.replace(/ \*$/, '')].map((k) => [k, 'allow']))) }
      : 'deny',
    webfetch: web ? 'allow' : 'deny',
    websearch: web ? 'allow' : 'deny',
    external_directory: { '*': 'deny', ...Object.fromEntries(addDirs.map((d) => [path.join(d, '*'), 'allow'])) },
  };
}

/** Translate a refused OpenCode tool call into the writ that would allow it. */
export function deniedAccess(tool, input = {}, cwd) {
  const p = input.filePath ?? input.filepath ?? input.file_path ?? input.path;
  const dir = (f) => {
    if (!f) return cwd;
    const abs = path.resolve(cwd, String(f));
    return /\.[a-z0-9]{1,6}$/i.test(abs) ? path.dirname(abs) : abs;
  };
  if (['read', 'glob', 'grep', 'list'].includes(tool)) return { capability: 'fs.read', scope: dir(p), why: `read ${p ?? 'files'}` };
  if (['edit', 'write', 'apply_patch'].includes(tool)) return { capability: 'fs.write', scope: dir(p), why: `change ${p ?? 'files'}` };
  if (tool === 'bash' && input.command) return { capability: 'cmd.run', scope: commandPattern(input.command), why: `${input.description ?? 'run a command'}: ${redact(input.command).slice(0, 140)}` };
  if (tool === 'webfetch' && input.url) { try { return { capability: 'net.fetch', scope: new URL(input.url).hostname, why: `open ${input.url}` }; } catch { return null; } }
  if (tool === 'websearch') return { capability: 'net.fetch', scope: '*', why: `search the web for "${input.query ?? ''}"` };
  return null;
}

export async function run({ system, prompt, images = [], sessionId, cwd, addDirs = [], writable = false, cmdAllow = [], web = false, model, signal, onEvent }) {
  let sid = sessionId, text = '', cost = 0, hasCost = false, failed = '', seq = 0;

  await runJsonLines({
    cmd: 'opencode',
    args: argsFor({ sessionId, model, images }),
    cwd,
    stdin: sessionId ? prompt : `${system}\n\n---\n\n${prompt}`,
    env: { OPENCODE_PERMISSION: JSON.stringify(permissionsFor({ addDirs, writable, cmdAllow, web })) },
    signal,
    onLine: (m) => {
      if (m.sessionID) sid = m.sessionID;

      if (m.type === 'text' && m.part?.text) {
        const chunk = (text ? '\n\n' : '') + m.part.text;
        text += chunk;
        onEvent({ type: 'delta', text: chunk });
      } else if (m.type === 'reasoning' && m.part?.text) {
        onEvent({ type: 'thinking', text: m.part.text + '\n' });
      } else if (m.type === 'tool_use') {
        const part = m.part ?? {}, state = part.state ?? {}, name = part.tool ?? 'tool', input = state.input ?? {};
        const id = part.callID ?? part.id ?? `oc-${++seq}`;
        if (name === 'todowrite') {
          onEvent({ type: 'plan', items: (input.todos ?? []).map((t) => ({ text: t.content ?? '', status: t.status ?? 'pending' })) });
          return;
        }
        const target = targetOf(name, input);
        onEvent({ type: 'tool', id, kind: kindOf(name), name, target, detail: detailOf(name, input) });
        onEvent({
          type: 'tool_result',
          id,
          ok: state.status === 'completed',
          name,
          target,
          output: String(state.output ?? state.error ?? '').slice(0, 4000),
        });
        if (state.status === 'error' && PERM_RE.test(state.error ?? '')) {
          const a = deniedAccess(name, input, cwd);
          if (a) onEvent({ type: 'access', ...a });
        }
      } else if (m.type === 'step_finish') {
        if (typeof m.part?.cost === 'number') { cost += m.part.cost; hasCost = true; }
      } else if (m.type === 'error') {
        failed = m.error?.data?.message ?? m.error?.message ?? m.error?.name ?? (typeof m.error === 'string' ? m.error : 'the turn failed');
      }
    },
  });

  if (failed && !text) throw new Error(failed);
  return { sessionId: sid, text, cost: hasCost ? cost : null };
}
