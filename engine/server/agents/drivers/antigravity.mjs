// Antigravity CLI driver (`agy -p`, headless, stream-json). Credentials come from the CLI's own sign-in.
// `--sandbox` keeps shell execution sandboxed; `--mode accept-edits` is added only when write access is granted.
// The engine's own tools (crew browser, secret_ask, recall) arrive via a private temp folder's `.agents/mcp_config.json`
// (`--add-dir`) plus a session-only `--settings` allow-rule for that MCP server alone, removed when the turn ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runJsonLines } from './proc.mjs';
import { kindOf, targetOf } from '../steps.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

/** Build the CLI arguments for one headless Antigravity turn (exported for unit tests). */
export function argsFor({ system, prompt, sessionId, model, addDirs = [], writable = false, settingsFile = null }) {
  const full = sessionId ? prompt : `${system}\n\n---\n\n${prompt}`;
  return [
    '-p', full,
    '--output-format', 'stream-json',
    '--sandbox',
    ...(writable ? ['--mode', 'accept-edits'] : []),
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(settingsFile ? ['--settings', settingsFile] : []),
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--conversation', sessionId] : []),
  ];
}

export async function run({ bin = 'agy', system, prompt, sessionId, cwd, addDirs = [], writable = false, mcp = null, env = null, model, signal, onEvent }) {
  let sid = sessionId, text = '', final = '', failed = '';
  const open = new Set();
  let mcpDir = null, settingsFile = null;
  if (mcp) {
    mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-agy-'));
    const agentsDir = path.join(mcpDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(agentsDir, 'mcp_config.json'),
      JSON.stringify({ mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args, env: mcp.env } } }),
      { mode: 0o600 },
    );
    settingsFile = path.join(mcpDir, 'settings.json');
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ permissions: { allow: [`mcp(${mcp.name}/*)`] } }),
      { mode: 0o600 },
    );
  }
  const allDirs = mcpDir ? [...addDirs, mcpDir] : addDirs;

  try {
    await runJsonLines({
      cmd: bin,
      args: argsFor({ system, prompt, sessionId, model, addDirs: allDirs, writable, settingsFile }),
      cwd,
      env,
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
            const info = m.tool_info ?? m.tool_call ?? m.subagent ?? {};
            const rawName = info.name ?? info.tool_name ?? m.tool_name ?? info.subagent_name ?? m.step_type;
            const params = info.parameters ?? {};
            const isMcp = rawName === 'call_mcp_tool' && params.ServerName && params.ToolName;
            const name = isMcp ? `${params.ServerName}.${params.ToolName}` : rawName;
            const target = isMcp
              ? (params.ServerName === mcp?.name ? targetOf(params.ToolName, params.Arguments ?? {}) : str(params.Arguments ?? '').slice(0, 240))
              : str(info.arguments ?? info.parameters ?? info.task_description ?? '').slice(0, 240);
            if (!open.has(id)) {
              open.add(id);
              onEvent({ type: 'tool', id, kind: kindOf(name), name, target });
            }
            if (m.state === 'DONE' || m.state === 'ERROR') {
              const errMsg = typeof info.error === 'object' && info.error !== null ? (info.error.message ?? JSON.stringify(info.error)) : info.error;
              onEvent({
                type: 'tool_result',
                id,
                ok: m.state !== 'ERROR' && info.error == null,
                name,
                target,
                output: str(errMsg ?? info.output ?? info.result ?? '').slice(0, 4000),
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
  } finally {
    if (mcpDir) fs.rmSync(mcpDir, { recursive: true, force: true });
  }

  if (failed && !text && !final) throw new Error(failed);
  return { sessionId: sid, text: text || final };
}
