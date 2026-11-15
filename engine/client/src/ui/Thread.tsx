// One thread (a chat with a crew member, or one step of a quest): the saved events, the live turn, writ cards,
// drafted quests, answer options and the composer. Chats and quest steps look exactly the same.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { memberOf, setState, toast, useStore } from '../store';
import { AgentTurn, Markdown } from './Chat';
import { MessageFiles } from './MessageFiles';
import { WritCard } from './WritCard';
import { ChatComposer, DropHint, useChatDraft } from './ChatComposer';

/** Saved events of a thread, refetched when a turn ends (threadsVersion) or when `key` changes. */
export function useThreadEvents(wid: string, tid: string | null) {
  const version = useStore((s) => s.threadsVersion);
  const [data, setData] = useState<{ thread: any; events: any[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!tid) { setData(null); return; }
    let live = true;
    api(`/vorlds/${wid}/threads/${tid}`).then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [wid, tid, version]);
  return { data, error, setEvents: (update: (e: any[]) => any[]) => setData((d) => (d ? { ...d, events: update(d.events) } : d)) };
}

export function ThreadView({ wid, tid, canSend = true, placeholder }: { wid: string; tid: string; canSend?: boolean; placeholder?: string }) {
  const { data, error, setEvents } = useThreadEvents(wid, tid);
  const live = useStore((s) => s.live[tid]);
  const working = !!live?.working;
  const end = useRef<HTMLDivElement>(null);
  const events = data?.events ?? [];
  const thread = data?.thread;
  const m = memberOf(thread?.role);
  const draft = useChatDraft({ wid, thread: tid, working, onEvents: setEvents });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length, live?.steps]);
  const lastAgent = useMemo(() => [...events].reverse().find((e: any) => e.type === 'agent.text'), [events]);
  const answered = useMemo(() => new Map<string, any>(events.filter((e: any) => e.type === 'writ.answered').map((e: any) => [e.id, e])), [events]);
  if (error) return <div className="empty" role="alert">Could not load this chat: {error}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  return (
    <div className={`convo ${draft.dragging ? 'dragging' : ''}`} {...(canSend ? draft.dropHandlers : {})}>
      {draft.dragging && <DropHint />}
      <div className="messages">
        {events.map((e: any, i: number) => {
          if (e.type === 'founder.message') return <div key={i} className="msg me"><Markdown text={e.text} thread={tid} /><MessageFiles files={e.attachments} /></div>;
          if (e.type === 'brief') return <Brief key={i} text={e.text} />;
          if (e.type === 'agent.text') return <AgentTurn key={i} role={thread.role} steps={e.steps} text={e.text} mood={e.meta?.mood} did={e.meta?.did} thread={tid} />;
          if (e.type === 'writ.request') return <WritCard key={e.id} ask={e} answered={answered.get(e.id)} wid={wid} thread={tid} who={m?.name ?? e.role} />;
          if (e.type === 'turn.error') return <div key={i} className="log err">✖ {e.message}</div>;
          if (e.type === 'sealed') return <div key={i} className="log sealed">✦ Sealed by you</div>;
          if (e.type === 'quest.draft') return (
            <div key={i} className="quest-draft-card">
              <b>📜 Quest drafted: {e.title}</b>
              <button className="btn small primary" onClick={() => setState({ modal: 'quests', questId: e.quest, talkingTo: null })}>Open on the Quest Board</button>
            </div>
          );
          return null;
        })}
        {working && <AgentTurn role={thread.role} steps={live.steps} live thread={tid} />}
        {live?.error && !working && <div className="log err">✖ {live.error}</div>}
        <div ref={end} />
      </div>
      {canSend && !working && lastAgent?.meta?.options?.length > 0 && (
        <div className="options">{lastAgent.meta.options.map((o: string) => <button key={o} className="option" disabled={draft.busy} onClick={() => draft.send(o, true)}>▸ {o}</button>)}</div>
      )}
      {canSend && <ChatComposer draft={draft} placeholder={placeholder ?? `Message ${m?.name ?? ''}…`} working={working} onStop={() => { void api(`/vorlds/${wid}/threads/${tid}/stop`, { body: {} }).catch((e) => toast({ kind: 'error', title: e.message })); }} />}
    </div>
  );
}

/** What a quest step was told, folded (it can be long: it carries the earlier steps' results). */
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="brief">
      <button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Quest brief</button>
      {open && <div className="bubble"><Markdown text={text} /></div>}
    </div>
  );
}
