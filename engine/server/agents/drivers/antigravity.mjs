// Antigravity CLI driver (`agy -p`, headless, stream-json). Credentials come from the CLI's own sign-in.
// `--sandbox` keeps shell execution sandboxed; `--mode accept-edits` is added only when write access is granted.
import { runJsonLines } from './proc.mjs';
import { kindOf } from '../steps.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

/** Build the CLI arguments for one headless Antigravity turn (exported for unit tests). */
export function argsFor({ system, prompt, sessionId, model, addDirs = [], writable = false }) {
  const full = sessionId ? prompt : `${system}\n\n---\n\n${prompt}`;
  return [
    '-p', full,
    '--output-format', 'stream-json',
    '--sandbox',
    ...(writable ? ['--mode', 'accept-edits'] : []),
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--conversation', sessionId] : []),
  ];
}

export async function run({ system, prompt, sessionId, cwd, addDirs = [], writable = false, model, signal, onEvent }) {
  let sid = sessionId, text = '', final = '', failed = '';
  const open = new Set();

  await runJsonLines({
    cmd: 'agy',
    args: argsFor({ system, prompt, sessionId, model, addDirs, writable }),
    cwd,
    signal,
    onLine: (line) => {
      const m = line[line.event] ?? line;
      if (m.conversation_id) sid = m.conversation_id;

      if (line.event === 'step_update') {
        if (m.step_type === 'agent_response' && m.text_delta) {
          text += m.text_delta;
          onEvent({ type: 'delta', text: m.text_delta });
        } else if (m.step_type === 'tool' || m.step_type === 'subagent') {
          const id = `agy-${m.step_index}`;
          const info = m.tool_call ?? m.subagent ?? {};
          const name = info.tool_name ?? info.subagent_name ?? m.step_type;
          const target = str(info.arguments ?? info.task_description ?? '').slice(0, 240);
          if (!open.has(id)) {
            open.add(id);
            onEvent({ type: 'tool', id, kind: kindOf(name), name, target });
          }
          if (m.state === 'DONE') {
            onEvent({
              type: 'tool_result',
              id,
              ok: info.error == null,
              name,
              target,
              output: str(info.error ?? info.result ?? '').slice(0, 4000),
            });
          }
        }
      } else if (line.event === 'result') {
        if (['ERROR', 'INVALID', 'CANCELED'].includes(m.status)) {
          failed = str(m.error) || `Antigravity ended with ${m.status}`;
        } else if (m.response) {
          final = m.response;
        }
      }
    },
  });

  if (failed && !text && !final) throw new Error(failed);
  return { sessionId: sid, text: text || final };
}
