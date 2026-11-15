// The writs (access) one crew member holds, in an expandable section of their own settings: what, where, how long, and Revoke.
// Everything else is closed to them until they ask and the founder agrees.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';
import { toast, useStore } from '../store';

const LASTS: Record<string, string> = { once: 'next turn only', session: 'until the game closes', always: 'until revoked' };

export function MemberWrits({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId);
  const vorld = useStore((s) => s.vorld);
  const name = vorld?.crew?.find((c: any) => c.id === id)?.name ?? 'This member';
  const [grants, setGrants] = useState<any[] | null>(null);
  const load = () => api(`/vorlds/${wid}/grants`).then((all: any[]) => setGrants(all.filter((g) => g.role === id))).catch((e) => toast({ kind: 'error', title: e.message }));
  useEffect(() => { void load(); }, [wid, id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cap = (c: string) => vorld?.permissions?.capabilities?.[c];
  const revoke = async (g: any) => {
    try { await api(`/vorlds/${wid}/grants/${g.id}`, { method: 'DELETE' }); play('ui.click'); await load(); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <details className="member-writs">
      <summary><span className="section-title">Writs</span><span className="chip">{grants ? grants.length : '…'}</span></summary>
      <p className="muted section-note">What {name} may do beyond reading the project folder and working on their own workbenches. Everything else is closed to them until they ask and you agree.</p>
      {grants && !grants.length && <p className="muted small">No access granted to {name}.</p>}
      <ul className="writs-list">
        {(grants ?? []).map((g) => (
          <li key={g.id} className="writ-row">
            <span className="writ-what">{cap(g.capability)?.label ?? g.capability}</span>
            <code className="writ-scope" title={g.scope}>{g.scope}</code>
            <span className="muted writ-lasts">{LASTS[g.answer ?? 'always'] ?? g.answer}</span>
            <button className="btn small" onClick={() => revoke(g)}>Revoke</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
