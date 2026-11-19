// "Surprise for Buzz": the demo's script. The crew plans a secret birthday party for Buzz, the vorld's companion bee.
// Every turn is played through the same live events a real brain produces (turn.start, thinking, plan, tool, delta,
// writ.request, turn.done), so the real client shows it exactly as it would show Claude Code or Codex at work.
import { F, IDS, PROJECT, append, command, files, member, reactions, send, sendEvent, setPhase, sleep, updateThread } from './engine';
import { BEE_FACTS_URL, PAGE_TEXT, frame } from './frames';
import { INVITATION } from './invitation';

const CREW = [IDS.mira, IDS.sage, IDS.jules];
let busy = false, finished = false, run = 0;
let waiting: { thread: string; id: string } | null = null;
const given = new Set<string>();
/** A game moment (XP, deeds, levels) computed by the real rules at build time; each one happens once per visit. */
const moment = (name: 'chat' | 'writ' | 'done') => { if (!given.has(name)) { given.add(name); send(F.game[name]); } };

class Stopped extends Error {}
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

// ---------- one turn of one member ----------
type Kit = {
  think(text: string): Promise<void>;
  say(text: string): Promise<void>;
  plan(items: { text: string; status: string }[]): void;
  tool(t: { kind: string; name: string; target: string; detail?: any; ms: number; output: string; test?: 'pass' | null; during?: () => Promise<void> }): Promise<void>;
};
async function turn(tid: string, role: string, meta: any, body: (k: Kit) => Promise<void>) {
  const mine = run, steps: any[] = [];
  const alive = () => { if (mine !== run) throw new Stopped(); };
  const ev = (e: any) => { alive(); sendEvent(tid, role, e); };
  const grow = (t: 'text' | 'thinking', text: string) => { const last = steps[steps.length - 1]; if (last?.t === t) last.text += text; else steps.push({ t, text }); };
  const stream = async (t: 'text' | 'thinking', text: string) => {
    for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
      ev({ type: t === 'text' ? 'delta' : 'thinking', text: chunk }); grow(t, chunk);
      await sleep(t === 'text' ? 34 + Math.random() * 40 : 22 + Math.random() * 20);
    }
  };
  let tools = 0;
  const kit: Kit = {
    think: (text) => stream('thinking', text),
    async say(text) { const last = steps[steps.length - 1]; if (last?.t === 'text') await stream('text', '\n\n'); await stream('text', text); },
    plan(items) { ev({ type: 'plan', items }); const i = steps.findIndex((s) => s.t === 'plan'); if (i >= 0) steps[i] = { t: 'plan', items }; else steps.push({ t: 'plan', items }); },
    async tool({ kind, name, target, detail = null, ms, output, test = null, during }) {
      const id = `demo-${role}-${++tools}-${Date.now()}`;
      const step: any = { t: 'tool', id, kind, name, target, detail, status: 'running' };
      steps.push(step);
      ev({ type: 'tool', id, kind, name, target, detail, reaction: reactions[kind] });
      await Promise.all([sleep(ms), during?.()]);
      alive();
      Object.assign(step, { status: 'ok', output, attachments: [], ms, test });
      ev({ type: 'tool_result', id, ok: true, output, attachments: [], ms, test, reaction: test === 'pass' ? reactions['test.pass'] : reactions[kind] });
    },
  };
  ev({ type: 'turn.start', brain: 'Demo', speaker: role, reaction: reactions['turn.start'] });
  if (tid === IDS.room) updateThread(tid, { speaker: role });
  await body(kit);
  alive();
  const text = steps.filter((s) => s.t === 'text').map((s) => s.text).join('').trim();
  append(tid, { type: 'agent.text', role, text, meta, steps });
  const thread = updateThread(tid, {});
  ev({ type: 'turn.done', text, meta, thread });
}

// they stay at the hall while the job runs (go_home replaces the long wait)
const gather = () => CREW.forEach((id) => command(id, [{ do: 'walk_to', to: { kind: 'plaza' }, label: 'gathers at the Party Hall' }, { do: 'wait', ms: 120000 }]));
const home = () => CREW.forEach((id) => command(id, [{ do: 'go_home', label: 'goes home' }]));
const link = (name: string) => `${PROJECT}/${name}`;

