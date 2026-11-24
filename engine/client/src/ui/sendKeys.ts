// What a key press in the composer means while a member may be working.
export type SendMode = 'send' | 'queue';
type KeyLike = { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/** Enter sends now (and interrupts a working member); Ctrl+Enter / Cmd+Enter queues behind the running turn; Shift+Enter is a new line. */
export function sendModeOf(e: KeyLike): SendMode | null {
  if (e.key !== 'Enter' || e.shiftKey) return null;
  return e.ctrlKey || e.metaKey ? 'queue' : 'send';
}

/** The composer's main button: Stop while a member works and nothing is typed; Send as soon as there is something to say. */
export const mainAction = (working: boolean, hasContent: boolean): 'stop' | 'send' => (working && !hasContent ? 'stop' : 'send');

/** Ctrl+Enter only queues while a member is working; when idle there is nothing to wait for, so it sends like Enter. */
export const effectiveMode = (mode: SendMode, working: boolean): SendMode => (working ? mode : 'send');
