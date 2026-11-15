// The workbenches of one crew member: the folders they work in. One is the default; every chat starts on one of them.
// Changes apply at once (they are not part of the Save button of the member settings).
import { useState } from 'react';
import { api } from '../api';
import { emit, memberOf, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { FolderPicker, useFolderDialog } from './FolderPicker';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };

export function Workbenches({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  useStore((s) => s.vorld);
  const c = memberOf(id);
  const { native, choose } = useFolderDialog('fs.write');
  const [adding, setAdding] = useState<{ name: string; path: string } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);   // bench id whose folder is typed by hand ('+' = the new one)
  const apply = (w: any) => { setState({ vorld: w }); emit('vorld', w); };
  const run = async (fn: () => Promise<any>) => { try { apply(await fn()); play('ui.click'); } catch (e: any) { toast({ kind: 'error', title: e.message }); } };
  const move = async (b: any) => {
    if (!native) { setTyping(typing === b.id ? null : b.id); return; }
    try { const p = await choose(b.path); if (p) await run(() => api(`/vorlds/${wid}/crew/${id}/benches/${b.id}`, { method: 'PUT', body: { path: p } })); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const pickNew = async () => {
    if (!native) { setTyping('+'); return; }
    try { const p = await choose(); if (p) setAdding((a) => ({ name: a?.name ?? '', path: p })); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const add = () => run(async () => {
    const w = await api(`/vorlds/${wid}/crew/${id}/benches`, { body: { name: adding!.name, path: adding!.path } });
    setAdding(null); setTyping(null); return w;
  });
  return (
    <section className="project-folder workbenches">
      <b>Workbenches</b>
      <p className="muted small">The folders {c.name} works in. Each chat starts on one and stays there. {c.name} can read and change files on a workbench, and read the project folder; anything else needs a writ.</p>
      {c.benches.map((b: any) => (
        <div key={b.id} className="bench">
          <div className="pf-row">
            <b className="bench-name">{b.name}</b>
            {b.default && <span className="chip">default</span>}
            <code className="pf-path" title={b.path}>{tail(b.path)}</code>
          </div>
          <div className="row">
            <button className="btn small" onClick={() => move(b)}>Change folder</button>
            {b.id === 'main' && b.chosen && <button className="btn small" onClick={() => run(() => api(`/vorlds/${wid}/crew/${id}/benches/main`, { method: 'PUT', body: { path: null } }))}>Use the default place</button>}
            {!b.default && <button className="btn small" onClick={() => run(() => api(`/vorlds/${wid}/crew/${id}/benches/${b.id}`, { method: 'PUT', body: { default: true } }))}>Make default</button>}
            {b.id !== 'main' && <button className="btn small" onClick={() => run(() => api(`/vorlds/${wid}/crew/${id}/benches/${b.id}`, { method: 'DELETE' }))}>Remove</button>}
          </div>
          {typing === b.id && <TypedFolder initial={b.path} onUse={(p) => { setTyping(null); void run(() => api(`/vorlds/${wid}/crew/${id}/benches/${b.id}`, { method: 'PUT', body: { path: p } })); }} onCancel={() => setTyping(null)} />}
        </div>
      ))}
      {!adding && typing !== '+' && <button className="btn small" onClick={() => setAdding({ name: '', path: '' })}>+ Add a workbench</button>}
      {(adding || typing === '+') && (
        <div className="bench">
          <input className="field" placeholder="Name, e.g. Website" maxLength={40} value={adding?.name ?? ''} onChange={(e) => setAdding({ name: e.target.value, path: adding?.path ?? '' })} />
          <div className="pf-row">
            <code className="pf-path">{adding?.path ? tail(adding.path) : 'no folder yet'}</code>
            <button className="btn small" onClick={pickNew}>Pick folder</button>
          </div>
          {typing === '+' && <FolderPicker label="Folder" value={adding?.path ?? ''} onChange={(p) => setAdding({ name: adding?.name ?? '', path: p })} capability="fs.write" />}
          <div className="row"><button className="btn small primary" disabled={!adding?.path} onClick={add}>Add</button><button className="btn small" onClick={() => { setAdding(null); setTyping(null); }}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

function TypedFolder({ initial, onUse, onCancel }: { initial: string; onUse: (p: string) => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  return (
    <>
      <FolderPicker label="Folder" value={p} onChange={setP} capability="fs.write" />
      <div className="row"><button className="btn small primary" disabled={!p.trim()} onClick={() => onUse(p.trim())}>Use this folder</button><button className="btn small" onClick={onCancel}>Cancel</button></div>
    </>
  );
}
