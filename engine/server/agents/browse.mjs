// What a member's brain needs to reach the engine's own tools this turn: the crew browser (browser.mjs), secret_ask and
// recall (memory.mjs). One set of tools, two ways to reach it:
//  - API brains: the engine runs the tools in-process (`call` for the browser);
//  - Claude Code and Codex: a tiny MCP server (browser-mcp.mjs) they start, which calls back into the engine over the
//    local API with the launch token (`mcp`), so the writ checks always run in the engine, never in the bridge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hub from '../browser.mjs';
import { BRIDGE_TOOLS, BROWSER_SERVER, RECALL_TOOL, isBrowserTool } from '../browser-tools.mjs';
import { memoryOn } from '../memory.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-mcp.mjs');

/** { call, mcp, allowed } for this member and thread. `call` is null when browsing is switched off or no Chrome is installed. */
export function browserFor(ctx, role, threadId, { emit, onRequest }) {
  const browsing = ctx.interactions?.agent?.browser?.enabled !== false && hub.browserAvailable();
  const tools = BRIDGE_TOOLS.filter((t) => (browsing || !isBrowserTool(t.name)) && (t !== RECALL_TOOL || memoryOn(ctx))).map((t) => t.name);
  return {
    call: browsing ? (name, args) => hub.callTool(ctx, role, name, args, { emit, onRequest }) : null,
    mcp: {
      name: BROWSER_SERVER, command: process.env.OV_NODE_EXECUTABLE || process.execPath, args: [BRIDGE],
      env: { OV_URL: `http://127.0.0.1:${process.env.OV_PORT ?? 4317}`, OV_TOKEN: process.env.OV_TOKEN ?? '', OV_VORLD: ctx.id, OV_ROLE: role, OV_THREAD: threadId, OV_TOOLS: tools.join(','),
        ...(process.env.OV_DESKTOP === '1' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    },
    allowed: [`mcp__${BROWSER_SERVER}`],
  };
}
