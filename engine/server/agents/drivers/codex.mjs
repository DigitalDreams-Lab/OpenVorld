// Codex CLI driver (codex exec --json). Prompt on stdin with '-'. Sandbox from writs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runJsonLines } from './proc.mjs';
import { imagesOf, kindOf, targetOf } from '../steps.mjs';

/** `-c` overrides (TOML values) that register the crew browser as an MCP server for this run. */
const toml = (v) => JSON.stringify(String(v));
export const mcpArgs = (mcp) => (mcp ? [
  '-c', `mcp_servers.${mcp.name}.command=${toml(mcp.command)}`,
  '-c', `mcp_servers.${mcp.name}.args=[${mcp.args.map(toml).join(', ')}]`,
  '-c', `mcp_servers.${mcp.name}.default_tools_approval_mode="approve"`,   // the engine checks the writs on every call; Codex has no one to ask
  '-c', `mcp_servers.${mcp.name}.env={${Object.entries(mcp.env).map(([k, v]) => `${k}=${toml(v)}`).join(', ')}}`,
] : []);
/**
 * Pictures Codex's image tool made during this turn. It saves them under CODEX_HOME/generated_images/<session>/, far outside any
 * workbench, so the reply can only point at them. Handing them to the chat as the result of an image step shows them in the message.
 */
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export function generatedImages(sessionId, since, env = null, max = 4) {
  if (!sessionId || !/^[\w-]{8,80}$/.test(sessionId)) return [];
  const dir = path.join(env?.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'generated_images', sessionId);
  try {
    return fs.readdirSync(dir).flatMap((name) => {
      const type = IMAGE[name.split('.').at(-1).toLowerCase()], file = path.join(dir, name);
      if (!type) return [];
      const st = fs.statSync(file);
      return st.isFile() && st.mtimeMs >= since && st.size < 20 * 1024 * 1024 ? [{ name, file, type, at: st.mtimeMs }] : [];
    }).sort((a, b) => a.at - b.at).slice(0, max);
  } catch { return []; }
}
const plan = (it) => (it.items ?? []).map((x) => ({ text: x.text ?? '', status: x.completed ? 'completed' : 'pending' }));

