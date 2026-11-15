// A vorld: one folder in <home>/vorlds/<id>/ with vorld.yaml (name, what it is for, the crew, settings), plus the
// files the engine keeps beside it (grants.yaml, threads/, parties/, saves/, workbenches/, houses/). The context below is what
// every other module reads: packs, the vorld document, the crew as plain member views, and the map plan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { loadPacks, packRoots, homeDir, readYaml, REPO, resolveTheme } from '../../tools/lib/packs.mjs';
import { planScenery, newSeed } from '../../tools/lib/scenery.mjs';
import { addCliDirs } from '../../tools/lib/cli-path.mjs';
import { checkProject } from './benches.mjs';

const core = loadPacks([path.join(REPO, 'packs', 'core')]);
addCliDirs(core.byKind.providers?.providers?.bin_dirs);
export const HOME = process.env.OPENVORLD_HOME ? path.resolve(process.env.OPENVORLD_HOME) : homeDir(core.byKind.defaults?.defaults);
const vorldsDir = () => path.join(HOME, 'vorlds');
export const allPacks = () => loadPacks(packRoots(HOME));

const bad = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------- providers on this machine ----------
let detectedCache = null;
/** Agent CLIs found on this machine (providers.yaml > drivers.cli.detect). Cached; `force` probes again. */
export function detected(force = false) {
  if (detectedCache && !force) return detectedCache;
  const pack = allPacks().byKind.providers?.providers ?? {};
  addCliDirs(pack.bin_dirs);
  detectedCache = [];
  for (const [id, p] of Object.entries(pack.providers ?? {})) {
    const probe = p.drivers?.cli?.detect;
    if (!probe) continue;
    const r = spawnSync(probe[0], probe.slice(1), { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) detectedCache.push({ id, label: p.label, version: String(r.stdout || r.stderr).trim().split('\n')[0] });
  }
  return detectedCache;
}

// ---------- listing and loading ----------
export function listVorlds() {
  if (!fs.existsSync(vorldsDir())) return [];
  return fs.readdirSync(vorldsDir()).filter((id) => fs.existsSync(path.join(vorldsDir(), id, 'vorld.yaml'))).map((id) => {
    const w = readYaml(path.join(vorldsDir(), id, 'vorld.yaml'));
    return { id, name: w.name, about: w.about, created_at: w.created_at };
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** The plain view of one crew member that every module uses. */
function memberView(m, order, packs, theme, doc) {
  const role = m.role === 'companion' ? 'companion' : 'agent';
  const def = packs.byKind.role?.[role] ?? {};
  return {
    id: m.id, role, order,
    name: m.name || (role === 'companion' ? theme.companion?.name : null) || m.id,
    job: m.job || def.job || '',
    function: m.function || '',
    voice: m.personality || (role === 'companion' ? theme.companion?.voice_style : theme.agent_voice) || 'a friendly voice',
    look: role === 'companion' ? { form: m.form ?? theme.companion?.form ?? 'creature', species: m.species ?? theme.companion?.species ?? 'bee' } : null,
    brain: m.brain ?? null,
    benches: m.benches ?? [], default_bench: m.default_bench ?? 'main',
    prompt: def.prompt ?? 'You are {name}.',
    model_tier: def.model_tier ?? 'balanced',
    home: m.home ?? `${m.name ?? m.id}'s house`,
    vorld: doc.name,
  };
}

const cache = new Map();
export function vorldCtx(id, { fresh = false } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id))) bad('bad vorld id');
  const dir = path.join(vorldsDir(), id);
  if (!fs.existsSync(path.join(dir, 'vorld.yaml'))) bad('vorld not found', 404);
  if (!fresh && cache.has(id)) return cache.get(id);
  const packs = loadPacks(packRoots(HOME, dir));
  const doc = readYaml(path.join(dir, 'vorld.yaml'));
  const theme = resolveTheme(packs.byKind, doc.theme ?? packs.byKind.defaults?.defaults?.theme ?? 'default') ?? {};
  const crew = (doc.crew ?? []).map((m, i) => memberView(m, i, packs, theme, doc));
  const ctx = {
    home: HOME, id, dir, packs, doc, theme, crew,
    interactions: packs.byKind.interactions?.interactions ?? {},
    providers: packs.byKind.providers?.providers?.providers ?? {},
    member: (mid) => crew.find((c) => c.id === mid) ?? null,
    companionId: crew.find((c) => c.role === 'companion')?.id ?? null,
  };
  ctx.scenery = () => (ctx._plan ??= planOf(ctx));
  cache.set(id, ctx);
  return ctx;
}

/** Edit vorld.yaml through a function, then reload the context. */
export function saveVorld(ctx, mutate) {
  const file = path.join(ctx.dir, 'vorld.yaml');
  const doc = readYaml(file);
  mutate(doc);
  writeDoc(ctx.dir, doc);
  cache.delete(ctx.id);
  return vorldCtx(ctx.id);
}
const writeDoc = (dir, doc) => fs.writeFileSync(path.join(dir, 'vorld.yaml'), `# An OpenVorld vorld. Edit freely while the game is closed.\n${YAML.stringify(doc)}`);

/** The map: houses for every agent around the plaza, seeded so two vorlds differ. */
function planOf(ctx) {
  const defs = ctx.packs.byKind.scenery?.scenery ?? {};
  return planScenery(defs, { seed: ctx.doc.seed ?? ctx.id, mood: ctx.doc.mood ?? 'auto', biome: ctx.doc.biome ?? 'auto', homes: ctx.crew.filter((c) => c.role !== 'companion').length });
}

// ---------- the crew ----------
const BRAIN = (b) => (b && typeof b === 'object' ? { provider: str(b.provider, 40) || 'none', ...(str(b.model, 120) ? { model: str(b.model, 120) } : {}), ...(str(b.name, 40) ? { name: str(b.name, 40) } : {}) } : undefined);
/** A clean crew member from client input (name, job, description, personality, brain, folder). */
export function cleanMember(input, taken, role = 'agent') {
  const name = str(input.name, 40);
  if (!name) bad('a crew member needs a name');
  let id = slug(name) || role, n = 1;
  while (taken.has(id)) id = `${slug(name) || role}-${++n}`;
  taken.add(id);
  const m = { id, role, name };
  if (str(input.job, 40)) m.job = str(input.job, 40);
  if (str(input.function, 400)) m.function = str(input.function, 400);
  if (str(input.personality, 200)) m.personality = str(input.personality, 200);
  if (role === 'companion') { m.form = ['robot', 'creature', 'person'].includes(input.form) ? input.form : 'creature'; if (m.form === 'creature') m.species = slug(input.species) || 'bee'; }
  const brain = BRAIN(input.brain); if (brain) m.brain = brain;
  return m;
}

// ---------- creating a vorld ----------
/**
 * Found a vorld from the onboarding form: { name, about, template, project, companion: {name, form, species, brain}, crew: [{name, job, function}], brain }.
 * `project` is an existing folder the crew works on together; without one the vorld gets its own <vorld>/project.
 * The template adds its starter parties (members point at crew members by their index in the template's crew).
 */
export function createVorld(input) {
  const packs = allPacks();
  const theme = resolveTheme(packs.byKind, packs.byKind.defaults?.defaults?.theme ?? 'default') ?? {};
  const name = str(input.name, 60);
  if (!name) bad('give your vorld a name');
  const template = packs.byKind.template?.[input.template] ?? packs.byKind.template?.blank ?? { crew: [], parties: [] };
  let id = slug(name) || 'vorld', n = 1;
  fs.mkdirSync(vorldsDir(), { recursive: true });
  while (fs.existsSync(path.join(vorldsDir(), id))) id = `${slug(name) || 'vorld'}-${++n}`;
  const project = input.project ? checkProject({ packs, dir: path.join(vorldsDir(), id) }, String(input.project).trim()) : null;
  const taken = new Set(['founder']);
  const brain = BRAIN(input.brain);
  const companion = cleanMember({ ...theme.companion, ...(input.companion ?? {}), brain: input.companion?.brain ?? brain }, taken, 'companion');
  // `slot` = the member's index in the template's crew, so starter parties still find them after edits in the form
  const given = Array.isArray(input.crew) ? input.crew : (template.crew ?? []).map((c, i) => ({ ...c, name: theme.agent_names?.[i], slot: i }));
  const bySlot = new Map();
  const crew = given.slice(0, 30).filter((c) => str(c?.name, 40)).map((c) => { const m = cleanMember({ brain, ...c }, taken); if (Number.isInteger(c.slot)) bySlot.set(c.slot, m.id); return m; });
  const dir = path.join(vorldsDir(), id);
  fs.mkdirSync(path.join(dir, 'workbenches'), { recursive: true });
  if (!project) fs.mkdirSync(path.join(dir, 'project'), { recursive: true });
  const doc = { id, name, about: str(input.about, 400), ...(project ? { project } : {}), template: template.id ?? 'blank', theme: theme.id ?? 'default', seed: newSeed(), created_at: new Date().toISOString(), crew: [companion, ...crew] };
  writeDoc(dir, doc);
  return { id, starters: (template.parties ?? []).map((p) => ({ name: p.name, goal: p.goal, members: (p.members ?? []).map((i) => bySlot.get(i)).filter(Boolean) })) };
}

export const newId = () => crypto.randomUUID();
