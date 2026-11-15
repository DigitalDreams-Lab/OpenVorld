// What a member's brain needs to use the crew browser this turn. One browser (browser.mjs), three ways to reach it:
//  - API brains: the engine runs the tools in-process (`call`);
//  - Claude Code and Codex: a tiny MCP server (browser-mcp.mjs) they start, which calls back into the engine over the
//    local API with the launch token (`mcp`), so the writ checks always run in the engine, never in the bridge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hub from '../browser.mjs';
import { BROWSER_SERVER } from '../browser-tools.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-mcp.mjs');

/** { call, mcp, allowed } for this member and thread, or null when browsing is switched off or no Chrome is installed. */
export function browserFor(ctx, role, threadId, { emit, onRequest }) {
  if (ctx.interactions?.agent?.browser?.enabled === false || !hub.browserAvailable()) return null;
  return {
    call: (name, args) => hub.callTool(ctx, role, name, args, { emit, onRequest }),
    mcp: {
      name: BROWSER_SERVER, command: process.env.OV_NODE_EXECUTABLE || process.execPath, args: [BRIDGE],
      env: { OV_URL: `http://127.0.0.1:${process.env.OV_PORT ?? 4317}`, OV_TOKEN: process.env.OV_TOKEN ?? '', OV_VORLD: ctx.id, OV_ROLE: role, OV_THREAD: threadId,
        ...(process.env.OV_DESKTOP === '1' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    },
    allowed: [`mcp__${BROWSER_SERVER}`],
  };
}
