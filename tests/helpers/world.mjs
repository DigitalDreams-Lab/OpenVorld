// A throwaway openVorld home for tests, and a helper to found a world in it. Import this BEFORE any engine module:
// the engine reads OPENVORLD_HOME when it loads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const home = (process.env.OPENVORLD_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'ov-test-')));
process.on('exit', () => { try { if (home.startsWith(os.tmpdir())) fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ } });
const W = await import('../../engine/server/world.mjs');

/** Found a world (blank, no brain by default) and return its context. `crew`: [{ name, job, function, brain }]. */
export function makeWorld(input = {}) {
  const { id } = W.createWorld({ name: 'Lantern Tea', about: 'A small tea shop', template: 'blank', brain: { provider: 'none' }, ...input });
  return W.worldCtx(id, { fresh: true });
}
export const { worldCtx, saveWorld } = W;
