// Vorld settings: name and purpose, model endpoints (OpenAI-compatible; the key is read from an environment variable
// you name, never stored), the project folder, the private workspaces folder, the writs you granted, and sound.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { emit, on, setState, toast, useStore } from '../store';
import { play, setSfxVolume } from '../audio/sfx';
import { WritsList } from './WritsList';
import { FolderPicker, useFolderDialog } from './FolderPicker';

const tail = (p: string) => { const parts = p.split('/').filter(Boolean); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p; };
const close = () => setState({ modal: null });

export function Settings() {
  const wid = useStore((s) => s.vorldId)!;
  const vorld = useStore((s) => s.vorld);
  const [s, setS] = useState<any>(null);
  const [w, setW] = useState({ name: vorld.vorld.name, about: vorld.vorld.about });
  useEffect(() => { api(`/vorlds/${wid}/settings`).then(setS).catch((e) => toast({ kind: 'error', title: e.message })); }, [wid]);
  if (!s) return null;
  const endpoints: any[] = s.providers.filter((p: any) => p.id === 'openai-compatible');
  const presets = s.catalog.find((c: any) => c.id === 'openai-compatible')?.presets ?? {};
  const setEndpoint = (p: any, patch: any) => setS((x: any) => ({ ...x, providers: x.providers.map((q: any) => (q === p ? { ...q, ...patch } : q)) }));
  const addEndpoint = (name: string) => {
    const p = presets[name] ?? {};
    let n = name, k = 1; while (s.providers.some((q: any) => q.name === n)) n = `${name}-${++k}`;
    setS((x: any) => ({ ...x, providers: [...x.providers, { id: 'openai-compatible', name: n, base_url: p.base_url ?? '', api: p.api, api_key_env: p.api_key === null ? '' : `${name.toUpperCase().replace(/-/g, '_')}_API_KEY` }] }));
  };
  const save = async () => {
    try {
      await api(`/vorlds/${wid}/settings`, { method: 'PUT', body: { providers: s.providers } });
      const next = await api(`/vorlds/${wid}`, { method: 'PUT', body: w });
      setState({ vorld: next, modal: null }); emit('vorld', next); play('seal.approved');
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); }
  };
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal panel settings" onClick={(e) => e.stopPropagation()}>
        <header className="row between"><h2>Settings</h2><button className="x" onClick={close}>✕</button></header>
        <h3>Vorld</h3>
        <label>Name<input className="field" value={w.name} maxLength={60} onChange={(e) => setW({ ...w, name: e.target.value })} /></label>
        <label>What it is for<textarea className="field" rows={2} value={w.about} maxLength={400} placeholder="The project, company or activity this vorld runs. Every crew member reads this." onChange={(e) => setW({ ...w, about: e.target.value })} /></label>

        <h3>Brains</h3>
        <p className="muted">Found on this computer: {s.detected.map((d: any) => d.label).join(', ') || 'no agent CLI'} <button className="link" onClick={async () => { const d = await api('/detect', { body: {} }).catch(() => null); if (d) setS({ ...s, detected: d }); }}>look again</button>. Pick each member's brain in their settings (⚙).</p>
        <h4>Model endpoints (OpenAI-compatible)</h4>
        {endpoints.map((p, i) => (
          <div key={i} className="endpoint endpoint-row">
            <b>{p.name}</b>
            <input className="field" placeholder="base URL" value={p.base_url ?? ''} onChange={(e) => setEndpoint(p, { base_url: e.target.value })} />
            <input className="field" placeholder="API key env var (blank for local)" value={p.api_key_env ?? ''} onChange={(e) => setEndpoint(p, { api_key_env: e.target.value })} />
            <button className="btn small" onClick={() => setS((x: any) => ({ ...x, providers: x.providers.filter((q: any) => q !== p) }))}>Remove</button>
          </div>
        ))}
        <div className="row wrap">{Object.keys(presets).map((p) => <button key={p} className="btn small" onClick={() => addEndpoint(p)}>+ {p}</button>)}</div>
        <p className="muted small">Keys are never saved: set the environment variable before starting OpenVorld.</p>

        <ProjectFolder />
        <SignedIn />
        <DefaultFolder />
        <WritsList />
        <h3>Sound</h3>
        <label className="form-row"><span>Effects</span><input type="range" min={0} max={1} step={0.05} defaultValue={0.8} onChange={(e) => { setSfxVolume(Number(e.target.value)); play('ui.click'); }} /></label>
        <p className="muted small">Saved on this computer in <code>{s.storage.vorld}</code></p>
        <div className="row end"><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

