// Deeds: the achievements of this vorld. Hidden ones show only their hint until found.
import { setState, useStore } from '../store';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export function Deeds() {
  const vorld = useStore((s) => s.vorld);
  const got = vorld.state.deeds ?? {};
  return (
    <div className="modal-bg" onPointerDown={(e) => e.stopPropagation()} onClick={() => setState({ modal: null })}>
      <div className="modal panel deeds" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <header className="row between"><h2>Deeds <small>{Object.keys(got).length}/{vorld.deeds.length}</small></h2><IconButton icon="close" title="Close" onClick={() => setState({ modal: null })} /></header>
        <p className="muted">Level {vorld.state.level} · {vorld.state.xp} XP. XP comes from jobs your parties finish and a little from chatting.</p>
        <div className="deed-grid">
          {vorld.deeds.map((d: any) => {
            const done = !!got[d.id], secret = d.hidden && !done;
            return (
              <div key={d.id} className={`deed ${done ? 'done' : 'locked'}`}>
                <Icon name={secret ? 'eye' : d.icon ?? 'trophy'} size={28} />
                <div className="deed-name">{secret ? '???' : d.name}</div>
                <div className="deed-desc">{secret ? d.hint ?? 'A hidden deed.' : d.desc}</div>
                <div className="deed-meta">{d.xp} XP{done ? ` · ${new Date(got[d.id]).toLocaleDateString()}` : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
