// The demo's guide over the game: a welcome card, one short tip at a time while the story runs, and the ending card.
// It only starts the story and opens the party room; everything else is the real app.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { setState, useStore } from '../src/store';
import { play } from '../src/audio/sfx';
import { api } from './api';
import { EMBED, IDS, createThread, getPhase, setPhase, subscribePhase, threads } from './engine';

const DOWNLOAD = 'https://github.com/DigitalDreams-Lab/OpenVorld/releases/latest';
/** The full-page demo (from the website's hero, where the demo runs in a small window). */
const FULL = <a className="btn small" href="./" target="_top">Open the full demo ↗</a>;
const FIRST_MESSAGE = 'Today is Buzz’s birthday! 🎂 Can you plan a surprise party? Shh, keep it secret!';

export function DemoGuide() {
  const phase = useSyncExternalStore(subscribePhase, getPhase);
  const loaded = useStore((s) => !!s.vorld);
  const partyOpen = useStore((s) => s.partyId === IDS.party);
  const [ready, setReady] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => { if (!loaded) return; const t = setTimeout(() => setReady(true), 900); return () => clearTimeout(t); }, [loaded]);
  useEffect(() => {
    // in the small hero window Jules asks on the map (Allow buttons over Jules's head), so the chat stays closed
    if (phase === 'writ' && !partyOpen && !EMBED) setState({ partyId: IDS.party, talkingTo: null, modal: null });
    if (phase !== 'done') { setEnding(false); return; }
    const t = setTimeout(() => setEnding(true), 2600);
    return () => clearTimeout(t);
  }, [phase]);

  const openRoom = () => setState({ partyId: IDS.party, talkingTo: null, modal: null });
  const start = async () => {
    if (!threads.has(IDS.room)) IDS.room = createThread({ kind: 'party', party: IDS.party }).id;
    play('ui.open'); if (!EMBED) openRoom(); setPhase('running');
    try { await api(`/vorlds/${IDS.vorld}/threads/${IDS.room}/messages`, { body: { text: FIRST_MESSAGE } }); }
    catch { setPhase('idle'); }
  };
  const again = () => { try { sessionStorage.removeItem('ov.atTitle'); } catch { /* ignore */ } location.reload(); };

  if (!ready) return null;

  if (phase === 'welcome') return (
    <div className="demo-veil">
      <section className="demo-card panel" role="dialog" aria-labelledby="demo-title">
        <div className="demo-kicker"><span className="demo-dot" />Live demo</div>
        <h2 id="demo-title">Welcome to Honey Hollow 🐝</h2>
        <p>This is a real OpenVorld vorld, running right in your browser. Walk around, click the crew, peek inside.</p>
        <p className="demo-secret">Psst… today is <b>Buzz’s birthday</b>, and Buzz has no idea.</p>
        <div className="demo-actions">
          <button className="btn primary big" onClick={start}>🎉 Plan the surprise</button>
          <button className="btn" onClick={() => { play('ui.click'); setPhase('idle'); }}>Look around first</button>
        </div>
      </section>
    </div>
  );

  if (phase === 'done' && ending) return (
    <div className="demo-veil">
      <section className="demo-card panel" role="dialog" aria-labelledby="demo-done">
        <div className="demo-kicker"><span className="demo-dot" />The surprise worked</div>
        <h2 id="demo-done">Happy birthday, Buzz! 🎂</h2>
        <p>Your crew read notes, browsed the web, wrote a poem, asked before saving, and built a real page. Together.</p>
        <p>In OpenVorld, they do this on <b>your own project</b>, with the AI you choose.</p>
        <div className="demo-actions">
          <a className="btn primary big" href={DOWNLOAD} target="_blank" rel="noopener noreferrer">Download OpenVorld</a>
          {EMBED ? <a className="btn" href="./" target="_top">See the invitation in the full demo ↗</a> : <button className="btn" onClick={again}>Play again</button>}
          <button className="link" onClick={() => setEnding(false)}>Stay in the vorld</button>
        </div>
        <p className="demo-fine">This demo is scripted and runs only in your browser.</p>
      </section>
    </div>
  );

  const tip: Record<string, React.ReactNode> = EMBED ? {
    idle: <><span>🐝 Walk around, click the crew.</span><button className="btn small primary" onClick={start}>Plan Buzz’s surprise</button></>,
    running: <><span className="demo-dot" /><span>The crew is planning. Watch them on the map!</span>{!partyOpen && <button className="btn small" onClick={openRoom}>Open the chat</button>}</>,
    writ: <><span>📜 <b>Jules needs your OK.</b> Press <b>Allow once</b> over Jules.</span></>,
    denied: <><span>No invitation this time. 🙂</span><button className="btn small primary" onClick={again}>Play again</button></>,
    done: <><span>🎂 Surprise!</span>{FULL}<a className="btn small primary" href={DOWNLOAD} target="_blank" rel="noopener noreferrer">Download</a></>,
  } : {
    idle: <><span>🐝 Demo vorld. Walk around, click the crew.</span><button className="btn small primary" onClick={start}>Plan Buzz’s surprise</button></>,
    running: <><span className="demo-dot" /><span>The crew is planning Buzz’s surprise. Watch the map and the chat!</span>{!partyOpen && <button className="btn small" onClick={openRoom}>Open the chat</button>}</>,
    writ: <><span>📜 <b>Jules needs your OK.</b> Press <b>Allow once</b> in the chat.</span>{!partyOpen && <button className="btn small primary" onClick={openRoom}>Show me</button>}</>,
    denied: <><span>No invitation this time. 🙂</span><button className="btn small primary" onClick={again}>Play again</button></>,
    done: <><span>🎂 Surprise! Open the invitation in the chat, or</span><a className="btn small primary" href={DOWNLOAD} target="_blank" rel="noopener noreferrer">Download OpenVorld</a><button className="btn small" onClick={again}>Play again</button></>,
  };
  return <div className={`demo-tip panel ${phase === 'writ' ? 'attention' : ''}`} role="status">{tip[phase]}</div>;
}
