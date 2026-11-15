// The crew browser, in the game: a small window showing what a member's browser shows while they work. View only.
// It appears when a member opens a page, has a tab per member who has browsed, and can be minimised, enlarged or closed
// (it comes back the next time someone browses).
import { useEffect, useState } from 'react';
import { play } from '../audio/sfx';
import { useStore } from '../store';
import { Portrait } from './Portrait';

const shorten = (url = '') => { try { const u = new URL(url); return `${u.host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 64); } catch { return url.slice(0, 64); } };

export function BrowserDock() {
  const browsers = useStore((s) => s.browsers);
  const crew: any[] = useStore((s) => s.vorld?.crew ?? []);
  const panelOpen = useStore((s) => !!s.talkingTo);
  const roles = crew.map((c) => c.id).filter((id) => browsers[id]?.image);
  const [picked, setPicked] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const [big, setBig] = useState(false);
  const [closedAt, setClosedAt] = useState(0);
  const recent = [...roles].sort((a, b) => Number(browsers[b].active) - Number(browsers[a].active) || (browsers[b].at ?? 0) - (browsers[a].at ?? 0))[0];
  const current = picked && browsers[picked]?.image ? picked : recent;
  const frame = current ? browsers[current] : null;
  // a window you closed comes back when somebody browses again
  const newest = Math.max(0, ...roles.filter((r) => browsers[r].active).map((r) => browsers[r].at ?? 0));
  useEffect(() => { if (newest > closedAt && closedAt) setClosedAt(0); }, [newest, closedAt]);
  if (!frame || !current || closedAt) return null;
  const nameOf = (id: string) => crew.find((c) => c.id === id)?.name ?? id;
  return (
    <aside className={`browser-dock panel ${big ? 'big' : ''} ${mini ? 'mini' : ''} ${panelOpen ? 'beside' : ''}`} aria-label="Crew browser (view only)">
      <header className="bd-head">
        <span className={`bd-dot ${frame.active ? 'live' : ''}`} title={frame.active ? 'Browsing now' : 'Idle'} />
        <div className="bd-tabs" role="tablist">
          {roles.map((r) => (
            <button key={r} role="tab" aria-selected={r === current} className={`bd-tab ${r === current ? 'on' : ''}`} onClick={() => { play('ui.click'); setPicked(r); setMini(false); }}>
              <Portrait role={r} size={18} /> {nameOf(r)}{browsers[r].active ? ' ●' : ''}
            </button>
          ))}
        </div>
        <button className="bd-btn" aria-label={mini ? 'Show the browser' : 'Minimise the browser'} onClick={() => setMini(!mini)}>{mini ? '▢' : '–'}</button>
        {!mini && <button className="bd-btn" aria-label={big ? 'Smaller' : 'Larger'} onClick={() => setBig(!big)}>⤢</button>}
        <button className="bd-btn" aria-label="Close the browser window" onClick={() => setClosedAt(Date.now())}>✕</button>
      </header>
      {!mini && (
        <>
          <div className="bd-url" title={frame.url}>🌐 {shorten(frame.url)}</div>
          <img className="bd-shot" src={`data:image/jpeg;base64,${frame.image}`} alt={`${nameOf(current)}'s browser: ${frame.title || frame.url}`} />
          <footer className="bd-foot" title="View only">{frame.active ? 'Live' : 'Idle'} · {frame.title || 'untitled page'}</footer>
        </>
      )}
    </aside>
  );
}
