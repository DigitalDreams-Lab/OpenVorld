// Game commands: what a crew member (agent or companion) can DO in its vorld. The pack packs/core/commands.yaml defines them;
// this module (1) tells a brain what it can do on THIS map, (2) checks what a brain asked for and (3) turns it into plain
// instructions the map acts out. Commands only move and animate characters and open screens. They never touch files,
// run programs, spend or publish, so they need no writ, and everything unknown is dropped quietly.

const cfgOf = (ctx) => ctx.packs.byKind.game_commands?.game_commands ?? null;
const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
const roleOf = (ctx, id) => (ctx.member(id)?.role === 'companion' ? 'companion' : 'agent');
const clean = (s, n) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** What exists on this map: the kinds of props, and who lives here. */
export function vorldFacts(ctx) {
  let plan = null; try { plan = ctx.scenery?.() ?? null; } catch { /* a vorld without a plan has no props to name */ }
  const props = new Map();
  for (const p of [...(plan?.props ?? []), ...(plan?.ground_props ?? [])]) props.set(p.t, (props.get(p.t) ?? 0) + 1);
  const people = (ctx.crew ?? []).map((c) => ({ id: c.id, role: c.role, name: c.name ?? c.id, first: String(c.name ?? c.id).split(/\s+/)[0] }));
  return { props, people, plaza: true };
}

const placeLabel = (to, facts) => to.kind === 'plaza' ? 'the plaza' : to.kind === 'founder' ? 'the founder' : to.kind === 'home' ? 'home'
  : to.kind === 'member' ? `${facts.people.find((c) => c.id === to.id)?.name ?? 'a crew member'}'s home` : `the ${String(to.ref).replace(/_/g, ' ')}`;

/** A place a command names: plaza, founder, home, a crew member, or a kind of prop that exists on this map. */
function resolvePlace(raw, facts, selfId, cfg) {
  const k = norm(typeof raw === 'object' && raw ? (raw.ref ?? raw.kind) : raw);
  if (!k) return null;
  if (k === 'plaza' || k === 'terminal' || k === 'square' || k === 'town_square') return { kind: 'plaza' };
  if (k in (cfg.places ?? {})) return { kind: k };
  const c = facts.people.find((x) => norm(x.id) === k || norm(x.name) === k || norm(x.first) === k);
  if (c) return c.id === selfId ? { kind: 'home' } : { kind: 'member', id: c.id };
  if (facts.props.has(k)) return { kind: 'prop', ref: k };
  return null;
}
/** Members a companion command names ("all", a name, or a list). Never the companion itself. */
function resolveWho(raw, facts, selfId, ctx) {
  const list = raw === 'all' || (Array.isArray(raw) && raw.includes('all')) ? facts.people.map((c) => c.id) : (Array.isArray(raw) ? raw : [raw]).flatMap((r) => {
    const k = norm(r), c = facts.people.find((x) => norm(x.id) === k || norm(x.name) === k || norm(x.first) === k);
    return c ? [c.id] : [];
  });
  return [...new Set(list)].filter((id) => id !== selfId && ctx.member(id)?.role !== 'companion' && !!ctx.member(id));
}

const say = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/**
 * Check what a brain asked for. Returns { commands, dropped }: commands are ready for the map (each with a plain-words
 * `text`), dropped says why the others were ignored (for the transcript, never for the founder).
 */
