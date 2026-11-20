// A crew member's request for access, shown in the conversation where it was made: who, what, exactly which scope
// and why, then the founder's answers (from permissions.yaml). Answered requests stay as a one-line record.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';
import { on, openBrowserModal, setOpenWrits, setState, str, toast, useStore } from '../store';
import { FolderPicker, useFolderDialog } from './FolderPicker';

export type WritEvent = { id: string; role: string; capability: string; scope: string; why?: string; risk?: string; signin?: boolean };

export function WritCard({ ask, answered, wid, thread, who }: { ask: WritEvent; answered?: { answer: string; scope?: string }; wid: string; thread: string; who: string }) {
  const perms = useStore((s) => s.vorld)?.permissions;
  const cap = perms?.capabilities?.[ask.capability];
  const isFolder = ask.capability.startsWith('fs.');
  const [scope, setScope] = useState(ask.scope);
  const [changing, setChanging] = useState(false);
  const { native, choose } = useFolderDialog(ask.capability);
  const other = async () => {
    if (!native) { setChanging(true); return; }
    try { const p = await choose(scope); if (p) setScope(p); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const [busy, setBusy] = useState(false);
  const needs = useNeeds(wid, ask, !answered);
  const [done, setDone] = useState<{ answer: string; scope?: string } | undefined>(answered);
  const result = answered ?? done;
  const answers = (perms?.answers ?? []).filter((a: any) => !(a.id === 'always' && cap?.seal === 'every_time'));
  const label = (a: any) => str(a.label_key ?? `writ.${a.id}`, {}, a.label ?? a.id);
  const what = `${cap?.label ?? ask.capability} ${scope}`.trim();

  const answer = async (id: string) => {
    setBusy(true);
    try {
      play(id === 'deny' ? 'ui.click' : 'seal.approved');
      const body: any = { answer: id };
      if (id !== 'deny' && scope !== ask.scope) body.scope = scope;
      if (id !== 'deny' && needs.value) body.value = needs.value;
      const r = await api(`/vorlds/${wid}/threads/${thread}/writs/${ask.id}`, { body });
      setDone({ answer: id, scope: r.scope });
      setOpenWrits(list => list.filter(request => request.id !== ask.id));
      setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); } finally { setBusy(false); }
  };

  if (result) {
    const a = (perms?.answers ?? []).find((x: any) => x.id === result.answer);
    return <div className={`log writ-done ${result.answer === 'deny' ? 'denied' : ''}`}>{result.answer === 'deny' ? '✕' : '✓'} {who}: {what} — {a ? label(a) : result.answer}</div>;
  }
  return (
    <div className={`writ-card risk-${ask.risk ?? cap?.risk ?? 'medium'}`} role="group" aria-label={`${who} asks for access`}>
      <div className="writ-head"><span className="writ-seal" aria-hidden>📜</span><b>{who}</b> {str('writ.asks', {}, 'asks to')} {cap?.label ?? ask.capability}<span className="writ-risk">{cap?.risk ?? ask.risk}</span></div>
      <code className="writ-scope">{scope}</code>
      {ask.why && <p className="writ-why">“{ask.why}”</p>}
      {needs.ui}
      {isFolder && (changing
        ? <FolderPicker value={scope} onChange={setScope} capability={ask.capability} label="Folder to share" />
        : <button className="link" onClick={other}>{str('writ.other_folder', {}, 'Share a different folder')}</button>)}
      <div className="writ-actions">
        {answers.map((a: any) => <button key={a.id} className={`btn small ${a.id === 'once' ? 'primary' : ''}`} disabled={busy || (a.id !== 'deny' && !needs.ready)} title={a.hint} onClick={() => answer(a.id)}>{label(a)}</button>)}
      </div>
    </div>
  );
}

/**
 * What a request needs before it can be allowed, done in the card itself:
 *  - a sign-in (`ask.signin`): a button opens a real browser window for the founder, the card notices when it is saved;
 *  - a secret the vault does not hold yet: a private box to paste it into (it goes to the vault, not the conversation).
 */
function useNeeds(wid: string, ask: WritEvent, open: boolean): { ready: boolean; value: string; ui: React.ReactNode } {
  const [st, setSt] = useState<any>(null);       // sign-in state for this site, or the vault
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const signin = !!ask.signin, secret = ask.capability === 'secret.use';
  const base = `/vorlds/${wid}/crew/${ask.role}`;
  const load = () => (signin ? api(`${base}/signin?site=${encodeURIComponent(ask.scope)}`) : api(`${base}/vault`)).then(setSt).catch(() => {});
  useEffect(() => {
    if (!open || !(signin || secret)) return;
    void load();
    const off = on('signin', (m: any) => { if (m.role === ask.role) void load(); });
    return () => { off(); };
  }, [wid, ask.id, open]);
  useEffect(() => { if (!open || !signin || !st?.open) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [open, signin, st?.open]);
  if (!open || !st) return { ready: !(signin || secret) || !open, value: '', ui: null };

  if (signin) {
    const startInApp = () => {
      play('ui.open');
      openBrowserModal({ role: ask.role, interactive: true, signed: true, url: `https://${ask.scope}` });
    };
    const startExternal = async () => {
      setBusy(true);
      try { setSt(await api(`${base}/signin`, { body: { url: `https://${ask.scope}` } })); play('ui.open'); void load(); }
      catch (e: any) { toast({ kind: 'error', title: e.message }); } finally { setBusy(false); }
    };
    return {
      ready: !!st.signed, value: '',
      ui: st.signed
        ? <p className="writ-need ok">✓ Signed in to {ask.scope}. You can allow it now.</p>
        : (
          <div className="writ-need">
            {!st.available ? <p className="error small">Signing in needs Google Chrome or Microsoft Edge installed on this computer.</p>
              : <p className="small">Sign in right inside OpenVorld. Your password stays with you; only the sign-in is kept, for this crew member.</p>}
            {st.available && (
              <div className="row">
                <button type="button" className="btn small primary" disabled={busy} onClick={startInApp}>{`Sign in to ${ask.scope}`}</button>
                <button type="button" className="link small" disabled={busy} onClick={startExternal}>{st.open ? 'Show Chrome window' : 'Open external Chrome instead'}</button>
              </div>
            )}
          </div>
        ),
    };
  }
  const held = (st.secrets ?? []).some((x: any) => x.name === ask.scope);
  if (secret && !held) {
    return {
      ready: value.trim().length > 0, value,
      ui: (
        <label className="writ-need">
          <span className="small">Paste the value of <b>{ask.scope}</b>. It goes straight into their private vault and never appears in the chat.</span>
          <input className="field" type="password" autoComplete="off" spellCheck={false} placeholder="paste here" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      ),
    };
  }
  return { ready: true, value: '', ui: null };
}
