// Messages the founder wrote while a member was busy, waiting above the composer. Each can be edited, deleted or sent now
// (which stops the running turn and runs that message next). They run one after another when the member is idle.
import { useRef, useState } from 'react';
import { api } from '../api';
import { setState, toast } from '../store';
import { fileSize, type Attachment } from './MessageFiles';

export type QueuedMessage = { id: string; text: string; files?: Attachment[]; now?: boolean };

export function QueuedMessages({ wid, tid, items, paused }: { wid: string; tid: string; items: QueuedMessage[]; paused: boolean }) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = useRef<HTMLTextAreaElement>(null);
  if (!items.length) return null;
  const base = `/vorlds/${wid}/threads/${tid}/queue`;
  const act = async (call: () => Promise<unknown>) => {
    setBusy(true);
    try { await call(); setState((s) => ({ threadsVersion: s.threadsVersion + 1 })); return true; }
    catch (e: any) { toast({ kind: 'error', title: e.message }); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!editing) return;
    if (await act(() => api(`${base}/${editing.id}`, { method: 'PUT', body: { text: editing.text } }))) setEditing(null);
  };
  return <div className="queued" role="region" aria-label="Queued messages">
    <div className="queued-head">
      <b>{paused ? 'Queued · paused because you stopped it' : `Queued (${items.length}) · sent one after another`}</b>
      {paused && <button type="button" className="btn small primary" disabled={busy} onClick={() => void act(() => api(`${base}/resume`, { body: {} }))}>Resume</button>}
    </div>
    <ol className="queued-list">
      {items.map((m, i) => {
        const open = editing?.id === m.id, label = `queued message ${i + 1}`;
        return <li key={m.id} className={`queued-item${m.now ? ' next' : ''}`}>
          {open ? <>
            <textarea ref={edit} dir="auto" autoFocus className="queued-edit" aria-label={`Edit ${label}`} rows={2} value={editing.text} disabled={busy} onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
              }} />
            <span className="queued-actions">
              <button type="button" className="btn small primary" disabled={busy || (!editing.text.trim() && !m.files?.length)} onClick={() => void save()}>Save</button>
              <button type="button" className="btn small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </span>
          </> : <>
            <span className="queued-text" dir="auto">
              {m.text || '(files only)'}
              {!!m.files?.length && <small>{m.files.map((f) => `${f.name} (${fileSize(f.size)})`).join(', ')}</small>}
            </span>
            <span className="queued-actions">
              <button type="button" className="btn small" disabled={busy} aria-label={`Send now: stop the current reply and send ${label}`} title="Send now: stops the current reply and sends this next" onClick={() => void act(() => api(`${base}/${m.id}/send`, { body: {} }))}>Send now</button>
              <button type="button" className="btn small" disabled={busy} aria-label={`Edit ${label}`} title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })}>Edit</button>
              <button type="button" className="btn small" disabled={busy} aria-label={`Delete ${label}`} title="Delete" onClick={() => void act(() => api(`${base}/${m.id}`, { method: 'DELETE' }))}>Delete</button>
            </span>
          </>}
        </li>;
      })}
    </ol>
  </div>;
}