/** The vorld's project folder: shared by the whole crew (read for everyone, writes by writ). */
function ProjectFolder() {
  const wid = useStore((s) => s.vorldId)!;
  const project = useStore((s) => s.vorld)?.vorld?.project;
  const { native, choose } = useFolderDialog('fs.write');
  const [folder, setFolder] = useState(project?.path ?? '');
  const [typing, setTyping] = useState(false);
  const save = async (p: string | null) => {
    try { const w = await api(`/vorlds/${wid}`, { method: 'PUT', body: { project: p } }); setState({ vorld: w }); emit('vorld', w); setTyping(false); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const change = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(project?.path); if (p) await save(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  if (!project) return null;
  return (
    <>
      <h3>Project folder</h3>
      <p className="muted">The one folder the whole crew works on. Everyone can read it; changing files in it needs your writ.</p>
      {!typing ? (
        <div className="pf-row">
          <code className="pf-path" title={project.path}>{tail(project.path)}</code>
          {!project.exists && <span className="error small">missing</span>}
          <button className="btn small" onClick={change}>Change</button>
          {project.chosen && <button className="btn small" onClick={() => save(null)}>Back to the vorld's own folder</button>}
        </div>
      ) : (
        <>
          <FolderPicker label="Project folder" value={folder} onChange={setFolder} capability="fs.write" />
          <div className="row"><button className="btn small primary" disabled={!folder.trim()} onClick={() => save(folder)}>Use this folder</button><button className="btn small" onClick={() => setTyping(false)}>Cancel</button></div>
        </>
      )}
    </>
  );
}

/** Signed-in browsing: the founder signs in to sites in a real window; crew members use it only through writs. */
function SignedIn() {
  const wid = useStore((s) => s.vorldId)!;
  const [st, setSt] = useState<any>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const load = () => api(`/vorlds/${wid}/signin`).then(setSt).catch(() => {});
  useEffect(() => { void load(); const off = on('signin', setSt); return () => { off(); }; }, [wid]);
  useEffect(() => { if (!st?.open) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [st?.open]);
  const open = async () => {
    setBusy(true);
    try { setSt(await api(`/vorlds/${wid}/signin`, { body: { url } })); play('ui.open'); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); } finally { setBusy(false); }
  };
  const forget = async () => {
    try { setSt(await api(`/vorlds/${wid}/signin`, { method: 'DELETE' })); setSure(false); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  if (!st) return null;
  return (
    <>
      <h3>Signed-in browsing</h3>
      <p className="muted">Sign in to the sites your crew should use, in a real browser window. They never see or type your passwords. A member can use your sign-in only on a site where you grant them a writ, and anything that posts, sends, buys or deletes needs your approval each time.</p>
      {!st.available ? <p className="error small">This needs Google Chrome or Microsoft Edge installed on this computer.</p> : (
        <div className="pf-row">
          <input className="field grow" value={url} placeholder="https://www.youtube.com (optional start page)" disabled={st.open} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
          <button className="btn small primary" disabled={busy} onClick={open}>{st.open ? 'Show the window' : 'Open sign-in window'}</button>
        </div>
      )}
      {st.open && <p className="small">A browser window is open. Sign in there, then close the window to save.</p>}
      {st.sites.length > 0 ? (
        <>
          <p className="small">Saved sign-ins on this computer:</p>
          <div className="signin-sites">{st.sites.map((x: any) => <span key={x.domain} className="chip" title={`${x.cookies} cookies`}>🔒 {x.domain}</span>)}</div>
          {!sure
            ? <button className="btn small" onClick={() => setSure(true)}>Forget all sign-ins</button>
            : <div className="row"><span className="small">Delete every saved sign-in?</span><button className="btn small primary" onClick={forget}>Yes, forget them</button><button className="btn small" onClick={() => setSure(false)}>Keep</button></div>}
        </>
      ) : <p className="muted small">No saved sign-ins yet.</p>}
    </>
  );
}

/** The folder every crew member's own work folder is made in. */
function DefaultFolder() {
  const wid = useStore((s) => s.vorldId)!;
  const space = useStore((s) => s.vorld)?.workspace;
  const { native, choose } = useFolderDialog('fs.write');
  const [folder, setFolder] = useState(space?.default_space ?? '');
  const [typing, setTyping] = useState(false);
  const save = async (base: string | null) => {
    try { const w = await api(`/vorlds/${wid}`, { method: 'PUT', body: { workspace_base: base } }); setState({ vorld: w }); emit('vorld', w); setTyping(false); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const change = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(space?.default_space); if (p) await save(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  if (!space) return null;
  return (
    <>
      <h3>Private workspaces</h3>
      <p className="muted">Each crew member has a private workspace for drafts and notes inside this folder, unless you give them another in their settings.</p>
      {!typing ? (
        <div className="pf-row">
          <code className="pf-path" title={space.default_space}>{tail(space.default_space)}</code>
          <button className="btn small" onClick={change}>Change</button>
          {space.default_is_custom && <button className="btn small" onClick={() => save(null)}>Back to the vorld folder</button>}
        </div>
      ) : (
        <>
          <FolderPicker label="Default folder" value={folder} onChange={setFolder} capability="fs.write" />
          <div className="row"><button className="btn small primary" disabled={!folder.trim()} onClick={() => save(folder)}>Use this folder</button><button className="btn small" onClick={() => setTyping(false)}>Cancel</button></div>
        </>
      )}
    </>
  );
}