// ---------- the party room ----------
export async function partyMessage(tid: string) {
  if (busy) throw fail('the party is still working', 409);
  if (waiting) return quick(tid, IDS.mira, 'Jules is waiting for your OK on the request above. 🙂 Press **Allow once** and we can carry on!');
  if (finished) return quick(tid, IDS.mira, 'Buzz is still smiling. 😄 The party is over, but you can play the demo again from the top!');
  busy = true; setPhase('running');
  const mine = ++run;
  try {
    await sleep(400); moment('chat');
    gather(); await sleep(1500);
    await turn(tid, IDS.mira, { mood: 'happy', balloon: 'A secret plan!', noted: ['Buzz loves sunflowers, honey cake and slow jazz'] }, async (k) => {
      await k.think('A secret party for Buzz! First: what does Buzz love most?');
      const plan = (done: number) => ['Read what Buzz loves', 'Write a birthday poem', 'Build the invitation', 'Surprise!'].map((text, i) => ({ text, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }));
      k.plan(plan(0));
      await k.tool({ kind: 'tool.read', name: 'Read', target: link('buzz-notes.md'), ms: 1500, output: files.get('buzz-notes.md') ?? '' });
      k.plan(plan(1));
      await k.say('Oh, I love this! 🎉 Buzz will never guess.\n\nFrom our notes, Buzz loves **sunflowers**, **honey cake** and **slow jazz**. So: a sunflower party, a honey cake, and very quiet jazz.\n\n@Sage, can you write a tiny birthday poem for the invitation?');
    });
    await sleep(700);
    await turn(tid, IDS.sage, { mood: 'happy', balloon: 'Poem ready!' }, async (k) => {
      await k.think('A short poem. And maybe one fun bee fact for the card.');
      await k.tool({ kind: 'tool.web', name: 'browser_open', target: BEE_FACTS_URL, ms: 3600, output: PAGE_TEXT, during: browse });
      await k.say('Here is the poem 🌻\n\n> Little captain, small and bright,\n> you hum our mornings into light.\n> Today the hive is all for you:\n> sweet honey cake, and sunflowers too.\n\nAnd a fun fact for the card: bees **dance** to tell their friends where the flowers are. So we need a dance floor! 💃\n\n@Jules, can you build the invitation page with this poem?');
    });
    send({ type: 'browser', role: IDS.sage, url: BEE_FACTS_URL, title: 'Bee Facts', active: false });
    await sleep(700);
    await turn(tid, IDS.jules, { mood: 'thinking', balloon: 'Can I save it?' }, async (k) => {
      await k.think('An invitation page, yellow and bouncy. It belongs in the project folder.');
      await k.say('On it! 🔨 I’ll make it yellow and very bouncy.\n\nFirst I need your OK to save the page in our project folder.');
    });
    // like the real runner: the request is saved after the reply, and the room pauses until you answer
    const ask = append(tid, { type: 'writ.request', id: crypto.randomUUID(), role: IDS.jules, capability: 'fs.write', scope: PROJECT, why: 'to save Buzz’s invitation page', risk: 'medium' });
    sendEvent(tid, IDS.jules, { ...ask, reaction: reactions['writ.request'] });
    waiting = { thread: tid, id: ask.id };
    if (mine === run) setPhase('writ');
  } catch (e) { if (!(e instanceof Stopped)) throw e; }
  finally { busy = false; updateThread(tid, { speaker: null, state: 'waiting' }); }
}

async function browse() {
  for (const [step, wait] of [[0, 700], [1, 1200], [2, 1500]] as const) {
    send({ type: 'browser', role: IDS.sage, url: BEE_FACTS_URL, title: 'Bee Facts', image: frame(step), active: true });
    await sleep(wait);
  }
}

