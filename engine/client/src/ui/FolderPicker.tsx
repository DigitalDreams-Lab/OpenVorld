// Choosing a folder for a writ: the computer's own folder dialog (Finder, Explorer, the Linux file manager).
// Only when the computer has none do we fall back to a typed path and a small folder list (names only).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { str, useStore } from '../store';

type Listing = { path: string; parent: string | null; roots: { name: string; path: string }[]; entries: { name: string; path: string; ok: boolean }[]; ok: boolean; error: string | null };
const cache = new Map<string, string | null>();

/** The system folder dialog: `native` is its name ("Finder", "Explorer", …) or null when there is none. */
export function useFolderDialog(capability = 'fs.write') {
  const wid = useStore((s) => s.worldId);
  const [native, setNative] = useState<string | null | undefined>(wid ? cache.get(wid) : null);
  useEffect(() => {
    if (!wid || cache.has(wid)) return;
    api(`/worlds/${wid}/fs/native`).then((r) => { cache.set(wid, r.native ?? null); setNative(r.native ?? null); }).catch(() => setNative(null));
  }, [wid]);
  /** Opens the dialog; resolves the chosen folder, or null when cancelled. Rejects with a readable error. */
  const choose = async (start?: string): Promise<string | null> => {
    const r = await api(`/worlds/${wid}/fs/pick`, { body: { capability, start: start || undefined, prompt: str('folder.prompt', {}, 'Choose a folder') } });
    return r.path ?? null;
  };
  return { native, choose };
}

const shorten = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p; };

export function FolderPicker({ value, onChange, capability = 'fs.write', placeholder, disabled, label }: { value: string; onChange: (path: string) => void; capability?: string; placeholder?: string; disabled?: boolean; label?: string }) {
  const wid = useStore((s) => s.worldId);
  const { native, choose } = useFolderDialog(capability);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState('');

  const go = async (dir: string) => {
    setError('');
    try { setList(await api(`/worlds/${wid}/fs/browse?capability=${capability}&path=${encodeURIComponent(dir)}`)); }
    catch (e: any) { setError(e.message); }
  };
  useEffect(() => { if (open && !list) void go(value); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const system = async () => {
    setError('');
    try { const p = await choose(value); if (p) onChange(p); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="folder-picker">
      <div className="row">
        <input className="field" aria-label={label ?? 'Folder'} placeholder={placeholder ?? '/path/to/your/project'} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {native
          ? <button type="button" className="btn small" disabled={disabled} onClick={system}>{str('folder.system', { app: native }, `Choose in ${native}…`)}</button>
          : native === null && <button type="button" className="btn small" disabled={disabled} onClick={() => setOpen(!open)}>{open ? str('folder.close', {}, 'Close') : str('folder.browse', {}, 'Browse…')}</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {open && !native && (
        <div className="fp-box">
          <div className="fp-roots">{list?.roots.map((r) => <button type="button" key={r.path} className={`chip ${list.path === r.path ? 'on' : ''}`} onClick={() => go(r.path)}>{r.name}</button>)}</div>
          <div className="fp-bar">
            <button type="button" className="btn small" disabled={!list?.parent} onClick={() => list?.parent && go(list.parent)} title="Up one folder">↑</button>
            <code className="fp-path" title={list?.path}>{list ? shorten(list.path) : '…'}</code>
            <button type="button" className="btn primary small" disabled={!list?.ok} onClick={() => { if (list) { onChange(list.path); setOpen(false); } }}>{str('folder.use', {}, 'Use this folder')}</button>
          </div>
          <ul className="fp-list" role="listbox" aria-label="Folders">
            {list?.error && <li className="fp-note">{list.error}</li>}
            {list?.entries.map((e) => (
              <li key={e.path}><button type="button" className="fp-item" onClick={() => go(e.path)}><span aria-hidden>▸</span><span className="fp-name">{e.name}</span>{!e.ok && <span className="fp-lock" title={str('folder.locked', {}, 'Can never be shared with a crew member')}>🔒</span>}</button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
