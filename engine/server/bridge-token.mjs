// Tokens for the tool bridge (agents/browser-mcp.mjs). A brain's MCP server needs a token to call back into the engine, and the
// brain itself can often read it: a config file in a folder it may read, its own command line, its environment. So the bridge
// never gets the launch token, which opens the whole API (answering writs, changing the crew, ...). It gets a random token for
// ONE member's ONE turn that opens only that member's own tools (browser, secret_ask, recall) and dies when the turn ends.
// What a leaked bridge token can do is what the member can already do, with every writ still checked by the engine.
import crypto from 'node:crypto';
import { BRIDGE_TOOLS } from './browser-tools.mjs';

const live = new Map();          // token -> { vorld, role, thread }

export function mintBridgeToken(vorld, role, thread) {
  const token = crypto.randomBytes(24).toString('hex');
  live.set(token, { vorld, role, thread });
  return token;
}
export const revokeBridgeToken = (token) => live.delete(token);
export const liveBridgeTokens = () => live.size;

const ROUTE = /^\/api\/vorlds\/([^/]+)\/browser\/([^/]+)\/([^/]+)$/;
const decoded = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

/** Does a bridge token open this very request: POST .../browser/<its member>/<one of the bridge's tools>?thread=<its turn's thread>? */
export function bridgeTokenAllows(token, method, url) {
  const grant = typeof token === 'string' ? live.get(token) : undefined;
  if (!grant || method !== 'POST') return false;
  const m = url.pathname.match(ROUTE);
  if (!m) return false;
  return decoded(m[1]) === grant.vorld && decoded(m[2]) === grant.role && BRIDGE_TOOLS.some((t) => t.name === decoded(m[3]))
    && url.searchParams.get('thread') === grant.thread;
}

/** The API's gate: the launch token opens everything, a bridge token only its own bridge call. */
export const apiAuthorized = (token, launchToken, method, url) => (!!token && token === launchToken) || bridgeTokenAllows(token, method, url);
