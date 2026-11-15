#!/usr/bin/env node
// OpenVorld command line.
//   npm run ov -- providers     agent CLIs found on this machine
//   npm run ov -- validate      load every pack and report problems
//   npm run ov -- vorlds        list your vorlds
import path from 'node:path';
import { loadPacks, packRoots, homeDir, REPO } from './lib/packs.mjs';
import { parse } from './lib/dsl.mjs';

const [cmd] = process.argv.slice(2);
const core = loadPacks([path.join(REPO, 'packs', 'core')]);
process.env.OPENVORLD_HOME ??= homeDir(core.byKind.defaults?.defaults);
const { detected, listVorlds, HOME } = await import('../engine/server/vorld.mjs');

if (cmd === 'providers') {
  const found = detected(true);
  console.log(found.length ? found.map((d) => `${d.label.padEnd(20)} ${d.version}`).join('\n') : 'No agent CLI found (Claude Code: claude, Codex: codex, Antigravity: agy, OpenCode: opencode). OpenAI-compatible APIs can be added in Settings.');
} else if (cmd === 'validate') {
  const packs = loadPacks(packRoots(HOME));
  const problems = [...packs.problems];
  for (const a of packs.byKind.achievements?.achievements?.achievements ?? []) { try { parse(a.when); } catch (e) { problems.push({ level: 'error', msg: `deed ${a.id}: ${e.message}` }); } }
  for (const t of Object.values(packs.byKind.template ?? {})) for (const q of t.parties ?? []) for (const i of q.members ?? []) if (!t.crew?.[i]) problems.push({ level: 'error', msg: `template ${t.id}: party "${q.name}" names crew #${i}, which is not in the template's crew` });
  for (const p of problems) console.log(`${p.level === 'error' ? 'ERROR' : 'warn '} ${p.msg}`);
  console.log(problems.some((p) => p.level === 'error') ? 'packs have errors' : 'packs ok');
  process.exit(problems.some((p) => p.level === 'error') ? 1 : 0);
} else if (cmd === 'vorlds') {
  const list = listVorlds();
  console.log(list.length ? list.map((w) => `${w.id.padEnd(24)} ${w.name}`).join('\n') : `No vorlds yet in ${HOME}.`);
} else {
  console.log('usage: npm run ov -- providers | validate | vorlds');
}
