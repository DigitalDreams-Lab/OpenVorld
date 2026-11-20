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
  const { native, choose, choosing } = useFolderDialog('fs.write');
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
    const start = adding?.path || c?.benches?.[0]?.path;
    try { const p = await choose(start); if (p) setAdding((a) => ({ name: a?.name ?? '', path: p })); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const add = () => run(async () => {
    const w = await api(`/vorlds/${wid}/crew/${id}/benches`, { body: { name: adding!.name, path: adding!.path } });
    setAdding(null); setTyping(null); return w;
  });
  const benches: any[] = c.benches ?? [];
  const home = benches.find((b) => b.id === 'main'), others = benches.filter((b) => b.id !== 'main'), start = benches.find((b) => b.default);
  const put = (bid: string, body: any) => run(() => api(`/vorlds/${wid}/crew/${id}/benches/${bid}`, { method: 'PUT', body }));
  return (
    <section className="project-folder workbenches">
      <h3 className="section-title">Workbenches</h3>
      <p className="muted section-note">
        The folders {c.name} works in: they can read and change files on a workbench, and read the project folder; anything else needs a writ.
        {home && <> {c.name} always has a home workbench{home.chosen ? '' : ' of their own'}, <code title={home.path}>{tail(home.path)}</code> (<button className="link-btn" disabled={choosing} onClick={() => move(home)}>change folder</button>{home.chosen && <>, <button className="link-btn" onClick={() => put('main', { path: null })}>use the default place</button></>}).</>}
        {' '}Every chat starts on {start && start.id !== 'main' ? <><b dir="auto">{start.name}</b> (<button className="link-btn" onClick={() => put('main', { default: true })}>start at home instead</button>)</> : 'the home workbench'} and stays there.
      </p>
      {home && typing === home.id && <TypedFolder initial={home.path} onUse={(p) => { setTyping(null); void put('main', { path: p }); }} onCancel={() => setTyping(null)} />}
      {others.map((b: any) => (
        <div key={b.id} className="bench">
          <div className="bench-head">
            <b className="bench-name" dir="auto">{b.name}</b>
            {b.default && <span className="chip">default</span>}
          </div>
          <code className="pf-path" title={b.path}>{tail(b.path)}</code>
          <div className="row bench-actions">
            <button className="btn small" disabled={choosing} onClick={() => move(b)}>Change folder</button>
            {!b.default && <button className="btn small" onClick={() => put(b.id, { default: true })}>Make default</button>}
            <button className="btn small" onClick={() => run(() => api(`/vorlds/${wid}/crew/${id}/benches/${b.id}`, { method: 'DELETE' }))}>Remove</button>
          </div>
          {typing === b.id && <TypedFolder initial={b.path} onUse={(p) => { setTyping(null); void put(b.id, { path: p }); }} onCancel={() => setTyping(null)} />}
        </div>
      ))}
      {!adding && typing !== '+' && <button className="btn small" onClick={() => setAdding({ name: '', path: '' })}>+ Add a workbench</button>}
      {(adding || typing === '+') && (
        <div className="bench">
          <input className="field" dir="auto" placeholder="Name, e.g. Website" maxLength={40} value={adding?.name ?? ''} onChange={(e) => setAdding({ name: e.target.value, path: adding?.path ?? '' })} />
          <div className="pf-row">
            <code className="pf-path">{adding?.path ? tail(adding.path) : 'no folder yet'}</code>
            <button className="btn small" disabled={choosing} onClick={pickNew}>Pick folder</button>
          </div>
          {typing === '+' && <FolderPicker label="Folder" value={adding?.path ?? ''} onChange={(p) => setAdding({ name: adding?.name ?? '', path: p })} capability="fs.write" />}
          <div className="row"><button className="btn small primary" disabled={!adding?.path} onClick={add}>Add</button><button className="btn small" onClick={() => { setAdding(null); setTyping(null); }}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

export function TypedFolder({ initial, onUse, onCancel }: { initial: string; onUse: (p: string) => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  return (
    <>
      <FolderPicker label="Folder" value={p} onChange={setP} capability="fs.write" />
      <div className="row"><button className="btn small primary" disabled={!p.trim()} onClick={() => onUse(p.trim())}>Use this folder</button><button className="btn small" onClick={onCancel}>Cancel</button></div>
    </>
  );
}
