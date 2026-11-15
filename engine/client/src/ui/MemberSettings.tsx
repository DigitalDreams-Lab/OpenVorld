// Settings of one crew member: name, job title, job description, personality, the brain they think with and the
// folder they work in.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { emit, memberOf, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { useConfirm } from './ConfirmDialog';
import { ModelPicker } from './ModelPicker';
import { FolderPicker, useFolderDialog } from './FolderPicker';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };

/** The brains this world can use: detected CLIs plus the API endpoints set up in Settings. */
export function useBrainChoices(wid: string) {
  const [opts, setOpts] = useState<any>(null);
  useEffect(() => { api(`/worlds/${wid}/settings`).then(setOpts).catch(() => {}); }, [wid]);
  const label = (id: string) => opts?.catalog.find((x: any) => x.id === id)?.label ?? id;
  const choices = opts ? [{ value: 'none', label: 'No brain yet' },
    ...opts.detected.map((d: any) => ({ value: d.id, label: d.label })),
    ...opts.providers.map((p: any) => ({ value: `${p.id}#${p.name ?? ''}`, label: `${label(p.id)}${p.name ? ' · ' + p.name : ''}` }))] : [];
  return { opts, choices, label };
}

export function MemberSettings({ id }: { id: string }) {
  const wid = useStore((s) => s.worldId)!;
  useStore((s) => s.world);
  const c = memberOf(id);
  const [f, setF] = useState<any>(() => ({ name: c.name, job: c.job ?? '', function: c.function ?? '', personality: c.personality ?? '', form: c.look?.form ?? 'creature', brain: { provider: c.brain?.provider ?? 'none', name: c.brain?.name, model: c.brain?.model ?? '' } }));
  const [folder, setFolder] = useState<string | null>(null);         // null = unchanged
  const [typing, setTyping] = useState(false);
  const { native, choose } = useFolderDialog('fs.write');
  const { opts, choices, label } = useBrainChoices(wid);
  const [confirm, dialog] = useConfirm();
  const close = () => setState({ modal: null });
  const brainValue = `${f.brain.provider}${f.brain.name ? '#' + f.brain.name : ''}`;
  if (opts && !choices.some((p) => p.value === brainValue)) choices.push({ value: brainValue, label: `${label(f.brain.provider)} (not found here)` });
  const save = async () => {
    try {
      const w = await api(`/worlds/${wid}/crew/${id}`, { method: 'PUT', body: { ...f, ...(folder !== null ? { workspace: folder } : {}) } });
      setState({ world: w, modal: null }); emit('world', w); play('seal.approved');
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${c.name}?`, body: `${c.name} leaves the crew and loses every writ you granted. Their folder stays on your disk.`, ok: 'Remove', danger: true }))) return;
    try { const w = await api(`/worlds/${wid}/crew/${id}`, { method: 'DELETE' }); setState({ world: w, modal: null, talkingTo: null }); emit('world', w); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const pickFolder = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(c.workspace.path); if (p) setFolder(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const ws = folder ?? c.workspace.path;
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal panel member-settings" onClick={(e) => e.stopPropagation()}>
        <header className="row between"><h2>{f.name} <small>{c.role === 'companion' ? 'companion' : 'agent'}</small></h2><button className="x" onClick={close}>✕</button></header>
        <div className="cs-grid">
          <div className="cs-preview"><Portrait role={id} size={96} /></div>
          <div className="cs-fields">
            <label>Name<input className="field" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label>Job title<input className="field" value={f.job} maxLength={40} placeholder="e.g. Writer" onChange={(e) => setF({ ...f, job: e.target.value })} /></label>
            {c.role === 'agent' && <label>Job description<textarea className="field" rows={3} value={f.function} maxLength={400} placeholder="What they do for you" onChange={(e) => setF({ ...f, function: e.target.value })} /></label>}
            <label>Personality<input className="field" value={f.personality} maxLength={200} placeholder="How they speak (optional)" onChange={(e) => setF({ ...f, personality: e.target.value })} /></label>
            {c.role === 'companion' && <label>Looks like<select className="field" value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })}><option value="creature">a creature</option><option value="robot">a robot</option><option value="person">a person</option></select></label>}
            <div className="row">
              <label className="grow">Brain<select className="field" value={brainValue} onChange={(e) => { const [provider, name] = e.target.value.split('#'); setF({ ...f, brain: { provider, name: name || undefined, model: '' } }); }}>
                {choices.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
              <label className="grow">Model<ModelPicker wid={wid} provider={f.brain.provider} name={f.brain.name} tier="balanced" value={f.brain.model || undefined} onChange={(model) => setF({ ...f, brain: { ...f.brain, model: model ?? '' } })} /></label>
            </div>
            <section className="project-folder">
              <b>Works in</b>
              <div className="pf-row">
                <code className="pf-path" title={ws}>{tail(ws)}</code>
                <button className="btn small" onClick={pickFolder}>Change</button>
                {(c.workspace.source === 'own' || folder) && <button className="btn small" onClick={() => { setFolder(''); setTyping(false); }}>Use the default</button>}
              </div>
              {typing && <FolderPicker label="Folder" value={folder ?? ''} onChange={setFolder} capability="fs.write" />}
              <p className="muted small">{c.name} can read and change files in this folder. Anything else needs a writ you approve.</p>
            </section>
          </div>
        </div>
        <div className="row between">
          {c.role === 'agent' ? <button className="btn danger" onClick={remove}>Remove from crew</button> : <span />}
          <span className="row"><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></span>
        </div>
        {dialog}
      </div>
    </div>
  );
}
