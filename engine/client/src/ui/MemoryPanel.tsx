// What a crew member remembers between chats (engine/server/memory.mjs): their notebook and the summaries of their chats.
// The member writes it themselves; here the founder reads it, corrects a note, and removes notes or chat summaries.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, toast, useStore } from '../store';

export function MemoryPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const c = memberOf(id);
  const base = `/vorlds/${wid}/crew/${id}/memory`;
  const [m, setM] = useState<any>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => { api(base).then(setM).catch(() => {}); }, [base]);
  const run = async (path: string, init: any) => { try { const r = await api(`${base}${path}`, init); setM((x: any) => ({ ...x, ...r })); return true; } catch (e: any) { toast({ kind: 'error', title: e.message }); return false; } };
  const saveEdit = async () => { if (editing && await run(`/notes/${editing.id}`, { method: 'PUT', body: { text: editing.text } })) setEditing(null); };
  if (!m) return null;
  return (
    <section className="project-folder memory">
      <h3 className="section-title">Memory</h3>
      <p className="muted small">What {c.name} keeps between chats, in their house on this computer. They add to it themselves; you can correct or remove anything.</p>
      {m.notes.length === 0 && m.chats.length === 0 && <p className="muted small">Nothing remembered yet.</p>}
      {m.notes.map((n: any) => editing && editing.id === n.id
        ? <div key={n.id} className="pf-row"><input className="field grow" dir="auto" value={editing.text} maxLength={300} autoFocus onChange={(e) => setEditing({ id: n.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null); }} /><button className="btn small primary" onClick={saveEdit}>Save</button></div>
        : <div key={n.id} className="pf-row"><span className="pf-path note" dir="auto" title={n.text}>📝 {n.text}</span><button className="btn small" onClick={() => setEditing({ id: n.id, text: n.text })}>Edit</button><button className="btn small" onClick={() => run(`/notes/${n.id}`, { method: 'DELETE' })}>Remove</button></div>)}
      {m.chats.length > 0 && <div className="small muted">Chat summaries</div>}
      {m.chats.map((s: any) => (
        <div key={s.chat} className="pf-row"><span className="pf-path" title={s.summary}>💬 <b dir="auto">{s.title ?? 'Chat'}</b> <bdi>{s.summary}</bdi></span><button className="btn small" title="Remove this summary. The chat itself stays." onClick={() => run(`/chats/${s.chat}`, { method: 'DELETE' })}>Remove</button></div>
      ))}
    </section>
  );
}
