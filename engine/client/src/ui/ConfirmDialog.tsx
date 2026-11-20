// An in-app "are you sure?" (the browser's own confirm() is blocked in embedded webviews and looks foreign in the game).
// const [ask, dialog] = useConfirm();  ...  if (await ask({ title, body, ok: 'Remove', danger: true })) ...  render {dialog}
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

type Ask = { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean;
  /** An optional free-text box; its text is handed to onText when the person says yes. */
  input?: { label: string; placeholder?: string; max?: number }; onText?: (text: string) => void };

export function useConfirm(): [(a: Ask) => Promise<boolean>, ReactElement | null] {
  const [open, setOpen] = useState<(Ask & { done: (v: boolean) => void }) | null>(null);
  const [text, setText] = useState('');
  const ask = useCallback((a: Ask) => new Promise<boolean>((done) => { setText(''); setOpen({ ...a, done }); }), []);
  const answer = (v: boolean) => { if (v) open?.onText?.(text.trim()); open?.done(v); setOpen(null); };
  const ok = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) (open.input ? box.current : ok.current)?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); open.done(false); setOpen(null); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);
  const dialog = open ? (
    <div className="modal-bg confirm-bg" onPointerDown={(e) => e.stopPropagation()} onClick={() => answer(false)} role="presentation">
      <div className="modal panel confirm" role="alertdialog" aria-modal="true" aria-label={open.title} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <h3>{open.title}</h3>
        {open.body && <p className="muted">{open.body}</p>}
        {open.input && <label className="confirm-input"><span>{open.input.label}</span>
          <textarea dir="auto" ref={box} rows={4} maxLength={open.input.max} value={text} placeholder={open.input.placeholder} onChange={(e) => setText(e.target.value)} /></label>}
        <div className="row end">
          <button className="btn" onClick={() => answer(false)}>{open.cancel ?? 'Cancel'}</button>
          <button ref={ok} className={`btn ${open.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}>{open.ok ?? 'OK'}</button>
        </div>
      </div>
    </div>
  ) : null;
  return [ask, dialog];
}
