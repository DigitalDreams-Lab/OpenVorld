// The game screen: the Phaser map underneath, React panels on top, live server events wired to both.
import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { api, artImage, connect } from '../api';
import { emit, getState, on, setState, str, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { VorldScene } from '../game/VorldScene';
import { PANELS } from '../game/commands';
import { loadGenerated } from '../game/pixels';
import { applyUiTheme, resetUiTheme, BODY_FONT } from '../theme';
import { Hud } from '../ui/Hud';
import { CrewBar } from '../ui/CrewBar';
import { MemberPanel } from '../ui/MemberPanel';
import { MemberSettings } from '../ui/MemberSettings';
import { QuestBoard, loadQuests } from '../ui/QuestBoard';
import { Deeds } from '../ui/Deeds';
import { Settings } from '../ui/Settings';
import { Toasts } from '../ui/Toasts';

export function Game({ wid, onExit }: { wid: string; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const vorld = useStore((s) => s.vorld);
  const talkingTo = useStore((s) => s.talkingTo);
  const modal = useStore((s) => s.modal);
  const [err, setErr] = useState<string | null>(null);

  // load the vorld, then start Phaser once the art and fonts are ready
  useEffect(() => {
    let game: Phaser.Game | null = null, dead = false;
    (async () => {
      try {
        const w = await api(`/vorlds/${wid}/vorld`);
        if (dead) return;
        await loadGenerated(w.art.atlas, (name) => artImage(name));
        setState({ vorldId: wid, vorld: w, talkingTo: null, modal: null, questId: null, live: {} });
        void loadQuests(wid);
        applyUiTheme(w.theme.palette);
        await Promise.all(['400', '600', '700'].map((weight) => document.fonts.load(`${weight} 8px "${BODY_FONT}"`)));
        if (dead) return;
        game = new Phaser.Game({
          type: Phaser.WEBGL, parent: host.current!, backgroundColor: w.theme.palette?.ink ?? '#111',
          scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
          render: { antialias: true, pixelArt: false, roundPixels: false },
          physics: { default: 'arcade', arcade: { debug: false } }, scene: [],
        });
        game.scene.add('vorld', VorldScene, true, { vorld: w });
        if (import.meta.env.DEV) (window as any).__ovGame = game;
      } catch (e: any) { setErr(e.message); }
    })();
    return () => { dead = true; game?.destroy(true); resetUiTheme(); };
  }, [wid]);

  // live events
  useEffect(() => {
    const refreshVorld = () => api(`/vorlds/${wid}/vorld`).then(async (w) => { await loadGenerated(w.art.atlas, (name) => artImage(name)); setState({ vorld: w }); emit('vorld', w); });
    const close = connect(wid, (m) => {
      if (m.type === 'connection.restored') { setState((s) => ({ threadsVersion: s.threadsVersion + 1, live: {} })); void refreshVorld(); void loadQuests(wid); }
      if (m.type === 'vorld') void refreshVorld().catch((e) => toast({ kind: 'error', title: e.message }));
      if (m.type === 'thread.event') handleThreadEvent(m);
      if (m.type === 'game') handleGame(m);
      if (m.type === 'quest') handleQuest(m);
      if (m.type === 'command') {
        emit('command', m);
        for (const c of m.commands ?? []) if (c.do === 'show' && PANELS[c.panel]) setState({ modal: PANELS[c.panel] });
      }
    });
    const offs = [
      on('talk', (role) => setState({ talkingTo: role })),
      on('quests', () => setState({ modal: 'quests', questId: null })),
    ];
    return () => { close(); offs.forEach((o) => o()); };
  }, [wid]);

  // a "!" over every member who waits for the founder (a seal or a writ)
  const quests = useStore((s) => s.quests);
  useEffect(() => { emit('attention', quests.filter((q) => q.status === 'waiting').map((q) => q.steps[q.run?.step]?.agent).filter(Boolean)); }, [quests]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState((s) => (s.modal ? { modal: null } : { talkingTo: null })); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (err) return <div className="fatal">{err} <button className="btn" onClick={onExit}>Back</button></div>;
  return (
    <div className="game">
      <div ref={host} className="phaser-host" />
      {vorld && <Hud onExit={onExit} />}
      {vorld && <CrewBar />}
      {vorld && talkingTo && <MemberPanel key={`${wid}:${talkingTo}`} id={talkingTo} />}
      {vorld && modal === 'quests' && <QuestBoard />}
      {vorld && modal === 'deeds' && <Deeds />}
      {vorld && modal === 'settings' && <Settings />}
      {vorld && modal === 'member' && talkingTo && <MemberSettings key={`settings:${talkingTo}`} id={talkingTo} />}
      <Toasts />
      {vorld && !talkingTo && !modal && <div className="hint">WASD or click to walk · E to talk · the Quest Board stands in the plaza</div>}
    </div>
  );
}

let letterTick = 0;
const shortLine = (t: string) => { const one = String(t ?? '').replace(/\s+/g, ' ').trim(); return one.length > 64 ? one.slice(0, 61) + '…' : one; };
function handleThreadEvent(m: any) {
  const { thread, role, ev } = m;
  const put = (patch: any) => setState((s) => ({ live: { ...s.live, [thread]: { ...(s.live[thread] ?? { steps: [], working: false }), role, ...patch } } }));
  const steps = () => [...(getState().live[thread]?.steps ?? [])];
  // steps grow in place: text and thinking append to the last step of their kind, tools update by id
  const grow = (type: 'text' | 'thinking', text: string) => {
    const list = steps(), last = list[list.length - 1];
    if (last?.t === type) list[list.length - 1] = { ...last, text: last.text + text }; else list.push({ t: type, text });
    put({ steps: list });
  };
  const react = (reaction: any) => { if (!reaction) return; play(reaction.sfx); emit('react', { role, reaction: { ...reaction, balloonText: reaction.balloon ? str(reaction.balloon, {}, '') : '' } }); };
  switch (ev.type) {
    case 'turn.start': put({ steps: [], working: true, error: null }); emit('working', { role, working: true }); react(ev.reaction); break;
    case 'delta': grow('text', ev.text); if (letterTick++ % 4 === 0) play('chat.letter'); break;
    case 'thinking': grow('thinking', ev.text); break;
    case 'plan': { const list = steps(), i = list.findIndex((s) => s.t === 'plan'); if (i >= 0) list[i] = { t: 'plan', items: ev.items }; else list.push({ t: 'plan', items: ev.items }); put({ steps: list }); break; }
    case 'tool': put({ steps: [...steps(), { t: 'tool', id: ev.id, kind: ev.kind, name: ev.name, target: ev.target, detail: ev.detail, status: 'running' }] }); react(ev.reaction); break;
    case 'tool_result': put({ steps: steps().map((s: any) => (s.t === 'tool' && s.id === ev.id ? { ...s, status: ev.ok ? 'ok' : 'error', output: ev.output, attachments: ev.attachments, ms: ev.ms, test: ev.test } : s)) }); react(ev.reaction); break;
    case 'writ.request': react(ev.reaction); setState((s) => ({ threadsVersion: s.threadsVersion + 1 })); break;
    case 'turn.done':
      put({ working: false, steps: [] });
      emit('working', { role, working: false });
      if (ev.meta?.balloon) emit('balloon', { role, text: ev.meta.balloon || shortLine(ev.text), ms: 3600 });
      setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
      play('ui.click');
      break;
    case 'turn.error':
      put({ working: false, error: ev.message });
      emit('working', { role, working: false }); react(ev.reaction ?? { anim: 'faint' });
      setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
      break;
    default: setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
  }
}

function handleGame(m: any) {
  setState((s) => ({ vorld: s.vorld ? { ...s.vorld, state: m.state } : s.vorld }));
  for (const n of m.notes ?? []) {
    if (n.type === 'deed') { play('achievement.rare'); toast({ kind: 'deed', title: n.name, body: n.desc, xp: n.xp, icon: n.icon }, 5500); }
    else if (n.type === 'level') { play('level.up'); toast({ kind: 'level', title: `Level ${n.level}`, body: n.title }); }
  }
}

const STATUS_TOAST: Record<string, string> = { done: 'Quest done', failed: 'Quest stopped on an error' };
function handleQuest(m: any) {
  if (m.removed) { setState((s) => ({ quests: s.quests.filter((q) => q.id !== m.removed) })); return; }
  const q = m.quest, before = getState().quests.find((x) => x.id === q.id);
  setState((s) => ({ quests: [q, ...s.quests.filter((x) => x.id !== q.id)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }));
  if (before?.status !== q.status || before?.run?.waiting !== q.run?.waiting) {
    if (STATUS_TOAST[q.status]) { toast({ kind: 'quest', title: `${STATUS_TOAST[q.status]}: ${q.title}` }); play(q.status === 'done' ? 'trial.passed' : 'ui.error'); }
    if (q.status === 'waiting') { toast({ kind: 'quest', title: q.run.waiting === 'seal' ? `Your seal is needed: ${q.title}` : `Access requested: ${q.title}`, body: 'Open the Quest Board.' }, 6000); play('writ.request'); }
  }
}
