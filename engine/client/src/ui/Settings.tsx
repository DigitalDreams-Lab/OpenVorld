// Vorld settings: name and purpose, model endpoints (OpenAI-compatible; the key is read from an environment variable
// you name, never stored), the project folder, the workbenches folder, the writs you granted, and sound.
import { IconButton } from './IconButton';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { emit, setState, toast, useStore } from '../store';
import { play, setSfxVolume } from '../audio/sfx';
import { notify, notifyPrefs, setNotifyPrefs } from '../notify';
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
    <div className="modal-bg" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
      <div className="modal panel settings" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <header className="row between"><h2>Settings</h2><IconButton icon="close" title="Close" onClick={close} /></header>
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
        <DefaultFolder />
        <WritsList />
        <h3>Sound</h3>
        <label className="form-row"><span>Effects</span><input type="range" min={0} max={1} step={0.05} defaultValue={0.8} onChange={(e) => { setSfxVolume(Number(e.target.value)); play('ui.click'); }} /></label>
        <h3>Notifications</h3>
        <NotifySettings />
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

/** The folder every crew member's own work folder is made in. */
function DefaultFolder() {
  const wid = useStore((s) => s.vorldId)!;
  const space = useStore((s) => s.vorld)?.benches;
  const { native, choose } = useFolderDialog('fs.write');
  const [folder, setFolder] = useState(space?.base ?? '');
  const [typing, setTyping] = useState(false);
  const save = async (base: string | null) => {
    try { const w = await api(`/vorlds/${wid}`, { method: 'PUT', body: { bench_base: base } }); setState({ vorld: w }); emit('vorld', w); setTyping(false); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const change = async () => {
    if (!native) { setTyping(true); return; }
    try { const p = await choose(space?.base); if (p) await save(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  if (!space) return null;
  return (
    <>
      <h3>Workbenches</h3>
      <p className="muted">Each crew member's Main bench is made inside this folder, unless you give them another folder in their settings. They can have more workbenches there too.</p>
      {!typing ? (
        <div className="pf-row">
          <code className="pf-path" title={space.base}>{tail(space.base)}</code>
          <button className="btn small" onClick={change}>Change</button>
          {space.custom && <button className="btn small" onClick={() => save(null)}>Back to the vorld folder</button>}
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

/** How the crew gets your attention: a chime when someone needs you, and desktop notifications while the window is out of sight. */
function NotifySettings() {
  const [prefs, setPrefs] = useState(notifyPrefs());
  const set = (patch: Partial<typeof prefs>) => { setNotifyPrefs(patch); setPrefs(notifyPrefs()); };
  return (
    <>
      <label className="check"><input type="checkbox" checked={prefs.sound} onChange={(e) => set({ sound: e.target.checked })} /> Play a chime when someone needs me</label>
      <label className="check"><input type="checkbox" checked={prefs.desktop} onChange={(e) => set({ desktop: e.target.checked })} /> Show a desktop notification when OpenVorld is in the background</label>
      <p className="muted small">The crew's work itself (tool calls, typing) is silent. A notification means someone is waiting for your answer, or a job ended while you were away.</p>
      <div className="row"><button className="btn small" onClick={() => notify({ kind: 'attention', title: 'OpenVorld', body: 'This is how a notification looks.' }, { force: true })}>Send a test</button></div>
    </>
  );
}
