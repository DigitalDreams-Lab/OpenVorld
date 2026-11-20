// Talking to one crew member: their chats (newest first) and the open conversation.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { emit, memberOf, openBrowserModal, setState, str, toast, useStore } from '../store';
import { IconButton } from './IconButton';
import { toggleWidePanel, useWidePanel } from './widePanel';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { ThreadView } from './Thread';
import { PendingRequests } from './Requests';

export function MemberPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const wide = useWidePanel();
  const version = useStore((s) => s.threadsVersion);
  useStore((s) => s.vorld);
  const m = memberOf(id);
  const [threads, setThreads] = useState<any[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api(`/vorlds/${wid}/threads?role=${encodeURIComponent(id)}`).then((list) => {
      if (!live) return;
      setThreads(list);
      setActive((a) => (a && list.some((t: any) => t.id === a) ? a : list.find((t: any) => t.kind === 'chat')?.id ?? list[0]?.id ?? null));
    }).catch((e) => toast({ kind: 'error', title: e.message }));
    return () => { live = false; };
  }, [wid, id, version]);
  if (!m) return null;
  const following = useStore((s) => s.following.includes(id));
  const browser = useStore((s) => s.browsers[id]);
  const closeBrowser = async () => {
    play('ui.click');
    try { await api(`/vorlds/${wid}/browser/${id}`, { method: 'DELETE' }); } catch (e: any) { toast({ kind: 'error', title: e.message }); return; }
    setState((s) => { const next = { ...s.browsers }; delete next[id]; return { browsers: next }; });
  };
  const newChat = async () => {
    play('ui.open');
    try { const t = await api(`/vorlds/${wid}/threads`, { body: { role: id } }); setThreads((x) => [t, ...(x ?? [])]); setActive(t.id); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <aside className={`member-panel panel ${wide ? 'wide' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header className="cp-head">
        <Portrait role={id} size={64} />
        <div className="cp-who">
          <div className="cp-name" title={m.name}>{m.name}</div>
          <div className="cp-job"><span className="job-tag">{m.role === 'companion' ? 'Companion' : m.job || 'Agent'}</span></div>
          {m.function && <div className="cp-title">{m.function}</div>}
          <div className="cp-meta"><span className="brain">{m.brain_label ?? 'no brain yet'}</span></div>
        </div>
        <div className="cp-actions">
          {following
            ? <IconButton icon="following" active title={`${m.name} is following you: send them home`} onClick={() => { play('ui.click'); emit('dismiss', { ids: [id] }); }} />
            : <IconButton icon="call" title={`Call ${m.name} over`} onClick={() => { play('ui.click'); emit('summon', { ids: [id] }); }} />}
          <IconButton icon={wide ? 'shrink' : 'expand'} title={wide ? 'Back to the normal width' : 'Make the chat wider'} onClick={() => { play('ui.click'); toggleWidePanel(); }} />
          <IconButton icon="gear" title="Settings" onClick={() => { play('ui.open'); setState({ modal: 'member' }); }} />
          <IconButton icon="close" title="Close" onClick={() => setState({ talkingTo: null })} />
        </div>
      </header>
      <PendingRequests role={id} />
      {browser?.image && (
        <div className={`mp-browser ${browser.needsHuman ? 'warn' : ''}`}>
          <img
            className="mp-browser-thumb"
            src={`data:image/jpeg;base64,${browser.image}`}
            alt={`${m.name}'s browser preview`}
            onClick={() => { play('ui.open'); openBrowserModal({ role: id, interactive: !!browser.needsHuman }); }}
          />
          <div className="mp-browser-info">
            <div className="mp-browser-title ellip">{browser.needsHuman ? `⚠ ${browser.needsHuman.reason}` : (browser.title || browser.url || 'Browser preview')}</div>
            <div className="mp-browser-actions">
              <button type="button" className="btn small" onClick={() => { play('ui.open'); openBrowserModal({ role: id, interactive: false }); }}>Expand</button>
              <button type="button" className="btn small primary" onClick={() => { play('ui.open'); openBrowserModal({ role: id, interactive: true }); }}>
                {browser.needsHuman ? 'Take over' : 'Interact'}
              </button>
              <button type="button" className="btn small" title={`Close ${m.name}'s browser`} onClick={closeBrowser}>Close</button>
            </div>
          </div>
        </div>
      )}
      {!m.brain_label && <p className="no-brain">{m.name} has no brain yet. <button className="link" onClick={() => setState({ modal: 'member' })}>Pick one</button> (Claude Code, Codex, Antigravity, OpenCode or an API model).</p>}
      <div className="thread-tabs">
        <button className="btn small primary" onClick={newChat}>+ {str('ui.new_chat', {}, 'New chat')}</button>
        <div className="thread-list">
          {(threads ?? []).map((t) => (
            <button key={t.id} className={`thread-tab ${t.id === active ? 'on' : ''} st-${t.state}`} onClick={() => { play('ui.click'); setActive(t.id); }}>
              <span className="st-dot" />{t.title ?? 'New chat'}
            </button>
          ))}
        </div>
      </div>
      {threads === null ? <div className="empty">Loading…</div>
        : active ? <ThreadView key={active} wid={wid} tid={active} placeholder={`Message ${m.name}…`} />
        : <div className="empty"><p>No chats yet with {m.name}.</p><button className="btn primary" onClick={newChat}>Start a chat</button></div>}
    </aside>
  );
}
