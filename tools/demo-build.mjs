// Build the playable web demo (release/demo): the real OpenVorld client, with a scripted engine that runs in the browser.
//
//   npm run demo:build              fixtures + art + client build
//   npm run demo:build -- --fixtures-only
//
// 1. The REAL engine makes the demo vorld "Honey Hollow" in a throwaway home. The real server is started on it and every
//    answer the client needs is saved (engine/client/demo/generated/fixtures.json), so the demo shows exactly what the
//    app would. Machine paths are replaced with ~/.openvorld, and nothing from this computer (CLIs, home folder) is kept.
// 2. The artwork the server serves is saved as WebP (much smaller than PNG) for the web.
// 3. The scenario's game moments (chat, writ, finished job) go through the real game rules, so XP, deeds and levels match.
// 4. Vite builds engine/client/demo/index.html with the demo engine in place of src/api.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'engine/client/demo/generated');
fs.mkdirSync(path.join(out, 'public'), { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openvorld-demo-'));
const HOME = path.join(temporary, 'data');
process.env.OPENVORLD_HOME = HOME;
const PRETTY = '~/.openvorld';

const { createVorld, vorldCtx, saveVorld } = await import('../engine/server/vorld.mjs');
const { saveParty, createPartyChat } = await import('../engine/server/parties.mjs');
const { createThread, appendEvent } = await import('../engine/server/threads.mjs');
const { saveProfile } = await import('../engine/server/profile.mjs');
const { benchOf } = await import('../engine/server/benches.mjs');
const { Game } = await import('../engine/server/game.mjs');

// ---------- the demo vorld ----------
const { id } = createVorld({
  name: 'Honey Hollow', about: 'A tiny studio where a crew of AI agents makes lovely things together.', template: 'blank',
  brain: { provider: 'none' }, companion: { name: 'Buzz', form: 'creature', species: 'bee' },
  crew: [
    { name: 'Mira', job: 'Party host', function: 'Plans the day and keeps the crew together.' },
    { name: 'Sage', job: 'Writer', function: 'Finds facts and writes the words.' },
    { name: 'Jules', job: 'Builder', function: 'Builds pages and small tools.' },
  ],
});
let ctx = saveVorld(vorldCtx(id), (doc) => { doc.seed = 'openvorld-launch-studio'; });
saveProfile(HOME, { name: 'You', about: 'Visiting Honey Hollow.' });
const [mira, sage, jules] = ctx.crew.filter((m) => m.role === 'agent');
const party = saveParty(ctx, { name: 'Surprise crew', goal: 'Throw Buzz the best surprise birthday party. Shh, Buzz must not know!', members: [mira.id, sage.id, jules.id] }, null, { starter: true });
const room = createPartyChat(ctx, party.id, 'Buzz’s surprise');
const project = path.join(ctx.dir, 'project');
fs.writeFileSync(path.join(project, 'buzz-notes.md'), BUZZ_NOTES());
for (const [m, text] of [
  [mira, 'Hi, I’m Mira, the host here. 🌻\n\nPsst… today is **Buzz’s birthday**, and Buzz has no idea. Open the **Party Hall** in the plaza and let’s plan a surprise together!'],
  [sage, 'Hello! I’m Sage. I find facts and write the words.\n\nFun fact: bees can see colors that we can’t. 🐝'],
  [jules, 'Hey! Jules here. I build pages and small tools. 🔨\n\nThe crew is planning something secret at the Party Hall. Want to join?'],
]) {
  const t = createThread(ctx, { role: m.id, kind: 'chat', title: 'Hello', bench: benchOf(ctx, m.id).id });
  appendEvent(ctx, t.id, { type: 'agent.text', role: m.id, text, meta: { mood: 'happy' }, steps: [] });
}

// ---------- capture what the real server answers ----------
const TOKEN = 'demo-build';
const server = spawn(process.execPath, [path.join(root, 'engine/server/index.mjs')], { env: { ...process.env, OPENVORLD_HOME: HOME, OV_PORT: '0', OV_TOKEN: TOKEN, OV_DESKTOP: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', (d) => { buf += d; const m = buf.match(/on http:\/\/127\.0\.0\.1:(\d+)/); if (m) resolve(Number(m[1])); });
  server.on('exit', (code) => reject(new Error(`server exited (${code})`)));
  setTimeout(() => reject(new Error('server did not start')), 20000);
});
const get = async (p, type = 'json') => {
  const res = await fetch(`http://127.0.0.1:${port}/api${p}`, { headers: { 'x-ov-token': TOKEN } });
  if (!res.ok) throw new Error(`GET ${p}: ${res.status}`);
  return type === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
};
const W = `/vorlds/${id}`;
let fixtures, art = [];
try {
  const vorld = await get(`${W}/vorld`);
  const threads = await get(`${W}/threads`);
  fixtures = {
    boot: { ...(await get('/boot')), detected: [] },
    profile: await get('/profile'),
    vorld,
    settings: { ...(await get(`${W}/settings`)), detected: [] },
    threads: Object.fromEntries(await Promise.all(threads.map(async (t) => [t.id, await get(`${W}/threads/${t.id}`)]))),
    grants: await get(`${W}/grants`),
    vaults: Object.fromEntries(await Promise.all(vorld.crew.map(async (c) => [c.id, await get(`${W}/crew/${c.id}/vault`)]))),
  };
  fs.rmSync(path.join(out, 'public/art'), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'public/art'), { recursive: true });
  for (const sheet of vorld.art.atlas?.sheets ?? []) {
    const png = path.join(temporary, `${sheet.image}.png`), webp = path.join(out, 'public/art', `${sheet.image}.webp`);
    fs.writeFileSync(png, await get(`/art/${encodeURIComponent(sheet.image)}`, 'bin'));
    execFileSync('cwebp', ['-quiet', '-q', '88', '-alpha_q', '100', '-m', '6', png, '-o', webp]);
    art.push({ sheet: sheet.image, png: fs.statSync(png).size, webp: fs.statSync(webp).size });
  }
} finally { server.kill(); }

// ---------- the scenario's game moments, through the real rules ----------
const game = new Game(vorldCtx(id, { fresh: true }));
const moment = (fn) => { const notes = []; fn(notes); const n = game.check(notes); return { type: 'game', notes: n, state: game.snapshot() }; };
fixtures.game = {
  chat: moment((notes) => game.event('chat.sent').xp('chat_message', notes)),
  writ: moment((notes) => { game.event('party.handoff', 2); game.event('writ.granted').xp('writ_granted', notes); }),
  done: moment((notes) => { game.event('party.handoff'); game.event('party.job_done').xp('party_done', notes); game.event('party.big_job'); }),
};
fixtures.ids = { vorld: id, party: party.id, room: room.id, mira: mira.id, sage: sage.id, jules: jules.id, companion: ctx.crew.find((m) => m.role === 'companion')?.id ?? 'companion' };
fixtures.project = `${PRETTY}/vorlds/${id}/project`;
fixtures.files = { 'buzz-notes.md': BUZZ_NOTES() };

// ---------- write, without anything from this computer ----------
let text = JSON.stringify(fixtures, null, 1).replaceAll(fs.realpathSync(HOME), PRETTY).replaceAll(HOME, PRETTY);
for (const leak of [os.homedir(), os.userInfo().username, temporary]) if (leak && leak.length > 2 && text.includes(leak)) throw new Error(`fixtures still contain "${leak}"`);
fs.writeFileSync(path.join(out, 'public/fixtures.json'), text + '\n');
fs.rmSync(temporary, { recursive: true, force: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`demo fixtures: ${Object.keys(fixtures.threads).length} threads, ${fixtures.vorld.crew.length} crew`);
for (const a of art) console.log(`  art ${a.sheet}: ${kb(a.png)} png -> ${kb(a.webp)} webp`);
console.log(`  game: chat ${fixtures.game.chat.notes.length} notes, writ ${fixtures.game.writ.notes.length}, done ${fixtures.game.done.notes.map((n) => n.type + (n.name ? ':' + n.name : n.level ? ':' + n.level : '')).join(', ')}`);

if (!process.argv.includes('--fixtures-only')) {
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root, 'engine/client/vite.demo.config.mjs')], { stdio: 'inherit', cwd: root });
  console.log('demo built in release/demo');
}

function BUZZ_NOTES() {
  return `# Buzz: little things to remember

- Favorite flower: **sunflowers** 🌻
- Favorite food: **honey cake** (with a little lemon)
- Favorite music: slow jazz, very quiet
- Loves it when we call Buzz "little captain"
- Birthday: **today**! (Buzz forgot. Shh.)
`;
}
