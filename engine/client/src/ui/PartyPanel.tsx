// A party's room: its chats (newest first) and the open conversation. One shared transcript where every member answers
// under their own name; the party gathers at the Party Hall on the map while a job runs.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, setState, toast, useStore } from '../store';
import { IconButton } from './IconButton';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { ThreadView } from './Thread';
import { PendingRequests } from './Requests';

export function PartyPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const version = useStore((s) => s.threadsVersion);
  const party = useStore((s) => (s.vorld.parties ?? []).find((p: any) => p.id === id));
  const live = useStore((s) => s.live);
  const [chats, setChats] = useState<any[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api(`/vorlds/${wid}/parties/${id}/chats`).then((list) => {
      if (!alive) return;
      setChats(list);
      setActive((a) => (a && list.some((t: any) => t.id === a) ? a : list[0]?.id ?? null));
    }).catch((e) => toast({ kind: 'error', title: e.message }));
    return () => { alive = false; };
  }, [wid, id, version]);
  if (!party) return null;
  const newChat = async () => {
    play('ui.open');
    try { const t = await api(`/vorlds/${wid}/parties/${id}/chats`, { body: {} }); setChats((x) => [t, ...(x ?? [])]); setActive(t.id); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const speaking = active && live[active]?.working ? memberOf(live[active].role)?.name : null;
  return (
    <aside className="member-panel party-panel panel" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header className="cp-head">
        <div className="cp-who">
          <div className="cp-name" title={party.name}>🎲 {party.name}</div>
          <div className="party-crew">{party.members.map((m: string, i: number) => <span key={m} className={i === 0 ? 'lead' : ''} title={`${memberOf(m)?.name ?? m}${i === 0 ? ' (leader)' : ''}`}><Portrait role={m} size={32} /></span>)}</div>
          {party.goal && <div className="cp-goal muted">{party.goal}</div>}
        </div>
        <div className="cp-actions">
          <IconButton icon="edit" title="Edit the party" onClick={() => { play('ui.open'); setState({ modal: 'parties', partyEdit: id }); }} />
          <IconButton icon="close" title="Close" onClick={() => setState({ partyId: null })} />
        </div>
      </header>
      <PendingRequests threads={(chats ?? []).map(chat => chat.id)} />
      <div className="thread-tabs">
        <button className="btn small primary" onClick={newChat}>+ New chat</button>
        <div className="thread-list">
          {(chats ?? []).map((t) => (
            <button key={t.id} className={`thread-tab ${t.id === active ? 'on' : ''} st-${t.state}`} onClick={() => { play('ui.click'); setActive(t.id); }}>
              <span className="st-dot" />{t.title ?? 'New chat'}
            </button>
          ))}
        </div>
      </div>
      {speaking && <div className="party-speaking">{speaking} is speaking…</div>}
      {chats === null ? <div className="empty">Loading…</div>
        : active ? <ThreadView key={active} wid={wid} tid={active} />
        : <div className="empty"><p>No chats yet with this party.</p><button className="btn primary" onClick={newChat}>Start a chat</button></div>}
    </aside>
  );
}
