// Large live preview and interactive in-app browser for a crew member.
// View mode shows a big live stream of what the member sees; Interact mode forwards clicks, scroll, typing and
// navigation straight into their Playwright page (and saves sign-ins to their vault) without opening an external Chrome app.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';
import { memberOf, setState, toast, useStore } from '../store';

const SPECIAL_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
]);

export function BrowserModal() {
  const wid = useStore((s) => s.vorldId);
  const target = useStore((s) => s.browserModal);
  const frame = useStore((s) => (target ? s.browsers[target.role] : undefined));
  const member = memberOf(target?.role);

  const [interactive, setInteractive] = useState(!!target?.interactive);
  const [loading, setLoading] = useState(false);
  const [viewport, setViewport] = useState({ width: 1024, height: 640 });
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(target?.url ?? frame?.url ?? '');
  const [editingUrl, setEditingUrl] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interactiveRef = useRef(false);
  const wheelTimer = useRef<number | null>(null);
  const wheelDelta = useRef({ x: 0, y: 0 });

  const role = target?.role ?? '';
  const image = frame?.image ?? localImage;
  const currentUrl = frame?.url ?? target?.url ?? '';
  const signed = !!(frame?.signed || target?.signed);

  useEffect(() => {
    if (!editingUrl && currentUrl) setUrlInput(currentUrl);
  }, [currentUrl, editingUrl]);

  const startInteractive = async (opts?: { url?: string; signed?: boolean }) => {
    if (!wid || !role) return;
    setLoading(true);
    try {
      const r = await api(`/vorlds/${wid}/browser/${role}/interactive`, {
        body: { url: opts?.url ?? '', signed: opts?.signed ?? signed },
      });
      interactiveRef.current = true;
      setInteractive(true);
      if (r.viewport?.width && r.viewport?.height) setViewport(r.viewport);
      if (r.image) setLocalImage(r.image);
      if (r.url) setUrlInput(r.url);
      stageRef.current?.focus();
    } catch (e: any) {
      toast({ kind: 'error', title: e.message });
    } finally {
      setLoading(false);
    }
  };

  const stopInteractive = async (closeAfter = false) => {
    if (!wid || !role) return;
    const wasInteractive = interactiveRef.current;
    interactiveRef.current = false;
    setInteractive(false);
    if (wasInteractive) {
      await api(`/vorlds/${wid}/browser/${role}/interactive`, { method: 'DELETE' }).catch(() => {});
    }
    if (closeAfter) {
      play('ui.click');
      setState({ modal: null, browserModal: null });
    }
  };

  useEffect(() => {
    if (!wid || !role) return;
    if (target?.interactive || target?.url) {
      void startInteractive({ url: target.url, signed: !!target.signed });
    } else if (!frame?.image) {
      api(`/vorlds/${wid}/browser/${role}`).then((f) => { if (f?.image) setLocalImage(f.image); }).catch(() => {});
    }
    return () => {
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      if (interactiveRef.current) {
        interactiveRef.current = false;
        void api(`/vorlds/${wid}/browser/${role}/interactive`, { method: 'DELETE' }).catch(() => {});
      }
    };
  }, [wid, role]);

  if (!target || !wid) return null;

  const sendAction = async (action: Record<string, any>) => {
    try {
      const r = await api(`/vorlds/${wid}/browser/${role}/interact`, { body: action });
      if (r?.image) setLocalImage(r.image);
      if (r?.url && !editingUrl) setUrlInput(r.url);
    } catch (e: any) {
      toast({ kind: 'error', title: e.message });
    }
  };

  const onStageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!interactive) {
      void startInteractive();
      return;
    }
    stageRef.current?.focus();
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * viewport.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * viewport.height);
    void sendAction({ type: 'click', x, y, clickCount: e.detail >= 2 ? 2 : 1 });
  };

  const onStageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!interactive) return;
    e.preventDefault();
    wheelDelta.current.x += e.deltaX;
    wheelDelta.current.y += e.deltaY;
    if (wheelTimer.current) return;
    wheelTimer.current = window.setTimeout(() => {
      const { x, y } = wheelDelta.current;
      wheelDelta.current = { x: 0, y: 0 };
      wheelTimer.current = null;
      void sendAction({ type: 'wheel', deltaX: Math.round(x), deltaY: Math.round(y) });
    }, 90);
  };

  const onStageKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'a') { e.preventDefault(); void sendAction({ type: 'key', key: 'ControlOrMeta+a' }); }
      return;
    }
    if (SPECIAL_KEYS.has(e.key)) {
      if (e.key === 'Escape') return; // let Escape close the modal via global handler
      e.preventDefault();
      void sendAction({ type: 'key', key: e.key });
    } else if (e.key.length === 1) {
      e.preventDefault();
      void sendAction({ type: 'text', text: e.key });
    }
  };

  const onStagePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const text = e.clipboardData?.getData('text');
    if (text) {
      e.preventDefault();
      void sendAction({ type: 'text', text });
    }
  };

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setEditingUrl(false);
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!interactive) void startInteractive({ url: trimmed });
    else void sendAction({ type: 'goto', url: trimmed });
    stageRef.current?.focus();
  };

  const openExternalChrome = async () => {
    try {
      await stopInteractive(false);
      await api(`/vorlds/${wid}/crew/${role}/signin`, { body: { url: currentUrl || urlInput || '' } });
      toast({ kind: 'info', title: 'Opened external Chrome window' });
    } catch (e: any) {
      toast({ kind: 'error', title: e.message });
    }
  };

  return (
    <div className="modal-bg" onClick={() => void stopInteractive(true)}>
      <div className="panel modal browser-modal" role="dialog" aria-label={`${member?.name ?? 'Crew'} browser`} onClick={(e) => e.stopPropagation()}>
        <header className="bm-head">
          <div className="bm-title">
            <strong>{member?.name ?? 'Crew member'}’s browser</strong>
            <span className={`chip bm-badge ${interactive ? 'live' : ''}`}>
              {signed ? '🔒 Signed in' : '🌐 Browsing'} · {interactive ? 'Interactive' : 'Preview'}
            </span>
          </div>
          <div className="bm-actions">
            {interactive ? (
              <button type="button" className="btn small primary" disabled={loading} onClick={() => void stopInteractive(true)}>
                {signed ? 'Done & Save' : 'Done'}
              </button>
            ) : (
              <button type="button" className="btn small primary" disabled={loading} onClick={() => void startInteractive()}>
                Interact
              </button>
            )}
            <button type="button" className="btn small" title="Fallback: open in external Chrome if a site blocks embedded sign-in" onClick={() => void openExternalChrome()}>
              Open in Chrome
            </button>
            <button type="button" className="btn small" aria-label="Close browser preview" onClick={() => void stopInteractive(true)}>✕</button>
          </div>
        </header>

        <form className="bm-bar" onSubmit={submitUrl}>
          <button type="button" className="btn small" disabled={!interactive} title="Back" onClick={() => void sendAction({ type: 'back' })}>←</button>
          <button type="button" className="btn small" disabled={!interactive} title="Forward" onClick={() => void sendAction({ type: 'forward' })}>→</button>
          <button type="button" className="btn small" disabled={!interactive} title="Reload" onClick={() => void sendAction({ type: 'reload' })}>↻</button>
          <input
            className="field small bm-url"
            value={urlInput}
            readOnly={!interactive}
            placeholder="https://…"
            aria-label="Browser address"
            onFocus={() => setEditingUrl(true)}
            onBlur={() => setEditingUrl(false)}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          {interactive && <button type="submit" className="btn small">Go</button>}
        </form>

        {(frame?.needsHuman || interactive) && (
          <div className={`bm-banner ${frame?.needsHuman ? 'warn' : ''}`}>
            {frame?.needsHuman
              ? <><span>⚠ {frame.needsHuman.reason}</span>{!interactive && <button type="button" className="btn small primary" onClick={() => void startInteractive()}>Take over</button>}</>
              : <span>You’re in control — click, scroll, type or paste directly on the page below. {signed ? 'Your sign-in is saved automatically.' : 'Click Done when finished.'}</span>}
          </div>
        )}

        <div
          ref={stageRef}
          className={`bm-stage ${interactive ? 'interactive' : ''}`}
          tabIndex={0}
          onWheel={onStageWheel}
          onKeyDown={onStageKeyDown}
          onPaste={onStagePaste}
          aria-label={interactive ? 'Interactive browser view. Click, scroll, or type to interact.' : 'Browser preview. Click to interact.'}
        >
          {image ? (
            <img
              ref={imgRef}
              className="bm-img"
              src={`data:image/jpeg;base64,${image}`}
              alt={`${member?.name ?? 'Crew'} browser view`}
              draggable={false}
              onClick={onStageClick}
            />
          ) : (
            <div className="bm-empty">
              {loading ? 'Opening in-app browser…' : 'No page loaded yet. Click Interact to open a page here.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
