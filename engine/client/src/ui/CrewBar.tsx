// Every crew member at a glance: portrait, working / waiting-for-you marks, and "+" to add an agent.
import { useState } from 'react';
import { api } from '../api';
import { emit, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';

export function CrewBar() {
  const world = useStore((s) => s.world);
  const talkingTo = useStore((s) => s.talkingTo);
  const live = useStore((s) => s.live);
  const quests = useStore((s) => s.quests);
  const [adding, setAdding] = useState(false);
  const working = new Set(Object.values(live).filter((l: any) => l.working).map((l: any) => l.role));
  const waiting = new Set(quests.filter((q) => q.status === 'waiting').map((q) => q.steps[q.run?.step]?.agent));
  return (
    <nav className="crew-bar panel" aria-label="Crew">
      {world.crew.map((c: any) => (
        <button key={c.id} className={`cb-item ${talkingTo === c.id ? 'on' : ''} ${working.has(c.id) ? 'working' : ''}`}
          title={`${c.name}${c.job ? ` · ${c.job}` : ''}`} onClick={() => { play('ui.open'); setState({ talkingTo: c.id }); }}>
          <Portrait role={c.id} size={32} />
          {waiting.has(c.id) && <span className="cb-mark">!</span>}
          {working.has(c.id) && <span className="cb-work">⚒</span>}
        </button>
      ))}
      <button className="cb-item cb-add" title="Add an agent" onClick={() => { play('ui.open'); setAdding(true); }}>+</button>
      {adding && <AddAgent onClose={() => setAdding(false)} />}
    </nav>
  );
}

function AddAgent({ onClose }: { onClose: () => void }) {
  const wid = useStore((s) => s.worldId)!;
  const [f, setF] = useState({ name: '', job: '', function: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { const w = await api(`/worlds/${wid}/crew`, { body: f }); setState({ world: w, talkingTo: w.added }); emit('world', w); play('seal.approved'); onClose(); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal panel add-agent" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <header className="row between"><h2>New agent</h2><button type="button" className="x" onClick={onClose}>✕</button></header>
        <p className="muted">An agent is a name, a job title and a job description. It uses your companion's brain until you pick another.</p>
        <label>Name<input className="field" autoFocus value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Job title<input className="field" value={f.job} maxLength={40} placeholder="e.g. Researcher" onChange={(e) => setF({ ...f, job: e.target.value })} /></label>
        <label>Job description<textarea className="field" rows={3} value={f.function} maxLength={400} placeholder="What they do for you" onChange={(e) => setF({ ...f, function: e.target.value })} /></label>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>Add to crew</button></div>
      </form>
    </div>
  );
}
