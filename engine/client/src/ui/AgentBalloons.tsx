// Agent activity lives with the character, rather than in an automatically opened side window.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { agentActivity } from '../activity';
import { emit, on, useStore } from '../store';

type Anchors = { width: number; height: number; positions: Record<string, { x: number; y: number }> };
export function AgentBalloons() {
  const crew: any[] = useStore(state => state.vorld?.crew ?? []);
  const live = useStore(state => state.live), browsers = useStore(state => state.browsers);
  const notes = useStore(state => state.activityNotes);
  const modal = useStore(state => state.modal);
  const [now, setNow] = useState(Date.now());
  const elements = useRef(new Map<string, HTMLButtonElement>()), anchors = useRef<Anchors | null>(null);
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
