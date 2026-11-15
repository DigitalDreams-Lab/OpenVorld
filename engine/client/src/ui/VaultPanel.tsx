// The vault in one crew member's house, as an overview: the secrets and sign-ins kept for them. Nothing is added here:
// the member asks in the chat (a private box for a secret, a sign-in window), and you can remove things here.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, on, toast, useStore } from '../store';

export function VaultPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const c = memberOf(id);
  const base = `/vorlds/${wid}/crew/${id}`;
  const [v, setV] = useState<any>(null);
  const [sure, setSure] = useState(false);
  const load = () => api(`${base}/vault`).then(setV).catch(() => {});
  useEffect(() => { void load(); const off = on('signin', (m: any) => { if (m.role === id) void load(); }); return () => { off(); }; }, [wid, id]);
  const fail = (e: any) => toast({ kind: 'error', title: e.message });
  const dropSecret = async (n: string) => { try { const r = await api(`${base}/vault/secrets/${n}`, { method: 'DELETE' }); setV((x: any) => ({ ...x, secrets: r.secrets })); } catch (e: any) { fail(e); } };
  const forget = async () => { try { const r = await api(`${base}/signin`, { method: 'DELETE' }); setV((x: any) => ({ ...x, signin: r })); setSure(false); } catch (e: any) { fail(e); } };
  if (!v) return null;
  const sites = v.signin?.sites ?? [];
  return (
    <section className="project-folder vault">
      <h3 className="section-title">Vault</h3>
      <p className="muted small">{c.name}'s private keys and sign-ins, kept in their house on this computer. When {c.name} needs a key or a sign-in, they ask in the chat and you do it there. Values are hidden in chats.</p>
      {v.secrets.length === 0 && sites.length === 0 && <p className="muted small">Nothing kept yet.</p>}
      {v.secrets.map((s: any) => (
        <div key={s.name} className="pf-row"><code className="pf-path">🔑 {s.name}</code><span className="muted small">{s.length} characters</span><button className="btn small" onClick={() => dropSecret(s.name)}>Remove</button></div>
      ))}
      {sites.length > 0 && (
        <>
          <div className="signin-sites">{sites.map((x: any) => <span key={x.domain} className="chip" title={`${x.cookies} cookies`}>🔒 {x.domain}</span>)}</div>
          {!sure
            ? <button className="btn small" onClick={() => setSure(true)}>Forget all sign-ins</button>
            : <div className="row"><span className="small">Delete every saved sign-in of {c.name}?</span><button className="btn small primary" onClick={forget}>Yes, forget them</button><button className="btn small" onClick={() => setSure(false)}>Keep</button></div>}
        </>
      )}
    </section>
  );
}
