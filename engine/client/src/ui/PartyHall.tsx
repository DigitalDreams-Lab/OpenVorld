// The Party Hall: your parties. A party is a name, a goal and one or more crew members who work together in one shared
// chat. The first member leads: they answer first, and hand work to the others.
import { IconButton } from './IconButton';
import { useState } from 'react';
import { api } from '../api';
import { emit, setState, toast, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { useConfirm } from './ConfirmDialog';

const close = () => setState({ modal: null, partyEdit: null });

export function PartyHall() {
  const vorld = useStore((s) => s.vorld);
  const edit = useStore((s) => s.partyEdit);
  const parties: any[] = vorld.parties ?? [];
  const open = (id: string) => { play('ui.open'); setState({ modal: null, partyEdit: null, talkingTo: null, partyId: id }); };
  const editing = edit === null ? null : edit === '' ? {} : parties.find((p) => p.id === edit) ?? null;
  return (
    <div className="modal-bg" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
      <div className="modal panel party-hall" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <header className="row between">
          <h2>{editing ? (editing.id ? 'Edit party' : 'New party') : 'Party Hall'}</h2>
          <span className="row">
            {editing && <button className="btn small" onClick={() => setState({ partyEdit: null })}>← All parties</button>}
            <IconButton icon="close" title="Close" onClick={close} />
          </span>
        </header>
        {editing
          ? <PartyForm key={editing.id ?? 'new'} party={editing} onDone={(id) => { setState({ partyEdit: null }); if (id) open(id); }} />
          : (
            <>
              <p className="muted">A party is a group of crew members with a goal, working together in one shared chat. Write in the chat and they gather, answer and hand work to each other until the job is done.</p>
              <div className="party-list">
                {parties.length === 0 && <p className="empty">No parties yet. Form one: give it a name, a goal and the members.</p>}
                {parties.map((p) => (
                  <div key={p.id} className="party-item">
                    <div><div className="party-title">{p.name}</div></div>
                    <div className="party-crew">{p.members.map((m: string, i: number) => <span key={m} className={i === 0 ? 'lead' : ''} title={i === 0 ? 'leader' : ''}><Portrait role={m} size={28} /></span>)}</div>
                    {p.goal && <p className="party-goal muted">{p.goal}</p>}
                    <div className="row"><button className="btn small primary" onClick={() => open(p.id)}>Open chat</button><button className="btn small" onClick={() => setState({ partyEdit: p.id })}>Edit</button></div>
                  </div>
                ))}
              </div>
              <div className="row end"><button className="btn primary" onClick={() => { play('ui.click'); setState({ partyEdit: '' }); }}>+ New party</button></div>
            </>
          )}
      </div>
    </div>
  );
}

function PartyForm({ party, onDone }: { party: any; onDone: (openId?: string) => void }) {
  const wid = useStore((s) => s.vorldId)!;
  const crew: any[] = useStore((s) => s.vorld.crew);
  const [name, setName] = useState<string>(party.name ?? '');
  const [goal, setGoal] = useState<string>(party.goal ?? '');
  const [members, setMembers] = useState<string[]>(party.members ?? []);
  const [busy, setBusy] = useState(false);
  const [confirm, dialog] = useConfirm();
  const apply = (w: any) => { setState({ vorld: w }); emit('vorld', w); };
  const toggle = (id: string) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const save = async () => {
    setBusy(true);
    try {
      const body = { name, goal, members };
      const w = party.id ? await api(`/vorlds/${wid}/parties/${party.id}`, { method: 'PUT', body }) : await api(`/vorlds/${wid}/parties`, { body });
      apply(w); play('seal.approved'); onDone(party.id ? undefined : w.added);
    } catch (e: any) { toast({ kind: 'error', title: e.message }); play('ui.error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Disband ${party.name}?`, body: 'The party is removed. Its chats stay on your disk.', ok: 'Disband', danger: true }))) return;
    try { apply(await api(`/vorlds/${wid}/parties/${party.id}`, { method: 'DELETE' })); onDone(); } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <form className="party-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>Name<input className="field" autoFocus value={name} maxLength={60} placeholder="e.g. Launch crew" onChange={(e) => setName(e.target.value)} /></label>
      <label>Goal<textarea className="field" rows={3} value={goal} maxLength={2000} placeholder="What this party is here to get done" onChange={(e) => setGoal(e.target.value)} /></label>
      <div>
        <b className="small">Members</b> <span className="muted small">(the first one you pick leads)</span>
        <div className="party-pick">
          {crew.map((c) => {
            const at = members.indexOf(c.id);
            return <button type="button" key={c.id} className={`chip ${at >= 0 ? 'on' : ''}`} onClick={() => toggle(c.id)}>{at === 0 ? '♛ ' : at > 0 ? `${at + 1}. ` : ''}{c.name}{c.job ? ` · ${c.job}` : ''}</button>;
          })}
        </div>
      </div>
      <div className="row between">
        {party.id ? <button type="button" className="btn danger" onClick={remove}>Disband</button> : <span />}
        <span className="row"><button type="button" className="btn" onClick={() => onDone()}>Cancel</button><button className="btn primary" disabled={busy || !name.trim() || !members.length}>{party.id ? 'Save' : 'Form the party'}</button></span>
      </div>
      {dialog}
    </form>
  );
}
