// Every crew member at a glance: portrait, working / waiting-for-you marks, and "+" to add an agent.
import { useState } from 'react';
import { api, artImage } from '../api';
import { emit, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { loadGenerated } from '../game/pixels';
import { Portrait } from './Portrait';
import { useBrainChoices } from './MemberSettings';
import { ModelPicker } from './ModelPicker';
import { FolderPicker, useFolderDialog } from './FolderPicker';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';

export function CrewBar() {
  const vorld = useStore((s) => s.vorld);
  const talkingTo = useStore((s) => s.talkingTo);
  const modal = useStore((s) => s.modal);
  const live = useStore((s) => s.live);
  const quests = useStore((s) => s.quests);
  const working = new Set(Object.values(live).filter((l: any) => l.working).map((l: any) => l.role));
  const waiting = new Set(quests.filter((q) => q.status === 'waiting').map((q) => q.steps[q.run?.step]?.agent));
  return (
    <>
      <nav className="crew-bar panel" aria-label="Crew">
        {vorld.crew.map((c: any) => (
          <button key={c.id} className={`cb-item ${talkingTo === c.id ? 'on' : ''} ${working.has(c.id) ? 'working' : ''}`}
            title={`${c.name}${c.job ? ` · ${c.job}` : ''}`} onClick={() => { play('ui.open'); setState({ talkingTo: c.id }); }}>
            <Portrait role={c.id} size={32} />
            {waiting.has(c.id) && <span className="cb-mark">!</span>}
            {working.has(c.id) && <span className="cb-work">⚒</span>}
          </button>
        ))}
        <button className="cb-item cb-add" title="Add an agent" onClick={() => { play('ui.open'); setState({ modal: 'add' }); }}>+</button>
      </nav>
      {modal === 'add' && <AddAgent onClose={() => setState({ modal: null })} />}
    </>
  );
}

function AddAgent({ onClose }: { onClose: () => void }) {
  const wid = useStore((s) => s.vorldId)!;
  const vorld = useStore((s) => s.vorld);
  const comp = vorld.crew.find((c: any) => c.role === 'companion');
  const [f, setF] = useState({
    name: '',
    job: '',
    function: '',
    brain: { provider: comp?.brain?.provider ?? 'none', name: comp?.brain?.name, model: comp?.brain?.model ?? '' },
  });
  const [folder, setFolder] = useState('');
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const { native, choose } = useFolderDialog('fs.write');
  const { opts, choices, label } = useBrainChoices(wid);
  const brainValue = `${f.brain.provider}${f.brain.name ? '#' + f.brain.name : ''}`;
  if (opts && !choices.some((p) => p.value === brainValue)) choices.push({ value: brainValue, label: `${label(f.brain.provider)} (not found here)` });
  const defaultWs = `${vorld.benches?.base ?? ''}/${slug(f.name)}`;
  const ws = folder.trim() || defaultWs;
  const pickFolder = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(folder.trim() || vorld.benches?.base); if (p) setFolder(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const add = async () => {
    setBusy(true);
    try {
      const trimmedFolder = folder.trim();
      const w = await api(`/vorlds/${wid}/crew`, { body: { ...f, ...(trimmedFolder ? { bench: trimmedFolder } : {}) } });
      await loadGenerated(w.art.atlas, (name) => artImage(name));
      setState({ vorld: w, talkingTo: w.added, modal: null });
      emit('vorld', w);
      play('seal.approved');
    }
    catch (e: any) { toast({ kind: 'error', title: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal panel add-agent" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <header className="row between"><h2>New agent</h2><button type="button" className="x" onClick={onClose}>✕</button></header>
        <p className="muted">An agent is a name, a job title and a job description. It uses your companion's brain and Main bench unless you pick another folder.</p>
        <label>Name<input className="field" autoFocus value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Job title<input className="field" value={f.job} maxLength={40} placeholder="e.g. Researcher" onChange={(e) => setF({ ...f, job: e.target.value })} /></label>
        <label>Job description<textarea className="field" rows={3} value={f.function} maxLength={400} placeholder="What they do for you" onChange={(e) => setF({ ...f, function: e.target.value })} /></label>
        <div className="row">
          <label className="grow">Brain<select className="field" value={brainValue} onChange={(e) => { const [provider, name] = e.target.value.split('#'); setF({ ...f, brain: { provider, name: name || undefined, model: '' } }); }}>
            {choices.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <label className="grow">Model<ModelPicker wid={wid} provider={f.brain.provider} name={f.brain.name} tier="balanced" value={f.brain.model || undefined} onChange={(model) => setF({ ...f, brain: { ...f.brain, model: model ?? '' } })} /></label>
        </div>
        <section className="project-folder">
          <b>Main workbench</b>
          <div className="pf-row">
            <code className="pf-path" title={ws}>{tail(ws)}</code>
            <button type="button" className="btn small" onClick={pickFolder}>Change</button>
            {folder && <button type="button" className="btn small" onClick={() => { setFolder(''); setTyping(false); }}>Use the default</button>}
          </div>
          {typing && <FolderPicker label="Folder" value={folder} onChange={setFolder} capability="fs.write" />}
          <p className="muted small">Can read and change files here, and read the project folder. Anything else needs a writ you approve.</p>
        </section>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()}>Add to crew</button></div>
      </form>
    </div>
  );
}