export function prepareCommands(ctx, role, raw) {
  const cfg = cfgOf(ctx);
  if (!cfg || !Array.isArray(raw)) return { commands: [], dropped: [] };
  const facts = vorldFacts(ctx), me = roleOf(ctx, role), lim = cfg.limits ?? {};
  const out = [], dropped = [];
  const names = (ids) => (ids.length === facts.people.length - 1 ? 'everyone' : ids.map((id) => facts.people.find((c) => c.id === id)?.first ?? id).join(', '));
  for (const item of raw.slice(0, 24)) {
    if (out.length >= (lim.per_reply ?? 6)) { dropped.push('too many commands in one reply'); break; }
    const name = norm(item?.do ?? item?.command);
    const def = cfg.commands?.[name];
    if (!def) { dropped.push(`unknown command "${clean(name, 20)}"`); continue; }
    if (!(def.roles ?? []).includes(me)) { dropped.push(`${name} is not for ${me === 'agent' ? 'agents' : 'the companion'}`); continue; }
    let cmd = { do: name };
    const vars = {};
    switch (name) {
      case 'say': { const text = clean(item.text, lim.text_max ?? 60); if (!text) { dropped.push('say needs text'); continue; } cmd.text = vars.text = text; break; }
      case 'emote': { const kind = norm(item.kind); if (!(cfg.emotes ?? []).includes(kind)) { dropped.push(`unknown emote "${clean(kind, 20)}"`); continue; } cmd.kind = vars.kind = kind; break; }
      case 'walk_to': case 'point_to': { const to = resolvePlace(item.to, facts, role, cfg); if (!to) { dropped.push(`${name}: nowhere called "${clean(item.to, 30)}"`); continue; } cmd.to = to; vars.to = placeLabel(to, facts); break; }
      case 'interact': {
        const k = norm(item.with ?? item.target); if (!facts.props.has(k)) { dropped.push(`interact: nothing called "${clean(item.with, 30)}" on this map`); continue; }
        const it = cfg.interactions?.[k] ?? { verb: `looks at the ${k.replace(/_/g, ' ')}`, anim: 'gaze', ms: 2000 };
        cmd = { do: name, with: k, anim: it.anim, ms: it.ms }; vars.verb = it.verb; break;
      }
      case 'wait': { const s = Number(item.seconds); cmd.ms = Math.round(Math.max(1, Math.min(lim.wait_max ?? 10, Number.isFinite(s) ? s : 2)) * 1000); break; }
      case 'go_home': break;
      case 'summon': case 'gather': case 'send_home': {
        const who = resolveWho(item.who, facts, role, ctx); if (!who.length) { dropped.push(`${name}: nobody to ${name}`); continue; }
        cmd.who = who; vars.who = names(who); break;
      }
      case 'show': { const panel = norm(item.panel); if (!(cfg.panels ?? []).includes(panel)) { dropped.push(`unknown screen "${clean(panel, 20)}"`); continue; } cmd.panel = vars.panel = panel; break; }
      default: continue;
    }
    cmd.label = say(def.phrase ?? name, vars);       // plain words for the chat; `text` stays what a character says out loud
    out.push(cmd);
  }
  return { commands: out, dropped };
}

const fill = (s, cfg, facts) => say(String(s ?? ''), {
  emotes: (cfg.emotes ?? []).join(', '), panels: (cfg.panels ?? []).join(', '), wait_max: String(cfg.limits?.wait_max ?? 10),
  places: Object.keys(cfg.places ?? {}).join(', '), props: [...facts.props.keys()].sort().join(', ') || 'nothing',
});

/** The part of a crew member's system prompt that teaches it the commands it may use on this map. */
export function commandHelp(ctx, role) {
  const cfg = cfgOf(ctx);
  if (!cfg) return '';
  const facts = vorldFacts(ctx), me = roleOf(ctx, role);
  const lines = Object.entries(cfg.commands ?? {}).filter(([, d]) => (d.roles ?? []).includes(me)).map(([n, d]) => `- ${n}: ${fill(d.help, cfg, facts)}`);
  const others = facts.people.filter((c) => c.id !== role && c.role !== 'companion').map((c) => c.name).join(', ');
  return `Acting in the vorld: you live in this vorld and can act in it, not only talk. Add a "commands" list to the ov block (at most ${cfg.limits?.per_reply ?? 6} per reply); they happen on the map after your reply, in order.
Use them when they fit what you are saying or doing, or when the founder asks; most replies need none. Commands never change files or spend anything.
${lines.join('\n')}
Crew members you can name: ${others || 'none yet'}. Example: "commands": [{"do":"walk_to","to":"plaza"},{"do":"emote","kind":"wave"},{"do":"say","text":"Over here!"}]`;
}

/** A short description of the map for an API brain's vorld_info tool. */
export function vorldInfo(ctx, role) {
  const cfg = cfgOf(ctx), facts = vorldFacts(ctx);
  if (!cfg) return 'no vorld information';
  const props = [...facts.props].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.replace(/_/g, ' ')} (${n})`).join(', ');
  const people = facts.people.filter((c) => c.id !== role).map((c) => `${c.name}${c.role === 'companion' ? ' (the companion)' : ''}`).join(', ');
  const me = ctx.member(role);
  return [`You are ${me?.name ?? role}${me?.job ? `, ${me.job}` : ''}, in the vorld "${ctx.doc.name}" (${ctx.scenery?.()?.biome ?? 'a map'} setting, ${ctx.scenery?.()?.mood ?? ''} mood).`,
    `Places: ${Object.entries(cfg.places ?? {}).map(([k, v]) => `${k} (${v})`).join('; ')}.`, `Things on the map: ${props || 'nothing'}.`, `Others: ${people || 'nobody else yet'}.`,
    `Emotes: ${(cfg.emotes ?? []).join(', ')}.`].join('\n');
}
