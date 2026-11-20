// Under the message box of a chat: the folder this chat works in. The agent's own workbench is always there and is not a choice:
// "None" means that chat is connected to no outside folder. On a new chat the folder can be changed, or a new one added to the
// agent's folders (the same list as its settings); once the chat has begun it stays (the member can still use all its folders,
// this is only where the chat starts and puts new files).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { emit, memberOf, setState, toast, useStore } from '../store';
import { useFolderDialog } from './FolderPicker';
import { TypedFolder } from './Workbenches';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };
const ADD = '__add';

export function BenchLine({ wid, thread, begun }: { wid: string; thread: any; begun: boolean }) {
  useStore((s) => s.vorld);
  const { native, choose } = useFolderDialog('fs.write');
  const benches: any[] = memberOf(thread.role)?.benches ?? [];
  const external = benches.filter((b) => b.id !== 'main');
  const [value, setValue] = useState<string>(thread.bench);
  const [typing, setTyping] = useState(false);
  useEffect(() => setValue(thread.bench), [thread.bench]);
  const current = benches.find((b) => b.id === value);
  if (!current) return null;
  const change = async (bench: string) => {
    const before = value; setValue(bench);
    try { await api(`/vorlds/${wid}/threads/${thread.id}`, { method: 'PUT', body: { bench } }); }
    catch (e: any) { setValue(before); toast({ kind: 'error', title: e.message }); }
  };
  /** A folder added here joins the agent's folders (as in its settings) and this chat starts on it. */
  const addFolder = async (path: string) => {
    try {
      const w = await api(`/vorlds/${wid}/crew/${thread.role}/benches`, { body: { name: '', path } });
      setState({ vorld: w }); emit('vorld', w); setTyping(false);
      await change(w.added);
    } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const pick = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(external[0]?.path); if (p) await addFolder(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const label = (b: any) => (b.id === 'main' ? 'None' : b.name);
  return (
    <>
      <div className="bench-line">
        <span className="muted">Workbench</span>
        {!begun
          ? <select className="field small" aria-label="Folder of this chat" value={value} onChange={(e) => { if (e.target.value === ADD) void pick(); else void change(e.target.value); }}>
              <option value="main">None</option>
              {external.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value={ADD}>+ Add folder…</option>
            </select>
          : <b title={current.path}>{label(current)}</b>}
        {current.id === 'main' ? <span className="muted">its own workbench only</span> : <code className="pf-path" title={current.path}>{tail(current.path)}</code>}
      </div>
      {typing && <div className="bench-add"><TypedFolder initial="" onUse={(p) => void addFolder(p)} onCancel={() => setTyping(false)} /></div>}
    </>
  );
}
