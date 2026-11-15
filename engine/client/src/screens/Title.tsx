import { play } from '../audio/sfx';

export function Title({ worlds, version, onOpen, onNew }: { worlds: any[]; version: string; onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <div className="title-screen">
      <div className="title-card panel">
        <h1 className="logo">openVorld</h1>
        <p className="tagline">Run your work like a game. Your AI crew runs the quests.</p>
        <div className="world-list">
          {worlds.map((w) => (
            <button key={w.id} className="world-item" onClick={() => { play('ui.open'); onOpen(w.id); }}>
              <span className="world-name">{w.name}</span>
              {w.about && <span className="world-sub">{w.about}</span>}
            </button>
          ))}
          {!worlds.length && <p className="muted">No world yet. Found your first one.</p>}
        </div>
        <button className="btn primary big" onClick={() => { play('ui.click'); onNew(); }}>Found a new world</button>
        <p className="muted small">v{version}</p>
      </div>
    </div>
  );
}
