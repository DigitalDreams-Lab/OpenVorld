import { setState, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { Icon } from './Icon';

export function Hud({ onExit }: { onExit: () => void }) {
  const vorld = useStore((s) => s.vorld);
  const parties = vorld.parties ?? [];
  const st = vorld.state;
  const span = Math.max(1, st.xpNext - st.xpThis);
  const pct = Math.max(0, Math.min(100, ((st.xp - st.xpThis) / span) * 100));
  const open = (modal: 'deeds' | 'settings' | 'parties') => { play('ui.open'); setState({ modal, partyEdit: null }); };
  return (
    <div className="hud" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="hud-left panel">
        <button type="button" className="hud-profile" title="Edit your profile" onClick={() => open('settings')}><Portrait role="founder" size={40} /></button>
        <div>
          <div className="hud-title" title={vorld.profile?.name ? `${vorld.profile.name} · ${st.title}` : st.title}><span className="ellip" dir="auto">{vorld.profile?.name || st.title}</span><span className="lv">Lv {st.level}</span></div>
          <div className="xpbar" title={`${st.xp} XP / ${st.xpNext}`}><i style={{ width: `${pct}%` }} /></div>
          <div className="hud-sub"><span className="ellip" dir="auto">{vorld.vorld.name}</span>{vorld.profile?.name && <small className="hud-rank"> · {st.title}</small>}</div>
        </div>
      </div>
      <div className="hud-right">
        <button className="btn" onClick={() => open('parties')}><Icon name="users" size={18} /> Parties <b>{parties.length}</b></button>
        <button className="btn" onClick={() => open('deeds')}><Icon name="trophy" size={18} /> Deeds <b>{Object.keys(st.deeds ?? {}).length}</b>/{vorld.deeds.length}</button>
        <button className="btn" title="Settings" onClick={() => open('settings')}><Icon name="gear" size={18} /></button>
        <button className="btn" title="All vorlds" onClick={() => { play('ui.click'); onExit(); }}><Icon name="home" size={18} /></button>
      </div>
    </div>
  );
}
