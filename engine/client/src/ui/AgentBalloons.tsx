// Agent activity lives with the character, rather than in an automatically opened side window.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { agentActivity } from '../activity';
import { api } from '../api';
import { play } from '../audio/sfx';
import { emit, on, setOpenWrits, setState, str, toast, useStore, type OpenWrit } from '../store';

type Anchors = { width: number; height: number; positions: Record<string, { x: number; y: number; feet: number }> };
export function AgentBalloons() {
  const crew: any[] = useStore(state => state.vorld?.crew ?? []);
  const live = useStore(state => state.live), browsers = useStore(state => state.browsers);
  const notes = useStore(state => state.activityNotes);
  const modal = useStore(state => state.modal);
  const asks = useStore(state => state.openWrits), talkingTo = useStore(state => state.talkingTo);
  const [now, setNow] = useState(Date.now());
  const elements = useRef(new Map<string, HTMLElement>()), anchors = useRef<Anchors | null>(null);
  /** Put every balloon over (or, near the top of the map, under) its character. Balloons that would cover each other are stacked, the
   *  nearer character's balloon next to the character and the others above it, each joined to its own character by a stem. */
  const place = () => {
    const snapshot = anchors.current, GAP = 8;
    type Item = { element: HTMLElement; at: { x: number; y: number; feet: number }; width: number; height: number; left: number; below: boolean };
    const items: Item[] = [];
    const crowded = [...elements.current.values()].length > 1;     // several balloons at once: the short form, so they fit
    for (const [role, element] of elements.current) {
      const at = snapshot?.positions[role];
      element.classList.toggle('compact', crowded);
      if (!snapshot || !at || at.x < 0 || at.x > snapshot.width || at.y < 0 || at.y > snapshot.height) { element.style.visibility = 'hidden'; continue; }
      const width = element.offsetWidth, height = element.offsetHeight;
      items.push({ element, at, width, height, left: Math.max(8, Math.min(snapshot.width - width - 8, at.x - width / 2)), below: at.y < height + 20 });
    }
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const order = [...items.filter(i => !i.below).sort((a, b) => b.at.feet - a.at.feet), ...items.filter(i => i.below).sort((a, b) => a.at.feet - b.at.feet)];
    const free = (left: number, width: number, top: number, height: number) =>
      placed.filter(r => left < r.right + GAP && left + width > r.left - GAP && top < r.bottom + GAP && top + height > r.top - GAP);
    order.forEach((item, index) => {
      const { element, at, width, height, left } = item;
      const H = snapshot!.height;
      const slot = (below: boolean) => {                          // the nearest free spot over (or under) the character, stepping over the balloons in the way
        let top = below ? at.feet + 16 : at.y - height - 12;
        for (let guard = 0; guard < 12; guard++) {
          const hit = free(left, width, top, height);
          if (!hit.length) break;
          top = below ? Math.max(...hit.map(r => r.bottom)) + GAP : Math.min(...hit.map(r => r.top)) - height - GAP;
        }
        return top;
      };
      let below = item.below, top = slot(below);
      if (!below && top < 4) { const lower = slot(true); if (lower + height <= H - 4) { below = true; top = lower; } }   // no room left above: stack under the characters
      else if (below && top + height > H - 4) { const upper = slot(false); if (upper >= 4) { below = false; top = upper; } }
      top = Math.max(4, Math.min(H - height - 4, top));
      placed.push({ left, right: left + width, top, bottom: top + height });
      // the stem joins a balloon that had to move away from its character
      const stem = below ? top - (at.feet + 2) : (at.y - 2) - (top + height);
      const stemmed = stem > 14;
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      element.style.zIndex = String(500 - index);                 // the stem of a higher balloon passes behind the ones below it
      element.style.setProperty('--tail-left', `${Math.max(16, Math.min(width - 16, at.x - left))}px`);
      element.style.setProperty('--stem', `${stemmed ? Math.round(stem) : 0}px`);
      element.classList.toggle('below', below);
      element.classList.toggle('stemmed', stemmed);
      element.style.visibility = 'visible';
    });
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
