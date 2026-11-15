// Claude Code CLI driver (headless, stream-json). Isolation: no user settings, no user MCP servers,
// no slash commands; built-in tools limited to what the crew member's writs allow.
import crypto from 'node:crypto';
import { runJsonLines } from './proc.mjs';
import { kindOf, targetOf, detailOf, textOf, imagesOf } from '../steps.mjs';
import { commandPattern, redact } from '../../gate.mjs';

const PLAN_TOOLS = new Set(['TodoWrite']);

export async function run({ system, prompt, images = [], sessionId, cwd, tools = [], allowed = [], addDirs = [], mcp = null, model, budgetUsd, signal, onEvent }) {
  const first = !sessionId;
  const sid = sessionId ?? crypto.randomUUID();
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--setting-sources', '', '--strict-mcp-config', ...(mcp ? ['--mcp-config', JSON.stringify({ mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args, env: mcp.env } } })] : []), '--disable-slash-commands',
    '--tools', tools.join(','), '--system-prompt', system];
  if (allowed.length) args.push('--allowedTools', ...allowed);
  if (tools.some((t) => ['Edit', 'Write', 'MultiEdit'].includes(t))) args.push('--permission-mode', 'acceptEdits');
  for (const d of addDirs) args.push('--add-dir', d);
  if (model) args.push('--model', model);
  if (budgetUsd) args.push('--max-budget-usd', String(budgetUsd));
  if (images.length) args.push('--input-format','stream-json');
  args.push(...(first ? ['--session-id', sid] : ['--resume', sid]));

  let text = '', cost = null, isError = false, errorText = '';
  const pending = new Map();
  await runJsonLines({
    cmd: 'claude', args, cwd, stdin: images.length ? JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:prompt},...images.map(f=>({type:'image',source:{type:'base64',media_type:f.type,data:f.data}}))]}})+'\n' : prompt, signal,
    onLine: (m) => {
      const ev = m.type === 'stream_event' ? m.event : null;
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        text += ev.delta.text;
        onEvent({ type: 'delta', text: ev.delta.text });
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
        onEvent({ type: 'thinking', text: ev.delta.thinking });
      } else if (ev?.type === 'message_start' && text && !text.endsWith('\n\n')) {
        text += '\n\n'; onEvent({ type: 'delta', text: '\n\n' });
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) if (b.type === 'tool_use' && !pending.has(b.id)) {
          pending.set(b.id, b);
          if (PLAN_TOOLS.has(b.name)) { onEvent({ type: 'plan', items: (b.input?.todos ?? []).map((t) => ({ text: t.content ?? t.activeForm ?? '', status: t.status ?? 'pending' })) }); continue; }
          onEvent({ type: 'tool', id: b.id, kind: kindOf(b.name), name: b.name, target: targetOf(b.name, b.input), detail: detailOf(b.name, b.input) });
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content ?? []) if (b.type === 'tool_result') {
          const use = pending.get(b.tool_use_id);
          if (use && PLAN_TOOLS.has(use.name)) continue;
          onEvent({ type: 'tool_result', id: b.tool_use_id, ok: !b.is_error, name: use?.name, target: use ? targetOf(use.name, use.input) : '', output: textOf(b.content), images:imagesOf(b.content) });
        }
      } else if (m.type === 'result') {
        cost = m.total_cost_usd ?? null; isError = !!m.is_error;
        // tools the CLI refused (outside the writs) become requests the founder can answer
        for (const d of m.permission_denials ?? []) { const a = deniedAccess(d.tool_name, d.tool_input ?? {}, cwd); if (a) onEvent({ type: 'access', ...a }); }
        if (isError) errorText = typeof m.result === 'string' ? m.result : (m.subtype ?? '');
        if (!text && m.result && !isError) text = m.result;
      }
    },
  });
  if (isError && !text) throw new Error(errorText ? `the agent stopped: ${String(errorText).slice(0, 200)}` : 'the agent reported an error');
  return { sessionId: sid, text, cost };
}

/** A refused Claude Code tool call -> the writ that would allow it. */
export function deniedAccess(tool, input, cwd) {
  const p = input.file_path ?? input.notebook_path ?? input.path;
  const dir = (f) => (f ? (/\.[a-z0-9]{1,6}$/i.test(f) ? f.replace(/\/[^/]*$/, '') : f) : cwd);
  if (['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'].includes(tool)) return { capability: 'fs.read', scope: dir(p), why: `read ${p ?? 'files'}` };
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return { capability: 'fs.write', scope: dir(p), why: `change ${p ?? 'files'}` };
  if (tool === 'Bash' && input.command) return { capability: 'cmd.run', scope: commandPattern(input.command), why: `${input.description ?? 'run a command'}: ${redact(input.command).slice(0, 140)}` };
  if (tool === 'WebFetch' && input.url) { try { return { capability: 'net.fetch', scope: new URL(input.url).hostname, why: `open ${input.url}` }; } catch { return null; } }
  if (tool === 'WebSearch') return { capability: 'net.fetch', scope: '*', why: `search the web for "${input.query ?? ''}"` };
  return null;
}
