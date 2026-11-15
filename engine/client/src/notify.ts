// The notification system: the one place that decides how the founder hears about something.
//  - "attention": someone needs the founder (a request for access). A short chime, plus a desktop notification if the window is out of sight.
//  - "done" / "error": a turn ended. No sound; a desktop notification only when the window is out of sight (the balloon shows it otherwise).
// The window title carries the number of requests waiting, "(2) OpenVorld". Both switches live in Settings and are kept on this computer.
import { play } from './audio/sfx';
import { emit, getState, subscribe } from './store';

export type NotifyKind = 'attention' | 'done' | 'error';
export type NotifyPrefs = { sound: boolean; desktop: boolean };
const KEY = 'ov.notify';

export function notifyPrefs(): NotifyPrefs {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { sound: v.sound !== false, desktop: v.desktop !== false }; }
  catch { return { sound: true, desktop: true }; }
}
export function setNotifyPrefs(patch: Partial<NotifyPrefs>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...notifyPrefs(), ...patch })); } catch { /* storage unavailable */ }
}

/** What one notification does: a sound only when someone needs the founder, a desktop notification only when the window is out of sight. */
export function notificationPlan(kind: NotifyKind, focused: boolean, prefs: NotifyPrefs = notifyPrefs()) {
  return { sound: kind === 'attention' && prefs.sound, desktop: !focused && prefs.desktop };
}

const windowFocused = () => typeof document !== 'undefined' && !document.hidden && document.hasFocus();

export function notify(n: { kind: NotifyKind; title: string; body?: string; role?: string }, opts: { force?: boolean } = {}) {
  const plan = notificationPlan(n.kind, opts.force ? false : windowFocused());
  if (plan.sound || (opts.force && notifyPrefs().sound)) play('notify.attention');
  if (plan.desktop) desktop(n);
}

function desktop({ kind, title, body, role }: { kind: NotifyKind; title: string; body?: string; role?: string }) {
  if (typeof Notification === 'undefined') return;
  const show = () => {
    try {
      const note = new Notification(title, { body, tag: `ov-${kind}-${role ?? ''}`, silent: true });      // the chime is ours: no second system sound
      note.onclick = () => { window.focus(); if (role) emit('talk', role); note.close(); };
    } catch { /* notifications are blocked here */ }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => { if (p === 'granted') show(); });
}

/** Keep the window title in step with the number of requests waiting for the founder. */
export function initNotifications() {
  const base = document.title.replace(/^\(\d+\) /, '');
  const apply = () => { const waiting = getState().openWrits.length; document.title = waiting ? `(${waiting}) ${base}` : base; };
  apply();
  const off = subscribe(apply);
  return () => { off(); document.title = base; };
}
