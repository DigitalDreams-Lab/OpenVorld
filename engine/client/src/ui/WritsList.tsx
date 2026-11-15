// Every writ (access) the founder has granted: who holds it, what it covers, how long it lasts. Revoke any time.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';
import { toast, useStore } from '../store';

const LASTS: Record<string, string> = { once: 'next turn only', session: 'until the game closes', always: 'until revoked' };

export function WritsList() {
  const wid = useStore((s) => s.worldId);
  const world = useStore((s) => s.world);
  const [grants, setGrants] = useState<any[] | null>(null);
  const load = () => api(`/worlds/${wid}/grants`).then(setGrants).catch((e) => toast({ kind: 'error', title: e.message }));
  useEffect(() => { void load(); }, [wid]);   // eslint-disable-line react-hooks/exhaustive-deps
  const who = (id: string) => world?.crew?.find((c: any) => c.id === id)?.name ?? id;
  const cap = (id: string) => world?.permissions?.capabilities?.[id];
  const revoke = async (g: any) => {
    try { await api(`/worlds/${wid}/grants/${g.id}`, { method: 'DELETE' }); play('ui.click'); await load(); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <>
      <h3>Writs</h3>
      <p className="muted">What your crew members may do. Everything else is closed to them until they ask and you agree.</p>
      {grants && !grants.length && <p className="muted">No access granted. Every crew member works only in their own private workspace.</p>}
      <ul className="writs-list">
        {(grants ?? []).map((g) => (
          <li key={g.id} className="writ-row">
            <div className="writ-row-main">
              <b>{who(g.role)}</b> <span className="muted">{cap(g.capability)?.label ?? g.capability}</span>
              <code className="writ-scope">{g.scope}</code>
              <span className="muted writ-lasts">{LASTS[g.answer ?? 'always'] ?? g.answer}</span>
            </div>
            <button className="btn small" onClick={() => revoke(g)}>Revoke</button>
          </li>
        ))}
      </ul>
    </>
  );
}
