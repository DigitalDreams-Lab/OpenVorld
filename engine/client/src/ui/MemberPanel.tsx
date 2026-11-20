// Talking to one crew member: their chats (newest first) and the open conversation.
import { api } from '../api';
import { emit, memberOf, openBrowserModal, setState, toast, useStore } from '../store';
import { IconButton } from './IconButton';
import { toggleWidePanel, useWidePanel } from './widePanel';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { ThreadView } from './Thread';
import { ThreadTabs, useChatThreads } from './ThreadTabs';
import { PendingRequests } from './Requests';

export function MemberPanel({ id }: { id: string }) {
  const wid = useStore((s) => s.vorldId)!;
  const wide = useWidePanel();
  useStore((s) => s.vorld);
  const m = memberOf(id);
  const path = `/vorlds/${wid}/threads`;
  const chats = useChatThreads(wid, `${path}?role=${encodeURIComponent(id)}`, path, { role: id });
  const following = useStore((s) => s.following.includes(id));
  const browser = useStore((s) => s.browsers[id]);
  if (!m) return null;
  const closeBrowser = async () => {
    play('ui.click');
    try { await api(`/vorlds/${wid}/browser/${id}`, { method: 'DELETE' }); } catch (e: any) { toast({ kind: 'error', title: e.message }); return; }
    setState((s) => { const next = { ...s.browsers }; delete next[id]; return { browsers: next }; });
  };
  return (
    <aside className={`member-panel panel ${wide ? 'wide' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header className="cp-head">
        <Portrait role={id} size={64} />
        <div className="cp-who">
          <div className="cp-name" dir="auto" title={m.name}>{m.name}</div>
          <div className="cp-job"><span className="job-tag" dir="auto">{m.role === 'companion' ? 'Companion' : m.job || 'Agent'}</span></div>
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
            <div className="mp-browser-title ellip" dir="auto">{browser.needsHuman ? `⚠ ${browser.needsHuman.reason}` : (browser.title || browser.url || 'Browser preview')}</div>
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
      {!m.brain_label && <p className="no-brain"><bdi>{m.name}</bdi> has no brain yet. <button className="link" onClick={() => setState({ modal: 'member' })}>Pick one</button> (Claude Code, Codex, Antigravity, OpenCode or an API model).</p>}
      <ThreadTabs {...chats} />
      {chats.threads === null ? <div className="empty">Loading…</div>
        : chats.active ? <ThreadView key={chats.active.id} wid={wid} tid={chats.active.id} placeholder={`Message ${m.name}…`} />
        : <div className="empty"><p>No chats yet with <bdi>{m.name}</bdi>.</p><button className="btn primary" onClick={chats.newChat}>Start a chat</button></div>}
    </aside>
  );
}
