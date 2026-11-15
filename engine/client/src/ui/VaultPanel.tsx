// The vault in one crew member's house: secrets (API keys, tokens) and the sign-ins you made for them. The vault never
// shows a value again once it is saved; the member only ever sees names, and uses one only with a writ.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, on, toast, useStore } from '../store';
import { play } from '../audio/sfx';

export function VaultPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const c = memberOf(id);
  const base = `/vorlds/${wid}/crew/${id}`;
  const [v, setV] = useState<any>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const load = () => api(`${base}/vault`).then(setV).catch(() => {});
  useEffect(() => { void load(); const off = on('signin', (m: any) => { if (m.role === id) setV((x: any) => (x ? { ...x, signin: m } : x)); }); return () => { off(); }; }, [wid, id]);
  useEffect(() => { if (!v?.signin?.open) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [v?.signin?.open]);
  const fail = (e: any) => toast({ kind: 'error', title: e.message });
  const addSecret = async () => {
    try { const r = await api(`${base}/vault/secrets`, { body: { name, value } }); setV((x: any) => ({ ...x, secrets: r.secrets })); setName(''); setValue(''); play('seal.approved'); }
    catch (e: any) { fail(e); }
  };
  const dropSecret = async (n: string) => { try { const r = await api(`${base}/vault/secrets/${n}`, { method: 'DELETE' }); setV((x: any) => ({ ...x, secrets: r.secrets })); } catch (e: any) { fail(e); } };
  const open = async () => {
    setBusy(true);
    try { const r = await api(`${base}/signin`, { body: { url } }); setV((x: any) => ({ ...x, signin: r })); play('ui.open'); } catch (e: any) { fail(e); } finally { setBusy(false); }
  };
  const forget = async () => { try { const r = await api(`${base}/signin`, { method: 'DELETE' }); setV((x: any) => ({ ...x, signin: r })); setSure(false); } catch (e: any) { fail(e); } };
  if (!v) return null;
  const si = v.signin;
  return (
    <section className="project-folder vault">
      <b>Vault</b>
      <p className="muted small">{c.name}'s private keys and sign-ins, kept in their house on this computer. {c.name} sees only the names, and uses one only with a writ you grant. Values are hidden in chats.</p>

      <div className="vault-part">
        <b className="small">Secrets</b>
        {v.secrets.length === 0 && <p className="muted small">No secrets yet.</p>}
        {v.secrets.map((s: any) => (
          <div key={s.name} className="pf-row"><code className="pf-path">{s.name}</code><span className="muted small">{s.length} characters</span><button className="btn small" onClick={() => dropSecret(s.name)}>Remove</button></div>
        ))}
        <div className="row wrap">
          <input className="field grow" placeholder="NAME, e.g. YT_CLIENT_SECRET" value={name} maxLength={64} onChange={(e) => setName(e.target.value.toUpperCase())} />
          <input className="field grow" type="password" autoComplete="off" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name && value) void addSecret(); }} />
          <button className="btn small primary" disabled={!name || !value} onClick={addSecret}>Save secret</button>
        </div>
      </div>

      <div className="vault-part">
        <b className="small">Sign-ins</b>
        <p className="muted small">Sign in to the sites {c.name} should use, in a real browser window. {c.name} never sees your passwords, and uses the sign-in only on a site where you grant a writ; posting, sending, buying or deleting needs your approval each time.</p>
        {!si.available ? <p className="error small">This needs Google Chrome or Microsoft Edge installed on this computer.</p> : (
          <div className="pf-row">
            <input className="field grow" value={url} placeholder="https://www.youtube.com (optional start page)" disabled={si.open} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
            <button className="btn small primary" disabled={busy} onClick={open}>{si.open ? 'Show the window' : 'Open sign-in window'}</button>
          </div>
        )}
        {si.open && <p className="small">A browser window is open. Sign in there, then close the window to save.</p>}
        {si.sites.length > 0 ? (
          <>
            <div className="signin-sites">{si.sites.map((x: any) => <span key={x.domain} className="chip" title={`${x.cookies} cookies`}>🔒 {x.domain}</span>)}</div>
            {!sure
              ? <button className="btn small" onClick={() => setSure(true)}>Forget all sign-ins</button>
              : <div className="row"><span className="small">Delete every saved sign-in of {c.name}?</span><button className="btn small primary" onClick={forget}>Yes, forget them</button><button className="btn small" onClick={() => setSure(false)}>Keep</button></div>}
          </>
        ) : <p className="muted small">No saved sign-ins yet.</p>}
      </div>
    </section>
  );
}
