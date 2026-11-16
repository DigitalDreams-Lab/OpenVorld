// Attract mode (play/?embed&attract): the website's hero shows the demo playing by itself, before its play button.
// Silent, no guide, and the founder's part is played for them: the first message, then "Allow once" for Jules. When the
// surprise is over it starts again. The page tells the website when the vorld is on screen, so the hero can fade it in.
import { getState, subscribe } from '../src/store';
import { api } from './api';
import { IDS, getPhase, openWrits, sleep, subscribePhase } from './engine';

const FIRST_MESSAGE = 'Today is Buzz’s birthday! 🎂 Can you plan a surprise party? Shh, keep it secret!';
const W = () => `/vorlds/${IDS.vorld}`;

export function startAttract() {
  const off = subscribe(() => {
    if (!getState().vorld) return;
    off();
    void run();
  });
}

async function run() {
  await sleep(1200);   // the map draws its first frames
  try { window.parent?.postMessage({ type: 'openvorld-demo', ready: true }, location.origin); } catch { /* not embedded */ }
  await sleep(1300);
  await api(`${W()}/threads/${IDS.room}/messages`, { body: { text: FIRST_MESSAGE } });
  let answered = false;
  subscribePhase(async () => {
    const phase = getPhase();
    if (phase === 'writ' && !answered) {
      answered = true;
      await sleep(2600);   // Jules walks over and asks; then "you" press Allow once
      const ask = openWrits()[0];
      if (ask) await api(`${W()}/threads/${ask.thread}/writs/${ask.id}`, { body: { answer: 'once' } });
    }
    if (phase === 'done') {
      await sleep(3000);
      // the website shows its play button once the story has been seen, then the loop starts again
      try { window.parent?.postMessage({ type: 'openvorld-demo', done: true }, location.origin); } catch { /* not embedded */ }
      await sleep(2500); location.reload();
    }
  });
}
