// The shared vocabulary of a turn. Drivers describe tool calls with these helpers so every brain's chat
// looks the same: a kind (game reaction), a short target (what it touched) and an optional detail
// (the edit or file being written) that the chat can expand.
export const KIND = {
  Read: 'tool.read', read_file: 'tool.read', read_image: 'tool.read', NotebookRead: 'tool.read',
  Grep: 'tool.search', Glob: 'tool.search', LS: 'tool.search', search: 'tool.search', list_files: 'tool.search',
  Edit: 'tool.edit', MultiEdit: 'tool.edit', NotebookEdit: 'tool.edit', edit_file: 'tool.edit', patch: 'tool.edit',
  Write: 'tool.write', write_file: 'tool.write',
  Bash: 'tool.run', shell: 'tool.run', run_command: 'tool.run',
  game_command: 'tool.vorld', vorld_info: 'tool.vorld',
  WebFetch: 'tool.web', WebSearch: 'tool.web', fetch_url: 'tool.web', web: 'tool.web',
};
export const kindOf = (name) => KIND[name] ?? 'tool.run';

export function targetOf(name, input = {}) {
  const t = input.file_path ?? input.path ?? input.notebook_path ?? input.command ?? input.url ?? input.query ?? input.pattern ?? '';
  const extra = name === 'Grep' || name === 'search' ? (input.path ? ` in ${input.path}` : '') : '';
  return String(t || name).slice(0, 240) + extra;
}

const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + `\n… (${t.length - n} more characters)` : t; };

/** What the chat can expand for a tool call: edits as before/after, writes as the new text. */
export function detailOf(name, input = {}, max = 1500) {
  if (input.old_string !== undefined || input.new_string !== undefined) return { edits: [{ old: cut(input.old_string, max), new: cut(input.new_string, max) }] };
  if (Array.isArray(input.edits)) return { edits: input.edits.slice(0, 6).map((e) => ({ old: cut(e.old_string, max / 2), new: cut(e.new_string, max / 2) })) };
  if (typeof input.content === 'string') return { write: cut(input.content, max) };
  if (name === 'Bash' || name === 'run_command') return input.description ? { note: String(input.description).slice(0, 200) } : null;
  return null;
}

/** Tool result payloads come as a string or a list of content blocks. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b?.text ?? (b?.type === 'image' ? '[image]' : ''))).join('\n');
  return content == null ? '' : JSON.stringify(content);
}
/** Preserve raster images returned by tools instead of reducing them to "[image]". */
export function imagesOf(content) {
  if(!Array.isArray(content))return [];
  return content.flatMap(b=>{
    if(b?.type!=='image')return [];
    const data=b.data??(b.source?.type==='base64'?b.source.data:null), type=b.mimeType??b.source?.media_type;
    return typeof data==='string'&&/^image\/(png|jpeg|webp|gif)$/.test(type??'')?[{data,type}]:[];
  }).slice(0,8);
}
export const clip = cut;

/** Folds driver events into an ordered transcript: text, thinking, tool (with its result) and plan steps. */
export class Transcript {
  constructor(limits = {}) { this.steps = []; this.limits = { output_chars: 4000, detail_chars: 1500, ...limits }; this.seq = 0; }
  text(t) { this.#append('text', t); }
  thinking(t) { this.#append('thinking', t); }
  #append(type, t) {
    const last = this.steps[this.steps.length - 1];
    if (last?.t === type) last.text += t; else this.steps.push({ t: type, text: t });
  }
  tool(e) {
    const step = { t: 'tool', id: e.id ?? `t${++this.seq}`, kind: e.kind, name: e.name, target: e.target, detail: e.detail ?? null, status: 'running', start: Date.now() };
    this.steps.push(step);
    return step;
  }
  result(e) {
    const step = (e.id && this.steps.find((s) => s.t === 'tool' && s.id === e.id)) || [...this.steps].reverse().find((s) => s.t === 'tool' && s.status === 'running' && (!e.name || s.name === e.name));
    if (!step) return null;
    step.status = e.ok ? 'ok' : 'error';
    step.output = cut(e.output ?? '', this.limits.output_chars);
    step.ms = Date.now() - step.start;
    return step;
  }
  plan(items) {
    const cur = this.steps.find((s) => s.t === 'plan');
    if (cur) cur.items = items; else this.steps.push({ t: 'plan', items });
  }
  /** Steps to store: envelope blocks removed from text, blank text dropped, running tools closed. */
  final(stripEnvelope) {
    return this.steps.map((s) => {
      if (s.t === 'text') return { ...s, text: stripEnvelope(s.text).trim() };
      if (s.t === 'thinking') return { ...s, text: s.text.trim() };
      if (s.t === 'tool') { const { start, ...rest } = s; return rest.status === 'running' ? { ...rest, status: 'stopped' } : rest; }
      return s;
    }).filter((s) => !((s.t === 'text' || s.t === 'thinking') && !s.text));
  }
}