export async function run({ system, prompt, images = [], sessionId, cwd, addDirs = [], mcp = null, env = null, writable = false, web = false, model, signal, onEvent, onAccess = () => {} }) {
  const SANDBOX = /Operation not permitted|Read-only file system|EROFS|EPERM|sandbox/i;
  // --ignore-user-config: only what OpenVorld passes applies, never the founder's own Codex plugins or MCP servers
  // (computer-use and browser plugins there could drive the founder's real apps and bypass writs)
  const base = ['--json', '--skip-git-repo-check', '--ignore-user-config', ...images.flatMap(f=>['--image',f.path]), ...(web ? ['-c', 'tools.web_search=true'] : []), ...mcpArgs(mcp)];
  // `codex exec resume` has no -s / --add-dir: a resumed session keeps whatever sandbox it was started with, so a writ granted (or
  // revoked) after the chat began never took effect. The same settings go in as config overrides, on every turn.
  const sandbox = ['-c', `sandbox_mode=${toml(writable ? 'workspace-write' : 'read-only')}`,
    ...(writable && addDirs.length ? ['-c', `sandbox_workspace_write.writable_roots=[${addDirs.map(toml).join(', ')}]`] : [])];
  const args = sessionId
    ? ['exec', 'resume', sessionId, ...base, ...sandbox, ...(model ? ['-m', model] : []), '-']
    : ['exec', ...base, '-C', cwd, '-s', writable ? 'workspace-write' : 'read-only', ...addDirs.flatMap((d) => ['--add-dir', d]), ...(model ? ['-m', model] : []), '-'];
  let sid = sessionId, text = '', failed = '';
  const startedAt = Date.now() - 2000;
  const searches = new Set();
  await runJsonLines({
    cmd: 'codex', args, cwd, env, signal,
    stdin: sessionId ? prompt : `${system}\n\n---\n\n${prompt}`,
    onLine: (m) => {
      if (m.type === 'thread.started') sid = m.thread_id;
      if (m.type === 'turn.failed') failed = m.error?.message ?? 'the turn failed';
      if (m.type === 'error' && m.message) failed = m.message;
      const it = m.item;
      if (!it) return;
      const done = m.type === 'item.completed', started = m.type === 'item.started';
      if (done && it.type === 'agent_message' && it.text) {
        const t = (text ? '\n\n' : '') + it.text;
        text += t; onEvent({ type: 'delta', text: t });
      } else if (done && it.type === 'reasoning' && it.text) {
        onEvent({ type: 'thinking', text: it.text + '\n' });
      } else if (started && it.type === 'command_execution') {
        onEvent({ type: 'tool', id: it.id, kind: 'tool.run', name: 'shell', target: String(it.command).slice(0, 240) });
      } else if (done && it.type === 'command_execution') {
        onEvent({ type: 'tool_result', id: it.id, ok: it.exit_code === 0, name: 'shell', target: String(it.command).slice(0, 240), output: it.aggregated_output ?? '' });
        // the read-only sandbox stopped a write: ask the founder for write access to the working folder
        if (it.exit_code !== 0 && !writable && SANDBOX.test(it.aggregated_output ?? '')) onAccess({ capability: 'fs.write', scope: cwd, why: `the command "${String(it.command).slice(0, 60)}" needs to write files` });
      } else if (done && it.type === 'file_change') {
        (it.changes ?? []).forEach((c, i) => {
          const id = `${it.id}:${i}`;
          onEvent({ type: 'tool', id, kind: c.kind === 'add' ? 'tool.write' : 'tool.edit', name: 'patch', target: c.path, detail: c.kind === 'delete' ? { note: 'deleted' } : null });
          onEvent({ type: 'tool_result', id, ok: it.status !== 'failed', name: 'patch', target: c.path, output: c.kind ?? '' });
        });
      } else if (started && it.type === 'mcp_tool_call') {
        onEvent({ type: 'tool', id: it.id, kind: kindOf(it.tool), name: `${it.server}.${it.tool}`, target: kindOf(it.tool) === 'tool.web' ? targetOf(it.tool, it.arguments ?? {}) : JSON.stringify(it.arguments ?? {}).slice(0, 240) });
      } else if (done && it.type === 'mcp_tool_call') {
        const content=it.result?.content;
        const output=Array.isArray(content)?content.filter(b=>b.type!=='image').map(b=>b.text??JSON.stringify(b)).join('\n'):JSON.stringify(it.result??'');
        onEvent({ type: 'tool_result', id: it.id, ok: it.status !== 'failed' && !it.error, name: `${it.server}.${it.tool}`, output: it.error?.message ?? output.slice(0, 4000), images:imagesOf(content) });
      } else if ((started || done) && it.type === 'web_search') {
        if (!searches.has(it.id)) { searches.add(it.id); onEvent({ type: 'tool', id: it.id, kind: 'tool.web', name: 'web', target: it.query ?? '' }); }
        if (done) onEvent({ type: 'tool_result', id: it.id, ok: true, name: 'web', output: '' });
      } else if (it.type === 'todo_list') {
        onEvent({ type: 'plan', items: plan(it) });
      }
    },
  });
  if (failed && !text) throw new Error(failed);
  for (const img of generatedImages(sid, startedAt, env)) {
    const id = `image:${img.name}`;
    onEvent({ type: 'tool', id, kind: 'tool.write', name: 'image_gen', target: img.name });
    onEvent({ type: 'tool_result', id, ok: true, name: 'image_gen', target: img.name, output: 'generated image', images: [{ data: fs.readFileSync(img.file).toString('base64'), type: img.type }] });
  }
  return { sessionId: sid, text };
}
