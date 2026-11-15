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

/** What a notification did, so the test button can say so instead of leaving the founder guessing. */
export type NotifyResult = { sound: boolean; desktop: 'sent' | 'blocked' | 'unsupported' | 'off' | 'not-needed' };

export function notify(n: { kind: NotifyKind; title: string; body?: string; role?: string }, opts: { force?: boolean } = {}): Promise<NotifyResult> {
  const plan = notificationPlan(n.kind, opts.force ? false : windowFocused());
  const sound = plan.sound || (!!opts.force && notifyPrefs().sound);
  if (sound) play('notify.attention');
  if (!plan.desktop) return Promise.resolve({ sound, desktop: notifyPrefs().desktop ? 'not-needed' : 'off' });
  return desktop(n).then((desktop) => ({ sound, desktop }));
}

async function desktop({ kind, title, body, role }: { kind: NotifyKind; title: string; body?: string; role?: string }): Promise<NotifyResult['desktop']> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const show = (): NotifyResult['desktop'] => {
    try {
      const note = new Notification(title, { body, tag: `ov-${kind}-${role ?? ''}`, silent: true });      // the chime is ours: no second system sound
      note.onclick = () => { window.focus(); if (role) emit('talk', role); note.close(); };
      return 'sent';
    } catch { return 'blocked'; }
  };
  if (Notification.permission === 'granted') return show();
  if (Notification.permission === 'denied') return 'blocked';
  return (await Notification.requestPermission().catch(() => 'denied')) === 'granted' ? show() : 'blocked';
}

/** Keep the window title in step with the number of requests waiting for the founder. */
export function initNotifications() {
  const base = document.title.replace(/^\(\d+\) /, '');
  const apply = () => { const waiting = getState().openWrits.length; document.title = waiting ? `(${waiting}) ${base}` : base; };
  apply();
  const off = subscribe(apply);
  return () => { off(); document.title = base; };
}
