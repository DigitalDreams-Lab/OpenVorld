// Any other agent CLI or harness, described in a pack (providers.yaml > drivers.command), so a tool OpenVorld has no driver
// for can still be a brain. Each turn runs `run` once in the member's workbench, writes the prompt to its input and shows
// what it prints as the reply. It keeps no session (every turn is told the conversation so far) and reports no tool steps.
// Writs reach it only as words in its prompt: the engine cannot enforce them inside a harness it does not drive.
// When the engine's MCP bridge is available, a private temp `mcp-config.json` (standard `mcpServers` format) is written for
// the turn: packs can pass it via `mcp_args` / `{mcp_config}` or read `OV_MCP_CONFIG` (and `OV_URL`/`OV_TOKEN`/...) from env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { cleanEnv } from './proc.mjs';

/** The command line for one turn: `run`, plus `model_args` and `mcp_args` when present ({model}, {cwd}, {mcp_config} are filled in). */
export function commandFor(spec = {}, { model, cwd, mcpConfig = '' }) {
  const fill = (a) => String(a)
    .replace(/\{model\}/g, model ?? '')
    .replace(/\{cwd\}/g, cwd ?? '')
    .replace(/\{mcp_config\}/g, mcpConfig ?? '');
  const [cmd, ...args] = (spec.run ?? []).map(fill);
  if (!cmd) throw new Error('this brain has no "run" command in its pack');
  return {
    cmd,
    args: [
      ...args,
      ...(model ? (spec.model_args ?? []).map(fill) : []),
      ...(mcpConfig ? (spec.mcp_args ?? []).map(fill) : []),
    ],
  };
}

export async function run({ spec, system, prompt, cwd, model, mcp = null, env = null, signal, onEvent }) {
  let mcpDir = null, mcpConfig = '';
  if (mcp) {
    mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-cmd-'));
    mcpConfig = path.join(mcpDir, 'mcp-config.json');
    fs.writeFileSync(
      mcpConfig,
      JSON.stringify({ mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args, env: mcp.env } } }),
      { mode: 0o600 },
    );
  }
  const { cmd, args } = commandFor(spec, { model, cwd, mcpConfig });
  const childEnv = {
    ...cleanEnv(),
    ...(env ?? {}),
    ...(mcp ? { ...(mcp.env ?? {}), OV_MCP_CONFIG: mcpConfig } : {}),
  };
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      const kill = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', kill, { once: true });
      let text = '', err = '';
      child.stdout.setEncoding('utf8').on('data', (d) => { text += d; onEvent({ type: 'delta', text: d }); });
      child.stderr.setEncoding('utf8').on('data', (d) => { err = (err + d).slice(-4000); });
      child.stdin.on('error', () => {});          // it may not read its input at all
      child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
      child.on('close', (code) => {
        signal?.removeEventListener('abort', kill);
        if (signal?.aborted) return reject(new Error('stopped by the founder'));
        code === 0 ? resolve({ sessionId: null, text }) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} exited with ${code}`));
      });
      child.stdin.end(`${system}\n\n---\n\n${prompt}`);
    });
  } finally {
    if (mcpDir) fs.rmSync(mcpDir, { recursive: true, force: true });
  }
}
