// The Quest Board: the crew's workflows. A quest is a goal and steps; each step goes to one crew member and hands its
// result to the next. A step with a Seal waits for you to approve it (or send it back with a note) before the quest goes on.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { memberOf, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { ThreadView } from './Thread';
import { Markdown } from './Chat';
import { useConfirm } from './ConfirmDialog';

const STATUS: Record<string, string> = { draft: 'Ready', running: 'Running', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
const close = () => setState({ modal: null, questId: null });

/** Load the quest list into the store (the live `quest` events keep it fresh). */
export async function loadQuests(wid: string) {
  try { setState({ quests: await api(`/vorlds/${wid}/quests`) }); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
}

export function QuestBoard() {
  const wid = useStore((s) => s.vorldId)!;
  const quests = useStore((s) => s.quests);
  const questId = useStore((s) => s.questId);
  const [editing, setEditing] = useState<any | null>(null);    // a quest being written ({} = new)
  useEffect(() => { void loadQuests(wid); }, [wid]);
  const open = quests.find((q) => q.id === questId);
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal panel quest-board" onClick={(e) => e.stopPropagation()}>
        <header className="row between">
          <h2>{editing ? (editing.id ? 'Edit quest' : 'New quest') : open ? open.title : 'Quest Board'}</h2>
          <span className="row">
            {(open || editing) && <button className="btn small" onClick={() => { setEditing(null); setState({ questId: null }); }}>← All quests</button>}
            <button className="x" onClick={close} aria-label="Close">✕</button>
          </span>
        </header>
        {editing ? <QuestEditor wid={wid} quest={editing} onDone={(q) => { setEditing(null); setState({ questId: q?.id ?? null }); void loadQuests(wid); }} />
          : open ? <QuestRun wid={wid} q={open} onEdit={() => setEditing(open)} />
          : <QuestList quests={quests} onNew={() => setEditing({})} />}
      </div>
    </div>
  );
}

function QuestList({ quests, onNew }: { quests: any[]; onNew: () => void }) {
  return (
    <div className="quest-list">
      <p className="muted">A quest is a workflow: steps your crew runs one after another, each handing its result to the next. Ask your companion to draft one, or write it here.</p>
      {quests.map((q) => (
        <button key={q.id} className={`quest-item st-${q.status}`} onClick={() => { play('ui.open'); setState({ questId: q.id }); }}>
          <span className="quest-title">{q.title}</span>
          <span className="quest-crew">{q.steps.map((s: any, i: number) => <Portrait key={i} role={s.agent} size={22} />)}</span>
          <span className={`quest-status st-${q.status}`}>{STATUS[q.status] ?? q.status}{q.status === 'waiting' ? (q.run?.waiting === 'seal' ? ' · seal' : ' · access') : ''}</span>
        </button>
      ))}
      {!quests.length && <p className="muted">No quests yet.</p>}
      <div className="row end"><button className="btn primary" onClick={onNew}>+ New quest</button></div>
    </div>
  );
}

function QuestEditor({ wid, quest, onDone }: { wid: string; quest: any; onDone: (q: any | null) => void }) {
  const crew = useStore((s) => s.vorld.crew);
  const agents = crew.filter((c: any) => c.role === 'agent');
  const [f, setF] = useState(() => ({ title: quest.title ?? '', goal: quest.goal ?? '', steps: quest.steps?.map((s: any) => ({ ...s })) ?? [{ agent: agents[0]?.id ?? crew[0]?.id, task: '', seal: false }] }));
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const setStep = (i: number, patch: any) => setF((x) => ({ ...x, steps: x.steps.map((s: any, k: number) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) => setF((x) => { const steps = [...x.steps]; const [s] = steps.splice(i, 1); steps.splice(i + d, 0, s); return { ...x, steps }; });
  const save = async () => {
    setBusy(true);
    try {
      const q = await api(`/vorlds/${wid}/quests${quest.id ? `/${quest.id}` : ''}`, { method: quest.id ? 'PUT' : 'POST', body: f });
      play('seal.approved'); onDone(q);
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await ask({ title: `Delete "${quest.title}"?`, body: 'The quest leaves the board. Its chats stay with each crew member.', ok: 'Delete', danger: true }))) return;
    try { await api(`/vorlds/${wid}/quests/${quest.id}`, { method: 'DELETE' }); onDone(null); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <div className="quest-editor">
      <label>Title<input className="field" value={f.title} maxLength={80} placeholder="e.g. Weekly newsletter" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Goal<textarea className="field" rows={2} value={f.goal} maxLength={2000} placeholder="What the whole quest delivers. Every step sees this." onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
      <h3>Steps</h3>
      <ol className="step-edit-list">
        {f.steps.map((s: any, i: number) => (
          <li key={i} className="step-edit">
            <div className="row">
              <Portrait role={s.agent} size={28} />
              <select className="field" value={s.agent} onChange={(e) => setStep(i, { agent: e.target.value })}>
                {crew.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.job ? ` · ${c.job}` : ''}</option>)}
              </select>
              <label className="seal-toggle" title="You approve this step's result before the quest goes on"><input type="checkbox" checked={!!s.seal} onChange={(e) => setStep(i, { seal: e.target.checked })} /> Seal</label>
              <span className="grow" />
              <button className="x" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="x" disabled={i === f.steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button className="x" disabled={f.steps.length < 2} onClick={() => setF({ ...f, steps: f.steps.filter((_: any, k: number) => k !== i) })} aria-label="Remove step">✕</button>
            </div>
            <textarea className="field" rows={2} value={s.task} maxLength={2000} placeholder="What this step does" onChange={(e) => setStep(i, { task: e.target.value })} />
          </li>
        ))}
      </ol>
      <div className="row between">
        <span className="row">
          <button className="btn small" disabled={f.steps.length >= 20} onClick={() => setF({ ...f, steps: [...f.steps, { agent: f.steps.at(-1)?.agent ?? agents[0]?.id, task: '', seal: false }] })}>+ Step</button>
          {quest.id && <button className="btn small danger" onClick={remove}>Delete quest</button>}
        </span>
        <span className="row"><button className="btn" onClick={() => onDone(quest.id ? quest : null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save quest</button></span>
      </div>
      {dialog}
    </div>
  );
}

function QuestRun({ wid, q, onEdit }: { wid: string; q: any; onEdit: () => void }) {
  const [step, setStep] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const run = q.run;
  const active = q.status === 'running' || q.status === 'waiting';
  const shown = step ?? (run ? run.step : null);
  const call = async (action: string, body: any = {}) => {
    try { await api(`/vorlds/${wid}/quests/${q.id}/${action}`, { body }); play(action === 'seal' ? 'seal.approved' : 'ui.open'); if (action === 'start') setStep(null); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); }
  };
  const noBrain = q.steps.filter((s: any) => !memberOf(s.agent)?.brain || memberOf(s.agent)?.brain?.provider === 'none').map((s: any) => memberOf(s.agent)?.name ?? s.agent);
  const stateOf = (i: number) => !run ? 'todo' : i < run.step || (i === run.step && q.status === 'done') ? 'done' : i === run.step ? (q.status === 'waiting' ? 'waiting' : q.status === 'running' ? 'running' : q.status) : 'todo';
  return (
    <div className="quest-run">
      {q.goal && <div className="quest-goal"><Markdown text={q.goal} /></div>}
      <div className="quest-steps">
        {q.steps.map((s: any, i: number) => {
          const m = memberOf(s.agent);
          return (
            <button key={s.id ?? i} className={`quest-step ${stateOf(i)} ${shown === i ? 'on' : ''}`} disabled={!run?.threads?.[i]} onClick={() => setStep(i)}>
              <span className="qs-n">{i + 1}</span>
              <Portrait role={s.agent} size={28} />
              <span className="qs-body"><b>{m?.name ?? s.agent}</b> {s.seal && <span className="seal-tag" title="Needs your seal">✦ seal</span>}<span className="qs-task">{s.task}</span></span>
              <span className="qs-state">{stateOf(i) === 'todo' ? '' : stateOf(i)}</span>
            </button>
          );
        })}
      </div>

      {q.status === 'waiting' && run?.waiting === 'seal' && (
        <div className="seal-box">
          <b>✦ {memberOf(q.steps[run.step].agent)?.name} needs your seal on step {run.step + 1}.</b>
          <p className="muted">Read the result below. Approve it to move on, or send it back with what to change.</p>
          <textarea className="field" rows={2} value={note} placeholder="What should change? (only when sending it back)" onChange={(e) => setNote(e.target.value)} />
          <div className="row end">
            <button className="btn" disabled={!note.trim()} onClick={() => { void call('seal', { approve: false, note }); setNote(''); }}>Send back</button>
            <button className="btn primary" onClick={() => call('seal', { approve: true })}>Seal and continue</button>
          </div>
        </div>
      )}
      {q.status === 'waiting' && run?.waiting === 'writ' && <div className="seal-box"><b>🔑 {memberOf(q.steps[run.step].agent)?.name} asks for access.</b><p className="muted">Answer the request in the step below; the quest goes on after your answer.</p></div>}
      {q.status === 'failed' && <div className="seal-box err"><b>✖ The quest stopped at step {run.step + 1}.</b><p>{run.error}</p></div>}
      {q.status === 'done' && <div className="seal-box ok"><b>✓ Quest done.</b> The last step holds the final result.</div>}
      {!active && noBrain.length > 0 && <p className="muted warn">No brain yet for {noBrain.join(', ')}: those steps only get a placeholder answer. Pick a brain in their settings (⚙).</p>}

      <div className="row between quest-actions">
        <span className="muted">{q.runs ? `Run ${q.runs}` : 'Never run'}</span>
        <span className="row">
          {!active && <button className="btn" onClick={onEdit}>Edit</button>}
          {(q.status === 'failed' || q.status === 'stopped') && <button className="btn" onClick={() => call('retry')}>Retry step</button>}
          {active ? <button className="btn danger" onClick={() => call('stop')}>Stop</button>
            : <button className="btn primary" onClick={() => call('start')}>{q.runs ? 'Run again' : 'Run quest'}</button>}
        </span>
      </div>
      {shown !== null && run?.threads?.[shown] && (
        <div className="quest-thread">
          <h3>Step {shown + 1} · {memberOf(q.steps[shown]?.agent)?.name}</h3>
          <ThreadView key={run.threads[shown]} wid={wid} tid={run.threads[shown]} canSend={!(q.status === 'running' && shown === run.step)} placeholder="Talk about this step…" />
        </div>
      )}
    </div>
  );
}
