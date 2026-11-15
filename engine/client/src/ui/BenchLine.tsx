// Under the message box of a chat: the workbench this chat is working on. On a new chat it can be changed; once the chat has
// begun it stays (the member can still use all its workbenches, this is only where the chat starts and puts new files).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, toast, useStore } from '../store';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };

export function BenchLine({ wid, thread, begun }: { wid: string; thread: any; begun: boolean }) {
  useStore((s) => s.vorld);
  const benches: any[] = memberOf(thread.role)?.benches ?? [];
  const [value, setValue] = useState<string>(thread.bench);
  useEffect(() => setValue(thread.bench), [thread.bench]);
  const current = benches.find((b) => b.id === value);
  if (!current) return null;
  const change = async (bench: string) => {
    const before = value; setValue(bench);
    try { await api(`/vorlds/${wid}/threads/${thread.id}`, { method: 'PUT', body: { bench } }); }
    catch (e: any) { setValue(before); toast({ kind: 'error', title: e.message }); }
  };
  return (
    <div className="bench-line">
      <span className="muted">Workbench</span>
      {!begun && benches.length > 1
        ? <select className="field small" aria-label="Workbench of this chat" value={value} onChange={(e) => void change(e.target.value)}>{benches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        : <b title={current.path}>{current.name}</b>}
      <code className="pf-path" title={current.path}>{tail(current.path)}</code>
    </div>
  );
}
