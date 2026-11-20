// How a crew member's turn reads in the chat, the same for every brain (Claude Code, Codex, API models):
// prose in a bubble (light Markdown), and between the prose a compact activity log of what they did —
// thinking, a plan, each tool call with its status, time and an expandable result or edit.
import { Fragment, useMemo, useState } from 'react';
import { Markdown } from './Markdown';
import { MessageFiles, type Attachment } from './MessageFiles';
import { emit, memberOf, str, useStore } from '../store';
import { play } from '../audio/sfx';
import { Portrait } from './Portrait';
import { Icon } from './Icon';

export type Step =
  | { t: 'text'; text: string }
  | { t: 'thinking'; text: string }
  | { t: 'plan'; items: { text: string; status: string }[] }
  | { t: 'tool'; id: string; kind: string; name: string; target?: string; detail?: any; status: 'running' | 'ok' | 'error' | 'stopped'; output?: string; attachments?: Attachment[]; ms?: number | null; test?: 'pass' | 'fail' | null };

const VERB: Record<string, string> = { 'tool.read': 'Read', 'tool.search': 'Search', 'tool.web': 'Web', 'tool.edit': 'Edit', 'tool.write': 'Write', 'tool.run': 'Run' };
const ENVELOPE = /```ov[\s\S]*$/;

/** One turn of a crew member: portrait + interleaved bubbles and activity. */
/** @Name of a crew member shown in bold, so a hand-over stands out in a group chat. */
const boldMentions = (text: string, names: string[]) => names.reduce((t, n) => t.replace(new RegExp(`@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu'), (m) => `**${m}**`), text);

export function AgentTurn({ role, steps, text, mood, did, noted, speaker, job, live, root, thread, mentions }: { role: string; mentions?: string[]; did?: string[]; noted?: string[]; steps?: Step[]; text?: string; mood?: string; speaker?: string; job?: string; live?: boolean; root?: string; thread?: string }) {
  const vorld = useStore((s) => s.vorld);
  const list: Step[] = steps?.length ? steps : text ? [{ t: 'text', text }] : [];
  // consecutive non-text steps form one activity block
  const blocks = useMemo(() => {
    const out: ({ kind: 'text'; text: string } | { kind: 'act'; steps: Step[] })[] = [];
    for (const s of list) {
      if (s.t === 'text') { const t = s.text.replace(ENVELOPE, '').trim(); if (t) out.push({ kind: 'text', text: mentions?.length ? boldMentions(t, mentions) : t }); continue; }
      const last = out[out.length - 1];
      if (last?.kind === 'act') last.steps.push(s); else out.push({ kind: 'act', steps: [s] });
    }
    return out;
  }, [list]);
  const lastIsText = blocks[blocks.length - 1]?.kind === 'text';
  // in a party room the speaker's name and portrait open that member's own chat (the map's 'talk' path)
  const hint = speaker && memberOf(role) ? str('chat.open_member', { name: speaker }, 'Chat with {name}') : '';
  const open = () => { play('ui.open'); emit('talk', role); };
  const portrait = <Portrait vorld={vorld} role={role} size={32} mood={live ? 'thinking' : mood} />;
  return (
    <div className="msg them turn">
      {hint ? <button type="button" className="who" title={hint} tabIndex={-1} aria-hidden onClick={open}>{portrait}</button> : portrait}      {/* the name is the one tab stop */}
      <div className="turn-body">
        {speaker && (hint
          ? <button type="button" className="speaker who" title={hint} onClick={open}><b dir="auto">{speaker}</b>{job && <span className="job-tag" dir="auto">{job}</span>}</button>
          : <b className="speaker"><bdi>{speaker}</bdi>{job && <span className="job-tag" dir="auto">{job}</span>}</b>)}
        {blocks.map((b, i) => b.kind === 'text'
          ? <div key={i} className="bubble"><Markdown text={b.text} thread={thread} />{live && i === blocks.length - 1 && <span className="caret">▌</span>}</div>
          : <Activity key={i} steps={b.steps} live={!!live && i === blocks.length - 1} root={root} />)}
        {did && did.length > 0 && <div className="turn-did" title="What they did in the vorld">{did.map((d, i) => <span key={i} dir="auto">{d}</span>)}</div>}
        {noted && noted.length > 0 && <div className="turn-did noted" title={str('memory.noted', {}, 'Kept in their notebook')}>{noted.map((d, i) => <span key={i} dir="auto">{d}</span>)}</div>}
        {live && !blocks.length && <div className="bubble"><span className="dots">…</span><span className="caret">▌</span></div>}
        {live && blocks.length > 0 && !lastIsText && <div className="turn-working"><span className="spin" /> {str('chat.working', {}, 'working')}…</div>}
      </div>
    </div>
  );
}

function Activity({ steps, live, root }: { steps: Step[]; live: boolean; root?: string }) {
  const vorld = useStore((s) => s.vorld);
  const chat = vorld?.interactions?.chat ?? {};
  const tools = steps.filter((s): s is Extract<Step, { t: 'tool' }> => s.t === 'tool');
  const failed = tools.filter((t) => t.status === 'error').length;
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? (live || failed > 0 || tools.length <= (chat.collapse_after ?? 6));
  const counts = tools.reduce<Record<string, number>>((m, t) => { const v = VERB[t.kind] ?? 'Run'; m[v] = (m[v] ?? 0) + 1; return m; }, {});
  const summary = Object.entries(counts).map(([v, n]) => `${n} ${v.toLowerCase()}${n > 1 ? 's' : ''}`).join(' · ');
  const ms = tools.reduce((a, t) => a + (t.ms ?? 0), 0);
  return (
    <div className={`activity ${live ? 'live' : ''}`}>
      {tools.length > 1 || !isOpen ? (
        <button className="act-head" onClick={() => setOpen(!isOpen)}>
          <span className="chev">{isOpen ? '▾' : '▸'}</span>{summary || str('chat.thoughts', {}, 'thoughts')}
          {failed > 0 && <span className="act-bad">{failed} failed</span>}
          {ms > 0 && <span className="act-ms">{fmtMs(ms)}</span>}
        </button>
      ) : null}
      {!isOpen && <MessageFiles files={tools.flatMap(t=>t.attachments??[])} />}
      {isOpen && steps.map((s, i) => (
        <Fragment key={i}>
          {s.t === 'tool' && <ToolRow step={s} root={root} />}
          {s.t === 'thinking' && <Thinking text={s.text} icon={chat.thinking_icon} live={live && i === steps.length - 1} />}
          {s.t === 'plan' && <Plan items={s.items} icon={chat.plan_icon} />}
        </Fragment>
      ))}
    </div>
  );
}

