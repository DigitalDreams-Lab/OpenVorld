#!/usr/bin/env node
// A tiny MCP server (stdio, JSON-RPC lines) that gives Claude Code and Codex the crew browser tools. It holds no logic
// of its own: every call goes to the OpenVorld server, which checks the member's writs and drives the browser.
// Environment: OV_URL, OV_TOKEN, OV_VORLD, OV_ROLE, OV_THREAD (set by the engine for each turn).
import readline from 'node:readline';
import { BRIDGE_TOOLS, BROWSER_SERVER } from '../browser-tools.mjs';

const { OV_URL, OV_TOKEN, OV_VORLD, OV_ROLE, OV_THREAD } = process.env;
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

async function call(name, args) {
  const q = OV_THREAD ? `?thread=${encodeURIComponent(OV_THREAD)}` : '';
  try {
    const r = await fetch(`${OV_URL}/api/vorlds/${encodeURIComponent(OV_VORLD)}/browser/${encodeURIComponent(OV_ROLE)}/${name}${q}`, {
      method: 'POST', headers: { 'x-ov-token': OV_TOKEN ?? '', 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}),
    });
    const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) return { text: `error: ${data.error ?? r.status}`, isError: true };
    return { text: String(data.output ?? ''), isError: !data.ok, image: data.image ?? data.images?.[0] };
  } catch (e) { return { text: `error: cannot reach the OpenVorld server (${e.message})`, isError: true }; }
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const reply = (result) => m.id !== undefined && send({ id: m.id, result });
  if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: BROWSER_SERVER, version: '1.0.0' } });
  if (m.method === 'ping') return reply({});
  if (m.method === 'tools/list') return reply({ tools: BRIDGE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.properties, required: t.required } })) });
  if (m.method === 'tools/call') {
    const r = await call(m.params?.name, m.params?.arguments);
    const content = [{ type: 'text', text: r.text }];
    if (r.image?.data) content.push({ type: 'image', data: r.image.data, mimeType: r.image.type ?? 'image/jpeg' });
    return reply({ content, isError: r.isError });
  }
  if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
});
