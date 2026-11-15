// Agent activity lives with the character, rather than in an automatically opened side window.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { agentActivity } from '../activity';
import { api } from '../api';
import { play } from '../audio/sfx';
import { emit, on, setOpenWrits, setState, str, toast, useStore, type OpenWrit } from '../store';

type Anchors = { width: number; height: number; positions: Record<string, { x: number; y: number }> };
export function AgentBalloons() {
  const crew: any[] = useStore(state => state.vorld?.crew ?? []);
  const live = useStore(state => state.live), browsers = useStore(state => state.browsers);
  const notes = useStore(state => state.activityNotes);
  const modal = useStore(state => state.modal);
  const asks = useStore(state => state.openWrits), talkingTo = useStore(state => state.talkingTo);
  const [now, setNow] = useState(Date.now());
  const elements = useRef(new Map<string, HTMLElement>()), anchors = useRef<Anchors | null>(null);
  const place = () => {
    const snapshot = anchors.current;
    for (const [role, element] of elements.current) {
      const at = snapshot?.positions[role];
      if (!snapshot || !at || at.x < 0 || at.x > snapshot.width || at.y < 0 || at.y > snapshot.height) { element.style.visibility = 'hidden'; continue; }
      const width = element.offsetWidth, height = element.offsetHeight;
      const left = Math.max(8, Math.min(snapshot.width - width - 8, at.x - width / 2));
      const below = at.y < height + 20;
      const top = below ? at.y + 24 : at.y - height - 12;
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      element.style.setProperty('--tail-left', `${Math.max(16, Math.min(width - 16, at.x - left))}px`);
      element.classList.toggle('below', below);
      element.style.visibility = 'visible';
    }
  };
  useEffect(() => { const off = on('agent-anchors', (value: Anchors | null) => { anchors.current = value; place(); }); return () => { off(); }; }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  useLayoutEffect(place);
  if (modal) return null;
  return <div className="agent-balloons" aria-label="Crew activity">
    {crew.map(member => {
      const ask = asks.find(w => w.role === member.id);
      if (ask && talkingTo !== member.id) {         // waiting for the founder's answer: asked right here, over their head
        return <AskBalloon key={member.id} member={member} ask={ask} more={asks.filter(w => w.role === member.id).length - 1}
          register={element => { if (element) elements.current.set(member.id, element); else elements.current.delete(member.id); }} />;
      }
      const activity = agentActivity(member.id, live, browsers[member.id], now, notes[member.id]);
      if (!activity) return null;
      const label = { browser: 'Browsing', work: 'Working', done: 'Done', error: 'Needs help' }[activity.kind];
      return <button key={member.id} type="button" className={`agent-balloon ${activity.kind}`} data-agent={member.id}
        ref={element => { if (element) elements.current.set(member.id, element); else elements.current.delete(member.id); }}
        style={{ visibility: 'hidden' } as CSSProperties} aria-label={`${member.name}: ${label}. ${activity.text}`}
        title={`Open ${member.name}'s conversation`} onClick={event => { event.stopPropagation(); emit('talk', member.id); }} onPointerDown={event => event.stopPropagation()}>
        <span className="ab-heading"><strong>{member.name}</strong><span className="ab-state">{label}</span></span>
        <span className="ab-text">{activity.text}</span>
        {activity.image && <img className="ab-browser" src={`data:image/jpeg;base64,${activity.image}`} alt={`${member.name}'s live browser preview`} onLoad={place} />}
        {activity.kind === 'browser' && activity.site && <span className="ab-site">{activity.signed ? '🔒 ' : '🌐 '}{activity.site}<span>View only</span></span>}
      </button>;
    })}
  </div>;
}

/** A request for access, asked in the balloon: what, why, and the founder's answers. Sign-ins and secrets need the real card in the chat. */
function AskBalloon({ member, ask, more, register }: { member: any; ask: OpenWrit; more: number; register: (element: HTMLElement | null) => void }) {
  const wid = useStore(state => state.vorldId), perms = useStore(state => state.vorld?.permissions);
  const [busy, setBusy] = useState(false);
  const cap = perms?.capabilities?.[ask.capability];
  const needsCard = !!ask.signin || ask.capability === 'secret.use';
  const answers = (perms?.answers ?? []).filter((a: any) => !(a.id === 'always' && cap?.seal === 'every_time'));
  const label = (a: any) => str(a.label_key ?? `writ.${a.id}`, {}, a.label ?? a.id);
  const answer = async (id: string) => {
    setBusy(true);
    try {
      play(id === 'deny' ? 'ui.click' : 'seal.approved');
      await api(`/vorlds/${wid}/threads/${ask.thread}/writs/${ask.id}`, { body: { answer: id } });
      setOpenWrits(list => list.filter(w => w.id !== ask.id));
      setState(s => ({ threadsVersion: s.threadsVersion + 1 }));
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); } finally { setBusy(false); }
  };
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return <div className={`agent-balloon ask risk-${ask.risk ?? cap?.risk ?? 'medium'}`} role="group" aria-label={`${member.name} asks for access`}
    ref={register} style={{ visibility: 'hidden' } as CSSProperties} onPointerDown={stop} onClick={stop}>
    <span className="ab-heading"><strong>{member.name}</strong><span className="ab-state">Needs your OK{more > 0 ? ` · +${more}` : ''}</span></span>
    <span className="ab-text">{str('writ.asks', {}, 'Asks to')} {(cap?.label ?? ask.capability).toLowerCase()} <code>{ask.scope}</code></span>
    {ask.why && <span className="ab-why">“{ask.why}”</span>}
    <span className="ab-actions">
      {needsCard
        ? <button type="button" className="btn small primary" onClick={() => emit('talk', member.id)}>Open the request</button>
        : <>{answers.map((a: any) => <button key={a.id} type="button" className={`btn small ${a.id === 'once' ? 'primary' : ''}`} disabled={busy} title={a.hint} onClick={() => void answer(a.id)}>{label(a)}</button>)}
          <button type="button" className="link" onClick={() => emit('talk', member.id)}>Details</button></>}
    </span>
  </div>;
}
