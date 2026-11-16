// Agent activity lives with the character, rather than in an automatically opened side window.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { agentActivity } from '../activity';
import { api } from '../api';
import { play } from '../audio/sfx';
import { emit, on, openRequest, setOpenWrits, setState, str, toast, useStore, type OpenWrit } from '../store';

type Anchors = { width: number; height: number; positions: Record<string, { x: number; y: number; feet: number }> };
export function AgentBalloons() {
  const crew: any[] = useStore(state => state.vorld?.crew ?? []);
  const live = useStore(state => state.live), browsers = useStore(state => state.browsers);
  const notes = useStore(state => state.activityNotes);
  const modal = useStore(state => state.modal);
  const asks = useStore(state => state.openWrits), talkingTo = useStore(state => state.talkingTo);
  const [now, setNow] = useState(Date.now());
  const elements = useRef(new Map<string, HTMLElement>()), anchors = useRef<Anchors | null>(null);
  /** Put every balloon over (or, near the top of the map, under) its character. Each character has a column: its job or request
   *  balloon next to it, then what it says (a call, a line from a command), the newest highest. Balloons of different characters that
   *  would cover each other are stepped over (or continue under the group), and every balloon that had to move away from its
   *  character is joined to it by a stem. Elements are keyed by role (the job balloon) or `role~n` (what it said). */
  const place = () => {
    const snapshot = anchors.current, GAP = 8, TIGHT = 4;
    type Item = { key: string; role: string; n: number; element: HTMLElement; width: number; height: number; left: number };
    type At = { x: number; y: number; feet: number };
    const columns = new Map<string, Item[]>();
    const crowded = [...elements.current.keys()].filter(k => !k.includes('~')).length > 1;     // several job balloons at once: the short form, so they fit
    for (const [key, element] of elements.current) {
      const [role, n] = key.split('~'), at = snapshot?.positions[role], speech = n !== undefined;
      if (!speech) element.classList.toggle('compact', crowded);
      if (!snapshot || !at || at.x < 0 || at.x > snapshot.width || at.y < 0 || at.y > snapshot.height) { element.style.visibility = 'hidden'; continue; }
      const width = element.offsetWidth, height = element.offsetHeight;
      const item = { key, role, n: speech ? Number(n) : -1, element, width, height, left: Math.max(8, Math.min(snapshot.width - width - 8, at.x - width / 2)) };
      columns.set(role, [...(columns.get(role) ?? []), item]);
    }
    for (const list of columns.values()) list.sort((x, y) => x.n - y.n);        // the job balloon (-1) first, then what was said, oldest to newest
    // a column too tall for the room above (or under) its character shows the newest lines only: the oldest go first
    for (const [role, list] of columns) {
      const at = snapshot!.positions[role], room = (at.y >= list.reduce((m, i) => Math.max(m, i.height), 0) + 20 ? at.y - 12 : snapshot!.height - (at.feet + 16)) - 8;
      const height = () => list.reduce((sum, i) => sum + i.height + TIGHT, 0);
      while (list.length > 1 && height() > room) { const old = list.findIndex(i => i.n >= 0); if (old < 0) break; list[old].element.style.visibility = 'hidden'; list.splice(old, 1); }
    }
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const free = (left: number, width: number, top: number, height: number) =>
      placed.filter(r => left < r.right + GAP && left + width > r.left - GAP && top < r.bottom + GAP && top + height > r.top - GAP);
    const H = snapshot?.height ?? 0, near = (role: string) => snapshot!.positions[role];
    const roles = [...columns.keys()];
    const lowerFirst = (r: string[]) => r.sort((x, y) => near(y).feet - near(x).feet);
    const tallest = (role: string) => columns.get(role)!.reduce((m, i) => Math.max(m, i.height), 0);
    const aboveRoles = lowerFirst(roles.filter(r => near(r).y >= tallest(r) + 20)), belowRoles = roles.filter(r => !aboveRoles.includes(r)).sort((x, y) => near(x).feet - near(y).feet);
    let index = 0;
    for (const role of [...aboveRoles, ...belowRoles]) {
      const at: At = near(role), list = columns.get(role)!;
      let below = !aboveRoles.includes(role), prev: { top: number; bottom: number } | null = null;
      for (const item of list) {
        const { element, width, height, left } = item;
        const slot = (down: boolean) => {                           // the nearest free spot after the previous balloon of this column (or by the head), stepping over others
          let top = down ? (prev ? prev.bottom + TIGHT : at.feet + 16) : (prev ? prev.top - height - TIGHT : at.y - height - 12);
          for (let guard = 0; guard < 12; guard++) {
            const hit = free(left, width, top, height);
            if (!hit.length) break;
            top = down ? Math.max(...hit.map(r => r.bottom)) + GAP : Math.min(...hit.map(r => r.top)) - height - GAP;
          }
          return top;
        };
        let top = slot(below);
        if (!prev) {                                                // the first balloon of a column may go to the other side when there is no room
          if (!below && top < 4) { const lower = slot(true); if (lower + height <= H - 4) { below = true; top = lower; } }
          else if (below && top + height > H - 4) { const upper = slot(false); if (upper >= 4) { below = false; top = upper; } }
        }
        top = Math.max(4, Math.min(H - height - 4, top));
        placed.push({ left, right: left + width, top, bottom: top + height });
        prev = { top, bottom: top + height };
        const stem = below ? top - (at.feet + 2) : (at.y - 2) - (top + height), stemmed = stem > 14;   // joins a balloon that is not next to its character
        element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
        element.style.zIndex = String(500 - index++);               // the stem of a higher balloon passes behind the ones below it
        element.style.setProperty('--tail-left', `${Math.max(16, Math.min(width - 16, at.x - left))}px`);
        element.style.setProperty('--stem', `${stemmed ? Math.round(stem) : 0}px`);
        element.classList.toggle('below', below);
        element.classList.toggle('stemmed', stemmed);
        element.style.visibility = 'visible';
      }
    }
  };
  // what a character says out loud (a call over, a line from a command) is shown here, above its job balloon, instead of in the canvas under it
  const [spoken, setSpoken] = useState<{ id: number; role: string; text: string }[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    const off = on('speech', ({ role, text, ms }: { role: string; text: string; ms?: number }) => {
      const id = ++counter.current;
      setSpoken(list => { const mine = list.filter(x => x.role === role), drop = mine.length >= 3 ? mine[0].id : -1; return [...list.filter(x => x.id !== drop), { id, role, text: String(text).slice(0, 120) }]; });   // at most three at a time: the oldest goes
      setTimeout(() => setSpoken(list => list.filter(x => x.id !== id)), Math.max(700, ms ?? 2600));
    });
    return () => { off(); };
  }, []);
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
        title={activity.party ? `Open party conversation` : `Open ${member.name}'s conversation`}
        onClick={event => {
          event.stopPropagation();
          if (activity.party) {
            play('ui.open');
            setState({ partyId: activity.party, talkingTo: null });
          } else {
            emit('talk', member.id);
          }
        }} onPointerDown={event => event.stopPropagation()}>
        <span className="ab-heading">
          <strong>{member.name}</strong>
          <span className="ab-heading-right">
            <span
              className={`ab-state ${activity.kind === 'done' ? 'ab-state-dismiss' : ''}`}
              title={activity.kind === 'done' ? 'Dismiss' : undefined}
              onClick={(e) => {
                if (activity.kind === 'done') {
                  e.stopPropagation();
                  setState(s => ({ activityNotes: { ...s.activityNotes, [member.id]: { text: '', at: 0 } } }));
                }
              }}
            >{label}</span>
            {(activity.kind === 'done' || activity.kind === 'error') && (
              <span
                role="button"
                tabIndex={0}
                className="ab-dismiss"
                title="Dismiss"
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  setState(s => ({ activityNotes: { ...s.activityNotes, [member.id]: { text: '', at: 0 } } }));
                }}
              >✕</span>
            )}
          </span>
        </span>
        <span className="ab-text">{activity.text}</span>
        {activity.image && <img className="ab-browser" src={`data:image/jpeg;base64,${activity.image}`} alt={`${member.name}'s live browser preview`} onLoad={place} />}
        {activity.kind === 'browser' && activity.site && <span className="ab-site">{activity.signed ? '🔒 ' : '🌐 '}{activity.site}<span>View only</span></span>}
      </button>;
    })}
    {spoken.map(x => <div key={x.id} className="agent-balloon speech" role="status" aria-label={`${crew.find(c => c.id === x.role)?.name ?? ''}: ${x.text}`}
      ref={element => { if (element) elements.current.set(`${x.role}~${x.id}`, element); else elements.current.delete(`${x.role}~${x.id}`); }} style={{ visibility: 'hidden' } as CSSProperties}>{x.text}</div>)}
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
        ? <button type="button" className="btn small primary" onClick={() => openRequest(ask)}>Open the request</button>
        : <>{answers.map((a: any) => <button key={a.id} type="button" className={`btn small ${a.id === 'once' ? 'primary' : ''}`} disabled={busy} title={a.hint} onClick={() => void answer(a.id)}>{label(a)}</button>)}
          <button type="button" className="link" onClick={() => openRequest(ask)}>Details</button></>}
    </span>
  </div>;
}