/** The founder answered Jules's request (the route already saved and sent writ.answered). */
export async function writAnswered(tid: string, answer: string) {
  if (!waiting || waiting.thread !== tid) return;
  waiting = null; busy = true;
  const mine = ++run;
  try {
    if (answer === 'deny') {
      setPhase('running');
      await sleep(600);
      await turn(tid, IDS.jules, { mood: 'neutral', balloon: 'No problem!' }, (k) => k.say('Okay, no problem! 🙂 I won’t save anything.\n\n(Psst: the invitation would be really cute. Play again and press **Allow once** to see it.)'));
      home();
      if (mine === run) setPhase('denied');
      return;
    }
    setPhase('running');
    moment('writ');
    await sleep(900);
    await turn(tid, IDS.jules, { mood: 'proud', balloon: 'Invitation ready!' }, async (k) => {
      await k.tool({ kind: 'tool.write', name: 'Write', target: link('invitation.html'), detail: { write: INVITATION.split('<body>')[1]?.trim().slice(0, 900) ?? '' }, ms: 2600, output: 'Wrote invitation.html (64 lines)' });
      files.set('invitation.html', INVITATION);
      await k.tool({ kind: 'tool.run', name: 'Bash', target: 'npx html-validate invitation.html', ms: 1700, output: '✓ invitation.html: no problems found', test: 'pass' });
      await k.say(`Done! 🐝 The invitation is ready: sunflowers, the poem, and a little dance floor.\n\n[Open the invitation](<${link('invitation.html')}>)\n\n@Mira, it’s all yours.`);
    });
    await sleep(700);
    await turn(tid, IDS.mira, { mood: 'happy', balloon: 'Surprise time!' }, async (k) => {
      k.plan(['Read what Buzz loves', 'Write a birthday poem', 'Build the invitation', 'Surprise!'].map((text) => ({ text, status: 'completed' })));
      await k.say('It’s perfect. 🥹 Cake: ready. Jazz: very quiet. Sunflowers: everywhere.\n\nEveryone, come on… let’s find Buzz. **SURPRISE!** 🎂');
    });
    await surprise();
    finished = true;
    if (mine === run) setPhase('done');
  } catch (e) { if (!(e instanceof Stopped)) throw e; }
  finally { busy = false; updateThread(tid, { speaker: null, state: 'waiting' }); }
}

/** The finale: the crew runs to Buzz (who is always by your side), shouts and dances. Then the real deed and level toasts. */
async function surprise() {
  const lines = ['Surprise! 🎉', 'Happy birthday! 🌻', 'Surpriiise! 🎂'];
  CREW.forEach((id, i) => command(id, [{ do: 'wait', ms: i * 300 }, { do: 'walk_to', to: { kind: 'founder' } }, { do: 'say', text: lines[i] }, { do: 'emote', kind: 'dance' }, { do: 'emote', kind: 'cheer' }, { do: 'emote', kind: 'dance' }]));
  command(IDS.companion, [{ do: 'wait', ms: 4200 }, { do: 'say', text: 'For me?! 🥹' }, { do: 'emote', kind: 'dance' }, { do: 'say', text: 'Best birthday ever! 🐝' }, { do: 'emote', kind: 'dance' }]);
  await sleep(7600);
  moment('done');
  await sleep(4200);
  home();
}

/** A short reply that is not part of the story (a message while the party waits, or after it). */
async function quick(tid: string, role: string, text: string) {
  busy = true;
  try { await sleep(500); await turn(tid, role, { mood: 'happy' }, (k) => k.say(text)); }
  catch (e) { if (!(e instanceof Stopped)) throw e; }
  finally { busy = false; }
}

// ---------- a private chat with one member ----------
const REPLIES: Record<string, string> = {
  mira: 'That’s lovely to hear! 🌻 In this demo I only know the birthday plan. In the real OpenVorld, I’d answer with Claude Code, Codex, Antigravity, OpenCode or any AI you connect.\n\nWant to help with Buzz’s surprise? Open the **Party Hall**!',
  sage: 'Good question! 📚 This is a demo, so my answers are written ahead of time. In the real app I think with the AI you choose, and I work on your real files.\n\nThe crew is at the Party Hall, by the way. 👀',
  jules: 'Ha, I like it! 🔨 In this demo I can only build one thing today: Buzz’s invitation. Download OpenVorld and I’ll build things for your real project.',
};
const chatting = new Set<string>();
export async function chatMessage(tid: string, role: string) {
  if (chatting.has(tid)) throw fail('this crew member is still working', 409);
  chatting.add(tid);
  const key = Object.entries(IDS).find(([, v]) => v === role)?.[0] ?? '';
  try {
    await sleep(350); moment('chat');
    await turn(tid, role, { mood: 'happy' }, async (k) => {
      await k.think('A visitor! Be kind, and point them to the party.');
      await k.say(REPLIES[key] ?? `Hi! I’m ${member(role)?.name ?? 'here'}. This is a demo vorld. Download OpenVorld to work with me on your real project. 🐝`);
    });
  } catch (e) { if (!(e instanceof Stopped)) throw e; }
  finally { chatting.delete(tid); }
}

/** Stop pressed in a chat: the turn ends where it is, and the crew goes home. */
export function stop(tid: string) {
  if (!busy && !chatting.has(tid)) return;
  run++; chatting.delete(tid);
  sendEvent(tid, null, { type: 'turn.error', message: 'Stopped.' });
  home();
  if (!finished && !waiting) setPhase('idle');
}
