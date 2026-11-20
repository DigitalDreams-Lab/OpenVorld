// One thread (a chat with a crew member, or a party's shared room): the saved events, the live turn, writ cards,
// answer options and the composer. In a party room every message shows who said it, like a group chat.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { memberOf, toast, useStore } from '../store';
import { AgentTurn, Markdown } from './Chat';
import { MessageFiles } from './MessageFiles';
import { WritCard } from './WritCard';
import { ChatComposer, DropHint, useChatDraft } from './ChatComposer';
import { BenchLine } from './BenchLine';
import { EVERYONE, asksEveryone } from './mentions';
import { nearEnd } from './scroll';

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
  const following = useRef(true);   // the reader is at the end of the chat: new messages follow them down; scrolling up to read stops that until they come back near the end
  const events = data?.events ?? [];
  const thread = data?.thread;
  const m = memberOf(thread?.role);
  const party = thread?.kind === 'party';
  const speakerName = (role?: string | null) => memberOf(role)?.name ?? role ?? '';
  const crew = useStore((s) => s.vorld?.crew);
  const members = useStore((s) => s.vorld?.parties?.find((p: any) => p.id === thread?.party)?.members);
  const mentionMembers = [...(crew ?? []).filter((c: any) => !party || members?.includes(c.id)), ...(party && (members?.length ?? 0) > 1 ? [EVERYONE] : [])];
  const names = useMemo<string[]>(() => (party ? (crew ?? []).map((c: any) => c.name) : []), [party, crew]);
  const draft = useChatDraft({ wid, thread: tid, working, onEvents: setEvents });
  const seen = useRef(0);
  useEffect(() => {
    // sending a message always goes to the end: only when it was just added, not while the reply streams (your message is still the last saved event then)
    const added = events.length > seen.current;
    seen.current = events.length;
    if (added && events[events.length - 1]?.type === 'founder.message') following.current = true;
    if (following.current) end.current?.scrollIntoView({ block: 'end' });
  }, [events.length, live?.steps]);
  const lastAgent = useMemo(() => [...events].reverse().find((e: any) => e.type === 'agent.text'), [events]);
  const answered = useMemo(() => new Map<string, any>(events.filter((e: any) => e.type === 'writ.answered').map((e: any) => [e.id, e])), [events]);
  if (error) return <div className="empty" role="alert">Could not load this chat: {error}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  return (
    <div className={`convo ${draft.dragging ? 'dragging' : ''}`} {...(canSend ? draft.dropHandlers : {})}>
      {draft.dragging && <DropHint />}
      <div className="messages" onScroll={(e) => { following.current = nearEnd(e.currentTarget); }}>
        {events.map((e: any, i: number) => {
          if (e.type === 'founder.message') return <div key={i} className="msg me"><Markdown text={e.text} thread={tid} /><MessageFiles files={e.attachments} /></div>;
          if (e.type === 'agent.text') return <AgentTurn key={i} role={e.role ?? thread.role} steps={e.steps} text={e.text} mood={e.meta?.mood} did={e.meta?.did} noted={e.meta?.noted} thread={tid} {...(party ? { speaker: speakerName(e.role), job: memberOf(e.role)?.job, mentions: names } : {})} />;
          if (e.type === 'writ.request') return <WritCard key={e.id} ask={e} answered={answered.get(e.id)} wid={wid} thread={tid} who={speakerName(e.role)} />;
          if (e.type === 'turn.error') return <div key={i} className="log err">✖ <bdi>{e.message}</bdi></div>;
          if (e.type === 'party.paused') return <div key={i} className="log">⏸ <bdi>{e.text}</bdi></div>;
          return null;
        })}
        {working && <AgentTurn role={live.role ?? thread.role} steps={live.steps} live thread={tid} {...(party ? { speaker: speakerName(live.role), job: memberOf(live.role)?.job, mentions: names } : {})} />}
        {live?.error && !working && !events.some((e: any) => e.type === 'turn.error' && e.message === live.error) && <div className="log err">✖ <bdi>{live.error}</bdi></div>}      {/* the saved copy of the same error is already shown above */}
        <div ref={end} />
      </div>
      {canSend && !working && lastAgent?.meta?.options?.length > 0 && (
        <div className="options">{lastAgent.meta.options.map((o: string) => <button key={o} className="option" dir="auto" disabled={draft.busy} onClick={() => draft.send(o, true)}>▸ {o}</button>)}</div>
      )}
      {canSend && <ChatComposer draft={draft} mentionMembers={mentionMembers} placeholder={placeholder ?? (party ? 'Message the party… (@Name picks who answers first, @all asks everyone)' : `Message ${m?.name ?? ''}…`)} working={working} onStop={() => { void api(`/vorlds/${wid}/threads/${tid}/stop`, { body: {} }).catch((e) => toast({ kind: 'error', title: e.message })); }} {...(party && asksEveryone(draft.text) ? { hint: <div className="composer-hint">@all asks all {members?.length ?? 0} members, one after the other</div> } : {})} {...(!party && thread?.bench ? { hint: <BenchLine wid={wid} thread={thread} begun={events.some((e: any) => e.type === 'founder.message')} /> } : {})} />}
    </div>
  );
}
