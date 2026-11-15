// A crew member's request for access, shown in the conversation where it was made: who, what, exactly which scope
// and why, then the founder's answers (from permissions.yaml). Answered requests stay as a one-line record.
import { useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';
import { setState, str, toast, useStore } from '../store';
import { FolderPicker, useFolderDialog } from './FolderPicker';

export type WritEvent = { id: string; role: string; capability: string; scope: string; why?: string; risk?: string };

export function WritCard({ ask, answered, wid, thread, who }: { ask: WritEvent; answered?: { answer: string; scope?: string }; wid: string; thread: string; who: string }) {
  const perms = useStore((s) => s.world)?.permissions;
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
      const r = await api(`/worlds/${wid}/threads/${thread}/writs/${ask.id}`, { body });
      setDone({ answer: id, scope: r.scope });
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
      {isFolder && (changing
        ? <FolderPicker value={scope} onChange={setScope} capability={ask.capability} label="Folder to share" />
        : <button className="link" onClick={other}>{str('writ.other_folder', {}, 'Share a different folder')}</button>)}
      <div className="writ-actions">
        {answers.map((a: any) => <button key={a.id} className={`btn small ${a.id === 'once' ? 'primary' : ''}`} disabled={busy} title={a.hint} onClick={() => answer(a.id)}>{label(a)}</button>)}
      </div>
    </div>
  );
}
