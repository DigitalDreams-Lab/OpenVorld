import { setState, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { Icon } from './Icon';

export function Hud({ onExit }: { onExit: () => void }) {
  const world = useStore((s) => s.world);
  const quests = useStore((s) => s.quests);
  const st = world.state;
  const span = Math.max(1, st.xpNext - st.xpThis);
  const pct = Math.max(0, Math.min(100, ((st.xp - st.xpThis) / span) * 100));
  const waiting = quests.filter((q) => q.status === 'waiting').length;
  const running = quests.filter((q) => q.status === 'running').length;
  const open = (modal: 'deeds' | 'settings' | 'quests') => { play('ui.open'); setState({ modal, questId: null }); };
  return (
    <div className="hud">
      <div className="hud-left panel">
        <Portrait role="founder" size={40} />
        <div>
          <div className="hud-title" title={st.title}><span className="ellip">{st.title}</span><span className="lv">Lv {st.level}</span></div>
          <div className="xpbar" title={`${st.xp} XP / ${st.xpNext}`}><i style={{ width: `${pct}%` }} /></div>
          <div className="hud-sub">{world.world.name}</div>
        </div>
      </div>
      <div className="hud-right">
        <button className="btn" onClick={() => open('quests')}><Icon name="scroll" size={18} /> Quests{running > 0 && <span className="hud-badge">{running} running</span>}{waiting > 0 && <span className="hud-badge alert">{waiting} need you</span>}</button>
        <button className="btn" onClick={() => open('deeds')}><Icon name="trophy" size={18} /> Deeds <b>{Object.keys(st.deeds ?? {}).length}</b>/{world.deeds.length}</button>
        <button className="btn" title="Settings" onClick={() => open('settings')}><Icon name="gear" size={18} /></button>
        <button className="btn" title="All worlds" onClick={() => { play('ui.click'); onExit(); }}><Icon name="home" size={18} /></button>
      </div>
    </div>
  );
}
