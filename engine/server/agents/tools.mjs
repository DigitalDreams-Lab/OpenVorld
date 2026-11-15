// Tools the ENGINE runs for API brains (OpenAI-compatible models). This is the tightest sandbox: the model
// only sees the tools its writs allow, and every call is checked here (allowed folders, never-lists,
// exact command patterns, allowed domains) and written to the vorld's audit log.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isNever, commandMatches, capabilityLimit, commandPattern, redact } from '../gate.mjs';
import { clip, kindOf, targetOf, detailOf } from './steps.mjs';
import { cleanEnv } from './drivers/proc.mjs';
import { imageType, MAX_FILE } from '../attachments.mjs';
import { prepareCommands, vorldInfo } from './commands.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', 'Pods', 'DerivedData']);
const SHELL_META = /[;&|`$<>(){}\n\r\\]/;

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });

/** Split a command into argv (simple quotes only; no shell features are ever interpreted). */
export function argvOf(command) {
  const out = []; let cur = '', q = null, any = false;
  for (const ch of String(command)) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += ch;
  }
  if (q) throw new Error('unclosed quote in command');
  if (cur || any) out.push(cur);
  return out;
}

/**
 * @param {object} o
 * @param {object} o.ctx vorld context
 * @param {string} o.cwd working folder (the crew member's workspace)
 * @param {string[]} o.readRoots folders the crew member may read
 * @param {string[]} o.writeRoots folders the crew member may change
 * @param {string[]} o.commands cmd.run scopes (patterns)
 * @param {string[]} o.domains net.fetch scopes ("*" = any)
 */
export function engineTools({ ctx, role, cwd, readRoots = [], writeRoots = [], commands = [], domains = [], limits = {}, onRequest = () => {}, onCommand = null }) {
  const lim = { output_chars: 12000, command_seconds: 120, fetch_chars: 20000, search_matches: 80, ...limits };
  const audit = (entry) => { try { fs.appendFileSync(path.join(ctx.dir, 'audit.log'), JSON.stringify({ at: new Date().toISOString(), role, ...entry }) + '\n', { mode: 0o600 }); } catch { /* vorld gone */ } };
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const R = [...new Set([cwd, ...readRoots, ...writeRoots].map(real))];
  const W = [...new Set([cwd, ...writeRoots].map(real))];
  const inside = (abs, roots) => roots.some((r) => abs === r || abs.startsWith(r + path.sep));
  const resolve = (p, write = false) => {
    const abs0 = path.resolve(cwd, String(p ?? '.'));
    // resolve symlinks of the nearest existing parent so a link can never lead outside the roots
    let probe = abs0; while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const abs = path.join(real(probe), path.relative(probe, abs0));
    if (!inside(abs, write ? W : R)) {
      const folder = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      onRequest({ capability: write ? 'fs.write' : 'fs.read', scope: folder, why: `${write ? 'change' : 'read'} ${path.basename(abs)}` });
      throw new Error(`no writ for ${abs}. The founder has been asked for ${write ? 'fs.write' : 'fs.read'} on ${folder}; wait for their answer.`);
    }
    if (isNever(ctx, 'fs.read', abs) || (write && isNever(ctx, 'fs.write', abs))) throw new Error(`${abs} can never be granted`);
    return abs;
  };
  const base = real(cwd);
  const rel = (abs) => (abs.startsWith(base) ? path.relative(base, abs) || '.' : abs);

  const specs = [
    fn('list_files', 'List files and folders (recursively up to depth).', { path: { type: 'string', description: 'Folder, relative to the working folder. Default "."' }, depth: { type: 'integer', minimum: 1, maximum: 4 } }),
    fn('read_file', 'Read a text file. Returns numbered lines.', { path: { type: 'string' }, offset: { type: 'integer', minimum: 1, description: 'First line (1-based)' }, limit: { type: 'integer', minimum: 1, maximum: 2000 } }, ['path']),
    fn('read_image', 'Open a referenced PNG, JPEG, WebP or GIF image when you need to inspect it. Image contents are loaded only when this tool is called.', { path: { type: 'string' } }, ['path']),
    fn('search', 'Search file contents with a regular expression.', { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder to search. Default "."' }, glob: { type: 'string', description: 'Only file names matching this, e.g. "*.ts"' } }, ['pattern']),
  ];
  if (W.length) specs.push(
    fn('write_file', 'Create or overwrite a text file.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    fn('edit_file', 'Replace an exact piece of text in a file. old_string must match exactly once unless replace_all.', { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string']),
  );
  if (commands.length) specs.push(fn('run_command', `Run one allowed command (no shell features). Allowed patterns: ${commands.join(' | ')}`, { command: { type: 'string' } }, ['command']));
  if (domains.length) specs.push(fn('fetch_url', `Fetch a web page as text. Allowed: ${domains.includes('*') ? 'any site' : domains.join(', ')}`, { url: { type: 'string' } }, ['url']));

  // acting on the vorld's map (movement, emotes, props): harmless, so no writ; only when the caller can show it on the map
  if (onCommand) specs.push(
    fn('vorld_info', 'Describe your vorld: places, things you can walk to, and the other crew members.', {}),
    fn('game_command', 'Do something on the vorld map: walk somewhere, wave, say a line, use a bench... Each item is like {"do":"walk_to","to":"plaza"}, {"do":"emote","kind":"wave"}, {"do":"say","text":"Hello!"}, {"do":"interact","with":"bench"}. Call vorld_info first to see what exists.', { commands: { type: 'array', items: { type: 'object' }, description: 'Up to 6 commands, done in order' } }, ['commands']),
  );

  function walk(dir, depth, out, max = 400) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (SKIP_DIRS.has(d.name) || d.name.startsWith('.env')) continue;
      const p = path.join(dir, d.name);
      out.push(d.isDirectory() ? rel(p) + '/' : rel(p));
      if (d.isDirectory() && depth > 1) walk(p, depth - 1, out, max);
    }
  }
  function* files(dir, glob) {
    const re = glob ? new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$') : null;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.env')) continue;
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue; // never follow links out of the granted folders
        if (e.isDirectory()) stack.push(p); else if (e.isFile() && (!re || re.test(e.name))) yield p;
      }
    }
  }

  const impl = {
    vorld_info() { return vorldInfo(ctx, role); },
    game_command({ commands }) {
      const r = prepareCommands(ctx, role, commands);
      if (!r.commands.length) throw new Error(`nothing to do: ${r.dropped.join('; ') || 'no valid command'}`);
      onCommand?.(r.commands);
      return `Done: ${r.commands.map((c) => c.label).join('; ')}.${r.dropped.length ? ` Ignored: ${r.dropped.join('; ')}.` : ''}`;
    },
    list_files({ path: p = '.', depth = 2 }) { const abs = resolve(p); const out = []; walk(abs, Math.min(4, depth), out); return out.join('\n') || '(empty folder)'; },
    read_file({ path: p, offset = 1, limit = 400 }) {
      const abs = resolve(p);
      if (fs.statSync(abs).size > 2e6) throw new Error('file is larger than 2 MB');
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      return lines.slice(offset - 1, offset - 1 + limit).map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n') + (lines.length > offset - 1 + limit ? `\n… ${lines.length - (offset - 1 + limit)} more lines` : '');
    },
    read_image({path:p}) {
      const abs=resolve(p), stat=fs.statSync(abs);
      if(!stat.isFile()||stat.size>MAX_FILE)throw new Error('Image must be a file of 20 MB or smaller');
      const data=fs.readFileSync(abs),type=imageType(data);
      if(!type)throw new Error('Use read_file for text; read_image supports PNG, JPEG, WebP and GIF');
      return {output:`Opened image ${rel(abs)} (${stat.size} bytes)`,images:[{path:abs,type,data:data.toString('base64')}]};
    },
    search({ pattern, path: p = '.', glob }) {
      const abs = resolve(p); const re = new RegExp(pattern, 'i'); const hits = [];
      for (const f of files(abs, glob)) {
        if (isNever(ctx, 'fs.read', f)) continue;
        let st; try { st = fs.statSync(f); } catch { continue; } if (st.size > 1e6) continue;
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        lines.forEach((l, i) => { if (hits.length < lim.search_matches && re.test(l)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 200)}`); });
        if (hits.length >= lim.search_matches) break;
      }
      return hits.join('\n') || 'no matches';
    },
    write_file({ path: p, content }) { const abs = resolve(p, true); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, String(content)); return `wrote ${rel(abs)} (${String(content).split('\n').length} lines)`; },
    edit_file({ path: p, old_string, new_string, replace_all = false }) {
      const abs = resolve(p, true); const src = fs.readFileSync(abs, 'utf8');
      const n = src.split(old_string).length - 1;
      if (!old_string || n === 0) throw new Error('old_string was not found in the file');
      if (n > 1 && !replace_all) throw new Error(`old_string matches ${n} places; add more context or set replace_all`);
      fs.writeFileSync(abs, replace_all ? src.split(old_string).join(new_string) : src.replace(old_string, () => new_string));
      return `edited ${rel(abs)} (${replace_all ? n : 1} change${n > 1 && replace_all ? 's' : ''})`;
    },
    async run_command({ command }, signal) {
      const c = String(command ?? '').trim();
      if (SHELL_META.test(c)) throw new Error('shell features (pipes, redirects, ;, &&, $) are not allowed; run one command');
      if (!commands.some((s) => commandMatches(s, c))) { onRequest({ capability: 'cmd.run', scope: commandPattern(c), why: `run: ${redact(c).slice(0, 140)}` }); throw new Error(`no writ for "${c}". The founder has been asked; allowed now: ${commands.join(' | ') || 'none'}`); }
      if (isNever(ctx, 'cmd.run', c)) throw new Error('this command can never be granted');
      const [cmd, ...args] = argvOf(c);
      const seconds = Math.min(lim.command_seconds, capabilityLimit(ctx, 'cmd.run', 'max_seconds') ?? lim.command_seconds);
      return await new Promise((res, rej) => {
        const child = spawn(cmd, args, { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; const add = (d) => { if (out.length < lim.output_chars * 2) out += d; };
        child.stdout.on('data', add); child.stderr.on('data', add);
        const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
        const stop = () => child.kill('SIGTERM'); signal?.addEventListener('abort', stop, { once: true });
        child.on('error', (e) => { clearTimeout(timer); rej(new Error(`${cmd}: ${e.message}`)); });
        child.on('close', (code) => {
          clearTimeout(timer); signal?.removeEventListener('abort', stop);
          const text = `${out.trim()}\n(exit code ${code ?? 'killed'})`;
          code === 0 ? res(text) : rej(Object.assign(new Error(text), { output: text }));
        });
      });
    },
    async fetch_url({ url }, signal) {
      const u = new URL(String(url));
      if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https');
      if (!domains.includes('*') && !domains.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))) { onRequest({ capability: 'net.fetch', scope: u.hostname, why: `open ${u.href.slice(0, 80)}` }); throw new Error(`no writ for ${u.hostname}; the founder has been asked`); }
      const r = await fetch(u, { signal, redirect: 'follow', headers: { 'user-agent': 'OpenVorld/1.0' } });
      const body = await r.text();
      const text = /html/.test(r.headers.get('content-type') ?? '') ? body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n') : body;
      return `${r.status} ${u.href}\n\n${text.trim().slice(0, lim.fetch_chars)}`;
    },
  };

  return {
    specs,
    describe: (name, args) => ({ kind: kindOf(name), name, target: targetOf(name, args), detail: detailOf(name, args) }),
    async run(name, args, signal) {
      const f = impl[name];
      if (!f || !specs.some((s) => s.function.name === name)) { audit({ tool: name, ok: false, reason: 'unknown tool' }); return { ok: false, output: `unknown tool ${name}` }; }
      try {
        const result = await f(args ?? {}, signal);
        const output = clip(typeof result === 'string' ? result : result.output, lim.output_chars);
        audit({ tool: name, target: targetOf(name, args), ok: true });
        return { ok: true, output, ...(result.images ? {images:result.images} : {}) };
      } catch (e) {
        audit({ tool: name, target: targetOf(name, args), ok: false, reason: String(e.message).slice(0, 200) });
        return { ok: false, output: clip(e.output ?? `error: ${e.message}`, lim.output_chars) };
      }
    },
  };
}
