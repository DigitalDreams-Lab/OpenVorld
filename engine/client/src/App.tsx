import { useEffect, useState } from 'react';
import { api } from './api';
import { setState } from './store';
import { Title } from './screens/Title';
import { Onboarding } from './screens/Onboarding';
import { Game } from './screens/Game';

type Screen = { name: 'title' } | { name: 'onboarding' } | { name: 'game'; vorld: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  const [boot, setBoot] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api('/boot').then(setBoot).catch((e) => setError(e.message)); }, [screen.name]);

  const open = (id: string) => {
    try { localStorage.setItem('ov.lastVorld', id); } catch { /* storage unavailable */ }
    setState({ vorldId: id, quests: [] }); setScreen({ name: 'game', vorld: id });
  };
  // reopen the last vorld after a reload (per-browser convenience only)
  useEffect(() => {
    if (!boot || screen.name !== 'title') return;
    let last: string | null = null;
    try { last = localStorage.getItem('ov.lastVorld'); if (sessionStorage.getItem('ov.atTitle')) last = null; } catch { /* ignore */ }
    if (last && boot.vorlds.some((w: any) => w.id === last)) open(last);
  }, [boot]);

  if (error) return <div className="fatal">Cannot reach the openVorld server: {error}</div>;
  if (!boot) return <div className="fatal">Loading…</div>;
  if (screen.name === 'onboarding') return <Onboarding boot={boot} onDone={open} onCancel={() => setScreen({ name: 'title' })} />;
  if (screen.name === 'game') return <Game wid={screen.vorld} onExit={() => { try { sessionStorage.setItem('ov.atTitle', '1'); } catch { /* ignore */ } setScreen({ name: 'title' }); }} />;
  return <Title vorlds={boot.vorlds} version={boot.version} onOpen={open} onNew={() => setScreen({ name: 'onboarding' })} />;
}
