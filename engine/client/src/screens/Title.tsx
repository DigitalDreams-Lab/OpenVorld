import { play } from '../audio/sfx';

export function Title({ vorlds, version, onOpen, onNew }: { vorlds: any[]; version: string; onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <div className="title-screen">
      <div className="title-card panel">
        <h1 className="logo">OpenVorld</h1>
        <p className="tagline">Every project is a vorld: one shared folder, a crew of AI agents, and the parties they run together.</p>
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
        <p className="muted small">v{version}</p>
      </div>
    </div>
  );
}
