// The game screen: the Phaser map underneath, React panels on top, live server events wired to both.
import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { api, artImage, connect } from '../api';
import { announceAsking, closeTop, emit, getState, on, setOpenWrits, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { initNotifications, notify } from '../notify';
import { VorldScene } from '../game/VorldScene';
import { PANELS } from '../game/commands';
import { loadGenerated } from '../game/pixels';
import { applyUiTheme, resetUiTheme, BODY_FONT } from '../theme';
import { Hud } from '../ui/Hud';
import { CrewBar } from '../ui/CrewBar';
import { MemberPanel } from '../ui/MemberPanel';
import { MemberSettings } from '../ui/MemberSettings';
import { PartyHall } from '../ui/PartyHall';
import { PartyPanel } from '../ui/PartyPanel';
import { Deeds } from '../ui/Deeds';
import { Settings } from '../ui/Settings';
import { RequestDialog } from '../ui/Requests';
import { BrowserModal } from '../ui/BrowserModal';
import { Toasts } from '../ui/Toasts';
import { AgentBalloons } from '../ui/AgentBalloons';
import { lastActivityLine } from '../activity';

export function Game({ wid, onExit }: { wid: string; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const vorld = useStore((s) => s.vorld);
  const talkingTo = useStore((s) => s.talkingTo);
  const modal = useStore((s) => s.modal);
  const partyId = useStore((s) => s.partyId);
  const [err, setErr] = useState<string | null>(null);

  // load the vorld, then start Phaser once the art and fonts are ready
  useEffect(() => {
    let game: Phaser.Game | null = null, dead = false;
    (async () => {
      try {
        const w = await api(`/vorlds/${wid}/vorld`);
        if (dead) return;
        await loadGenerated(w.art.atlas, (name) => artImage(name));
        setState({ vorldId: wid, vorld: w, talkingTo: null, modal: null, partyId: null, partyEdit: null, live: {}, browsers: {}, activityNotes: {}, openWrits: [], request: null });
        void loadOpenWrits(wid);                    // requests for access that were waiting before this window opened
        // what each member's browser last showed (a window opened after they stopped browsing)
        for (const c of w.crew) api(`/vorlds/${wid}/browser/${c.id}`).then((f) => { if (!dead && f?.image) handleBrowser({ ...f, role: c.id, active: false }); }).catch(() => {});
        applyUiTheme(w.theme.palette);
        await Promise.all(['400', '600', '700'].map((weight) => document.fonts.load(`${weight} 8px "${BODY_FONT}"`)));
        if (dead) return;
        game = new Phaser.Game({
          type: Phaser.AUTO, parent: host.current!, backgroundColor: w.theme.palette?.ink ?? '#111',
          scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
          render: { antialias: true, pixelArt: false, roundPixels: false },
          physics: { default: 'arcade', arcade: { debug: false } }, scene: [],
          input: { windowEvents: false },
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
      if (m.type === 'connection.restored') { setState((s) => ({ threadsVersion: s.threadsVersion + 1, live: {} })); void refreshVorld(); void loadOpenWrits(wid); }
      if (m.type === 'vorld') void refreshVorld().catch((e) => toast({ kind: 'error', title: e.message }));
      if (m.type === 'thread.event') handleThreadEvent(m);
      if (m.type === 'thread.deleted') {
        setOpenWrits((list) => list.filter((w) => w.thread !== m.thread));
        setState((s) => {
          const live = { ...s.live };
          delete live[m.thread];
          const activityNotes = Object.fromEntries(Object.entries(s.activityNotes).filter(([, note]) => note.thread !== m.thread));
          return { live, activityNotes, threadsVersion: s.threadsVersion + 1 };
        });
      }
      if (m.type === 'party.gather') emit('summon', { ids: m.members });
      if (m.type === 'browser') handleBrowser(m);
      if (m.type === 'profile') setState(s => ({ vorld: s.vorld ? { ...s.vorld, profile: m.profile } : s.vorld }));
      if (m.type === 'signin') emit('signin', m);
      if (m.type === 'game') handleGame(m);
      if (m.type === 'command') {
        emit('command', m);
        for (const c of m.commands ?? []) if (c.do === 'show' && PANELS[c.panel]) setState({ modal: PANELS[c.panel] });
      }
    });
    const offs = [
      on('talk', (role) => setState({ talkingTo: role })),
      on('scene-ready', announceAsking),          // a scene (re)started: tell it who is asking
      on('parties', () => setState({ modal: 'parties', partyEdit: null })),
    ];
    const stopBadge = initNotifications();
    return () => { close(); offs.forEach((o) => o()); stopBadge(); };
  }, [wid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState(closeTop); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (err) return <div className="fatal">{err} <button className="btn" onClick={onExit}>Back</button></div>;
  return (
    <div className="game">
      <div ref={host} className="phaser-host" />
      {vorld && <Hud onExit={onExit} />}
      {vorld && <CrewBar />}
      {vorld && <AgentBalloons />}
      {vorld && talkingTo && <MemberPanel key={`${wid}:${talkingTo}`} id={talkingTo} />}
      {vorld && partyId && <PartyPanel key={`${wid}:${partyId}`} id={partyId} hidden={!!talkingTo} />}
      {vorld && modal === 'parties' && <PartyHall />}
      {vorld && modal === 'deeds' && <Deeds />}
      {vorld && modal === 'settings' && <Settings />}
      {vorld && modal === 'request' && <RequestDialog />}
      {vorld && modal === 'browser' && <BrowserModal />}
      {vorld && modal === 'member' && talkingTo && <MemberSettings key={`settings:${talkingTo}`} id={talkingTo} />}
      <Toasts />
      {vorld && !talkingTo && !partyId && !modal && <div className="hint">WASD or click to walk · E to talk · the Party Hall stands in the plaza</div>}
    </div>
  );
}

/** Requests for access still waiting for the founder: their members walk over and ask. */
const loadOpenWrits = (wid: string) => api(`/vorlds/${wid}/writs/open`).then((list) => setOpenWrits(() => list)).catch(() => {});

/** A frame from a member's browser: keep the latest per member, and tell the map who is browsing right now. */
function handleBrowser(m: any) {
  setState((s) => {
    const next = { ...s.browsers };
    if (m.closed) delete next[m.role];
    else next[m.role] = {
      ...next[m.role],
      ...(m.image ? { url: m.url, title: m.title, image: m.image, signed: !!m.signed } : {}),
      active: !!m.active,
      interactive: !!m.interactive,
      needsHuman: m.needsHuman ?? null,
      at: Date.now(),
    };
    return { browsers: next };
  });
  const b = getState().browsers;
  emit('browsing', Object.keys(b).filter((r) => b[r].active));
}

const nameOf = (role?: string) => getState().vorld?.crew?.find((c: any) => c.id === role)?.name ?? 'Someone';
function handleThreadEvent(m: any) {
  const { thread, role, ev, kind, party } = m;
  const threadKind = kind ?? ev.thread?.kind;
  const partyId = party ?? ev.thread?.party;
  const put = (patch: any) => setState((s) => ({
    live: {
      ...s.live,
      [thread]: {
        ...(s.live[thread] ?? { steps: [], working: false }),
        role,
        thread,
        ...(threadKind ? { kind: threadKind } : {}),
        ...(partyId ? { party: partyId } : {}),
        updatedAt: Date.now(),
        ...patch
      }
    }
  }));
  const steps = () => [...(getState().live[thread]?.steps ?? [])];
  // steps grow in place: text and thinking append to the last step of their kind, tools update by id
  const grow = (type: 'text' | 'thinking', text: string) => {
    const list = steps(), last = list[list.length - 1];
    if (last?.t === type) list[list.length - 1] = { ...last, text: last.text + text }; else list.push({ t: type, text });
    put({ steps: list });
  };
  // The activity balloon owns work text; keep animations without stacking a second speech bubble.
  const react = (reaction: any) => { if (!reaction) return; emit('react', { role, reaction: { ...reaction, balloon: undefined, sfx: undefined } }); };      // animation only: the crew's work is silent
  switch (ev.type) {
    case 'turn.start': put({ steps: [], working: true, error: null }); emit('working', { role, working: true }); react(ev.reaction); break;
    case 'delta': grow('text', ev.text); break;
    case 'thinking': grow('thinking', ev.text); break;
    case 'plan': { const list = steps(), i = list.findIndex((s) => s.t === 'plan'); if (i >= 0) list[i] = { t: 'plan', items: ev.items }; else list.push({ t: 'plan', items: ev.items }); put({ steps: list }); break; }
    case 'tool': put({ steps: [...steps(), { t: 'tool', id: ev.id, kind: ev.kind, name: ev.name, target: ev.target, detail: ev.detail, status: 'running' }] }); react(ev.reaction); break;
    case 'tool_result': put({ steps: steps().map((s: any) => (s.t === 'tool' && s.id === ev.id ? { ...s, status: ev.ok ? 'ok' : 'error', output: ev.output, attachments: ev.attachments, ms: ev.ms, test: ev.test } : s)) }); react(ev.reaction); break;
    case 'writ.request':
      react(ev.reaction);
      setOpenWrits((list) => (list.some((w) => w.id === ev.id) ? list : [...list, { id: ev.id, thread, role: ev.role ?? role, capability: ev.capability, scope: ev.scope, why: ev.why, risk: ev.risk, signin: !!ev.signin }]));
      setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
      notify({ kind: 'attention', title: `${nameOf(ev.role ?? role)} needs your OK`, body: `${getState().vorld?.permissions?.capabilities?.[ev.capability]?.label ?? ev.capability} ${ev.scope ?? ''}`.trim(), role: ev.role ?? role });
      break;
    case 'writ.answered': setOpenWrits((list) => list.filter((w) => w.id !== ev.id)); setState((s) => ({ threadsVersion: s.threadsVersion + 1 })); break;
    case 'turn.done':
      put({ working: false, steps: [] });
      if (role) {
        const pId = partyId ?? getState().live[thread]?.party;
        setState(s => ({ activityNotes: { ...s.activityNotes, [role]: { text: lastActivityLine(ev.text) || ev.meta?.balloon || '', at: Date.now(), party: pId, thread } } }));
      }
      emit('working', { role, working: false });
      setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
      notify({ kind: 'done', title: `${nameOf(role)} is done`, body: lastActivityLine(ev.text), role });
      break;
    case 'turn.error':
      if (ev.stopped) {      // the founder stopped it (Stop, or a message sent over it): not a failure, nobody faints
        put({ working: false, error: null });
        emit('working', { role, working: false });
        setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
        break;
      }
      put({ working: false, error: ev.message });
      if (role) {
        const pId = partyId ?? getState().live[thread]?.party;
        setState(s => ({ activityNotes: { ...s.activityNotes, [role]: { text: ev.message || 'Something went wrong.', at: Date.now(), error: true, party: pId, thread } } }));
      }
      emit('working', { role, working: false }); react(ev.reaction ?? { anim: 'faint' });
      notify({ kind: 'error', title: `${nameOf(role)} hit a problem`, body: ev.message, role });
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
