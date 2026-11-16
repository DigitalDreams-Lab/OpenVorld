import { useEffect, useRef } from 'react';
import { memberOf, openRequest, setState, useStore } from '../store';
import { IconButton } from './IconButton';
import { WritCard } from './WritCard';

const close = () => setState({ modal: null, request: null });

/** Open the approval itself, independent of whether it came from a party or a private chat. */
export function RequestDialog() {
  const ask = useStore(state => state.request), wid = useStore(state => state.vorldId);
  const pending = useStore(state => state.openWrits);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { element.close(); };
  }, [ask?.id]);
  useEffect(() => { if (ask && !pending.some(item => item.id === ask.id)) close(); }, [ask, pending]);
  if (!ask || !wid) return null;
  const who = memberOf(ask.role)?.name ?? ask.role;
  return <dialog ref={dialog} className="modal panel request-dialog" aria-label={`${who}'s request`}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="row between"><h2>{who}'s request</h2><IconButton icon="close" title="Close request" onClick={close} /></header>
    <WritCard key={ask.id} ask={ask} wid={wid} thread={ask.thread} who={who} />
  </dialog>;
}

/** Keep approvals reachable even when their card is in an older conversation or above the scroll. */
export function PendingRequests({ role, threads }: { role?: string; threads?: string[] }) {
  const pending = useStore(state => state.openWrits);
  const requests = pending.filter(ask => (!role || ask.role === role) && (!threads || threads.includes(ask.thread)));
  if (!requests.length) return null;
  return <div className="pending-requests" aria-label="Pending approvals">{requests.map(ask => {
    const who = memberOf(ask.role)?.name ?? ask.role;
    return <button key={ask.id} type="button" className="btn small primary" title={ask.scope} aria-label={`${who}: review request for ${ask.scope}`} onClick={() => openRequest(ask)}>{who}: review request</button>;
  })}</div>;
}