function ToolRow({ step, root }: { step: Extract<Step, { t: 'tool' }>; root?: string }) {
  const vorld = useStore((s) => s.vorld);
  const [open, setOpen] = useState(false);
  const r = vorld?.interactions?.reactions ?? {};
  const icon = step.test ? r[`test.${step.test}`]?.icon : step.status === 'error' ? r['tool.error']?.icon ?? r[step.kind]?.icon : r[step.kind]?.icon;
  const verb = str(`tool.${step.kind.split('.')[1] ?? 'run'}`, {}, VERB[step.kind] ?? 'Run');
  const target = rel(step.target ?? '', root);
  const has = !!(step.output?.trim() || step.detail);
  const bare = String(step.name ?? '').replace(/^(mcp__ov_browser__|ov_browser\.)/, '');      // the engine's own tools, as Claude Code and Codex name them
  const name = /^(Read|Grep|Glob|LS|Edit|MultiEdit|Write|Bash|WebFetch|WebSearch|shell|patch|web|read_file|search|list_files|write_file|edit_file|run_command|fetch_url)$/.test(bare) ? '' : bare;
  return (
    <div className={`tool-row st-${step.status} ${step.test ? 'test-' + step.test : ''}`}>
      <button className="tool-line" onClick={() => has && setOpen(!open)} disabled={!has} title={step.target}>
        <span className="tool-ico">{icon ? <Icon name={icon} size={16} /> : '•'}</span>
        <span className="tool-verb">{verb}</span>
        {name && <span className="tool-name">{name}</span>}
        <span className="tool-target">{target}</span>
        <span className="tool-state">
          {step.status === 'running' ? <span className="spin" /> : step.status === 'ok' ? (step.test === 'pass' ? '✓ tests pass' : '✓') : step.status === 'stopped' ? '■' : step.test === 'fail' ? '✗ tests fail' : '✗'}
          {step.ms != null && step.ms >= 300 && <span className="tool-ms">{fmtMs(step.ms)}</span>}
          {has && <span className="chev">{open ? '▾' : '▸'}</span>}
        </span>
      </button>
      {open && (
        <div className="tool-detail">
          {step.detail?.note && <div className="tool-note" dir="auto">{step.detail.note}</div>}
          {step.detail?.edits?.map((e: any, i: number) => <Diff key={i} old={e.old} next={e.new} />)}
          {step.detail?.write != null && <pre className="code add">{step.detail.write}</pre>}
          {step.output?.trim() && <pre className={`code out ${step.status === 'error' ? 'bad' : ''}`}>{step.output.trim()}</pre>}
        </div>
      )}
      <MessageFiles files={step.attachments}/>
    </div>
  );
}

function Diff({ old, next }: { old: string; next: string }) {
  return (
    <pre className="code diff">
      {String(old ?? '').split('\n').map((l, i) => <div key={`o${i}`} className="del">- {l}</div>)}
      {String(next ?? '').split('\n').map((l, i) => <div key={`n${i}`} className="add">+ {l}</div>)}
    </pre>
  );
}

function Thinking({ text, icon, live }: { text: string; icon?: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const first = text.trim().split('\n')[0].slice(0, 90);
  return (
    <div className="thinking">
      <button className="tool-line" onClick={() => setOpen(!open)}>
        <span className="tool-ico">{icon ? <Icon name={icon} size={16} /> : '…'}</span>
        <span className="tool-verb">{str('chat.thinking', {}, 'Thinking')}</span>
        <span className="tool-target prose" dir="auto">{open ? '' : first}</span>
        <span className="tool-state">{live ? <span className="spin" /> : null}<span className="chev">{open ? '▾' : '▸'}</span></span>
      </button>
      {open && <div className="thinking-text" dir="auto">{text.trim()}</div>}
    </div>
  );
}

function Plan({ items, icon }: { items: { text: string; status: string }[]; icon?: string }) {
  const done = items.filter((x) => x.status === 'completed').length;
  return (
    <div className="plan">
      <div className="plan-head">{icon && <Icon name={icon} size={16} />} {str('chat.plan', {}, 'Plan')} <span className="muted">{done}/{items.length}</span></div>
      {items.map((x, i) => <div key={i} className={`plan-item ${x.status}`} dir="auto"><span className="box">{x.status === 'completed' ? '☑' : x.status === 'in_progress' ? '◐' : '☐'}</span><span>{x.text}</span></div>)}
    </div>
  );
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);
/** Paths read best from the end: project-relative when possible, else the last few folders. */
function rel(p: string, root?: string) {
  if (root && p.startsWith(root)) return p.slice(root.length).replace(/^\//, '') || '.';
  if (!p.startsWith('/') && !p.startsWith('~')) return p;
  const parts = p.replace(/^\/Users\/[^/]+\//, '~/').split('/');
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
}

export { Markdown } from './Markdown';
