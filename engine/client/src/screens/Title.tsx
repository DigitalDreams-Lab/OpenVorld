import { play } from '../audio/sfx';
import { useState } from 'react';
import { About, BrandIcon } from '../ui/Brand';

export function Title({ vorlds, version, onOpen, onNew }: { vorlds: any[]; version: string; onOpen: (id: string) => void; onNew: () => void }) {
  const [about, setAbout] = useState(false);
  return (
    <div className="title-screen">
      <div className="title-card panel">
        <BrandIcon size={96} />
        <h1 className="logo">OpenVorld</h1>
        <p className="title-motto">Every project is a vorld.</p>
        <p className="tagline">A shared project. A crew of AI agents.<br />An adventure you run together.</p>
        <div className="vorld-list">
          {vorlds.map((w) => (
            <button key={w.id} className="vorld-item" disabled={!!w.newer} title={w.newer ? 'Saved by a newer OpenVorld: update OpenVorld to open it' : undefined} onClick={() => { play('ui.open'); onOpen(w.id); }}>
              <span className="vorld-name">{w.name}</span>
              {w.newer ? <span className="vorld-sub">Saved by a newer OpenVorld. Update OpenVorld to open it; nothing was changed.</span> : w.about && <span className="vorld-sub">{w.about}</span>}
            </button>
          ))}
          {!vorlds.length && <p className="muted">No vorlds yet. Create your first one.</p>}
        </div>
        <button className="btn primary big" onClick={() => { play('ui.click'); onNew(); }}>New vorld</button>
        <footer className="title-footer"><span>Local first · Open source</span><button className="link" onClick={() => setAbout(true)}>About OpenVorld <span className="muted">v{version}</span></button></footer>
      </div>
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}
