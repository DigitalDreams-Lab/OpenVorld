// A party's room: its chats (newest first) and the open conversation. One shared transcript where every member answers
// under their own name; the party joins the founder on the map while a job runs.
import { api } from '../api';
import { emit, memberOf, setState, str, toast, useStore } from '../store';
import { IconButton } from './IconButton';
import { toggleWidePanel, useWidePanel } from './widePanel';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { ThreadView } from './Thread';
import { ThreadTabs, useChatThreads } from './ThreadTabs';
import { PendingRequests } from './Requests';

/** `hidden`: a member's chat is open on top; the room stays mounted so its chat, scroll and draft are there to come back to. */
export function PartyPanel({ id, hidden }: { id: string; hidden?: boolean }) {
  const wid = useStore((s) => s.vorldId)!;
  const wide = useWidePanel();
  const party = useStore((s) => (s.vorld.parties ?? []).find((p: any) => p.id === id));
  const live = useStore((s) => s.live);
  const path = `/vorlds/${wid}/parties/${id}/chats`;
  const chats = useChatThreads(wid, path, path, {});
  const active = chats.active?.id;
  if (!party) return null;
  const speaking = active && live[active]?.working ? memberOf(live[active].role)?.name : null;
  return (
    <aside className={`member-panel party-panel panel ${wide ? 'wide' : ''}`} style={hidden ? { visibility: 'hidden' } : undefined} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header className="cp-head">
        <div className="cp-who">
          <div className="cp-name" dir="auto" title={party.name}>🎲 {party.name}</div>
          <div className="party-crew">{party.members.map((m: string, i: number) => {
            const name = memberOf(m)?.name ?? m;      // a click opens their own chat, the same way as on the map
            const hint = i === 0 ? str('chat.open_leader', { name }, 'Chat with {name} (leader)') : str('chat.open_member', { name }, 'Chat with {name}');
            return <button key={m} type="button" className={`who ${i === 0 ? 'lead' : ''}`} title={hint} aria-label={hint} onClick={() => { play('ui.open'); emit('talk', m); }}><Portrait role={m} size={32} /></button>;
          })}</div>
          {party.goal && <div className="cp-goal muted" dir="auto">{party.goal}</div>}
        </div>
        <div className="cp-actions">
          <IconButton icon={wide ? 'shrink' : 'expand'} title={wide ? 'Back to the normal width' : 'Make the chat wider'} onClick={() => { play('ui.click'); toggleWidePanel(); }} />
          <IconButton icon="folder" title="Open the party's shared folder" onClick={() => { play('ui.open'); void api(`/vorlds/${wid}/parties/${id}/shared/open`, { body: {} }).then((r: any) => toast({ kind: 'info', title: 'Shared folder', body: r?.path })).catch((e: any) => toast({ kind: 'error', title: e.message })); }} />
          <IconButton icon="edit" title="Edit the party" onClick={() => { play('ui.open'); setState({ modal: 'parties', partyEdit: id }); }} />
          <IconButton icon="close" title="Close" onClick={() => setState({ partyId: null })} />
        </div>
      </header>
      <PendingRequests threads={(chats.threads ?? []).map(chat => chat.id)} />
      <ThreadTabs {...chats} />
      {speaking && <div className="party-speaking"><bdi>{speaking}</bdi> is speaking…</div>}
      {chats.threads === null ? <div className="empty">Loading…</div>
        : active ? <ThreadView key={active} wid={wid} tid={active} />
        : <div className="empty"><p>No chats yet with this party.</p><button className="btn primary" onClick={chats.newChat}>Start a chat</button></div>}
    </aside>
  );
}
