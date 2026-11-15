import type { ActivityNote, BrowserFrame, Live } from './store';

/** Keep the most recent prose, without exposing the agent's structured command envelope. */
export function lastActivityLine(value = '', limit = 170): string {
  const prose = value.replace(/```ov[\s\S]*$/, '').replace(/```[^\n]*\n?/g, '');
  const lines = prose.split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim()).filter(Boolean);
  const text = lines.at(-1) ?? '';
  return text.length > limit ? '…' + text.slice(-(limit - 1)).trimStart() : text;
}

const verbs: Record<string, string> = { 'tool.read': 'Reading', 'tool.search': 'Searching', 'tool.web': 'Browsing', 'tool.edit': 'Editing', 'tool.write': 'Writing', 'tool.run': 'Running', 'tool.world': 'Moving' };
export function liveActivityLine(turn: Live): string {
  for (const step of [...turn.steps].reverse()) {
    if (step.t === 'text' || step.t === 'thinking') { const text = lastActivityLine(step.text); if (text) return text; }
    if (step.t === 'tool') return lastActivityLine(`${step.status === 'error' ? 'Needs help with' : verbs[step.kind] ?? 'Using'} ${step.target || step.name}`, 170);
    if (step.t === 'plan') {
      const item = step.items?.find((item: any) => ['in_progress', 'running'].includes(item.status)) ?? step.items?.find((item: any) => item.status !== 'completed');
      if (item?.text) return lastActivityLine(item.text);
    }
  }
  return 'Working…';
}

export function agentActivity(role: string, turns: Record<string, Live>, browser?: BrowserFrame, now = Date.now(), note?: ActivityNote) {
  const turn = Object.values(turns).filter(turn => turn.role === role).sort((a, b) => Number(b.working) - Number(a.working) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const recent = !!note?.text.trim() && now - note.at < 6000;
  if (!turn?.working && !browser?.active && !recent) return null;
  let site = '';
  try { site = new URL(browser?.url ?? '').hostname; } catch { /* No page yet. */ }
  const text = turn?.working ? liveActivityLine(turn) : recent ? lastActivityLine(note?.text) : '';
  return {
    text: text || lastActivityLine(browser?.title) || (site ? `Browsing ${site}` : 'Browsing…'),
    kind: recent && note?.error && !turn?.working && !browser?.active ? 'error' : browser?.active ? 'browser' : turn?.working ? 'work' : 'done',
    image: browser?.active ? browser.image : undefined,
    site, signed: !!browser?.signed,
  };
}
