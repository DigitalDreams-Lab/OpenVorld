// Game state of one world: XP, level, events (what happened, how often) and deeds (achievements).
// Every change returns notes for the client (xp, level, deed) so it can celebrate them.
import fs from 'node:fs';
import path from 'node:path';
import { parse, evaluate } from '../../tools/lib/dsl.mjs';

const today = () => new Date().toISOString().slice(0, 10);

/** XP needed to reach a level: base * (n-1)^exponent (interactions.yaml > levels). */
export const xpFor = (n, curve = {}) => Math.round((curve.base ?? 60) * Math.pow(Math.max(0, n - 1), curve.exponent ?? 1.6));

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.file = path.join(ctx.dir, 'saves', 'game.json');
    const fresh = { xp: 0, level: 1, events: {}, deeds: {}, chat: { day: null, xp: 0 } };
    this.s = fs.existsSync(this.file) ? { ...fresh, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) } : fresh;
    if (!fs.existsSync(this.file)) { this.s.events['world.created'] = 1; this.check([]); }
  }
  get rules() { return this.ctx.interactions; }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.s, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  /** Something happened (adds to its count). */
  event(name, n = 1) { this.s.events[name] = (this.s.events[name] ?? 0) + n; return this; }
  /** XP by rule name (interactions.yaml > xp), or a number. Chat XP stops at the daily cap. */
  xp(rule, notes, extra = 0) {
    const r = this.rules.xp ?? {};
    let amount = (typeof rule === 'number' ? rule : r[rule] ?? 0) + extra;
    if (rule === 'chat_message') {
      if (this.s.chat.day !== today()) this.s.chat = { day: today(), xp: 0 };
      amount = Math.max(0, Math.min(amount, (r.chat_per_day ?? 60) - this.s.chat.xp));
      this.s.chat.xp += amount;
    }
    if (amount > 0) { this.s.xp += amount; notes.push({ type: 'xp', amount, reason: typeof rule === 'string' ? rule : 'xp' }); }
    return this;
  }
  counters() {
    return { 'crew.agents': this.ctx.crew.filter((c) => c.role === 'agent').length, 'game.level': this.s.level, 'game.xp': this.s.xp };
  }
  deedList() {
    const strings = this.ctx.theme.strings?.deeds ?? {};
    return (this.ctx.packs.byKind.achievements?.achievements?.achievements ?? []).map((a) => ({ ...a, name: strings[a.id]?.name ?? a.id, desc: strings[a.id]?.desc ?? '', hint: strings[a.id]?.hint ?? null }));
  }
  /** Unlock deeds whose condition now holds, then update the level. Saves. Returns the notes. */
  check(notes = []) {
    const ctx = { events: this.s.events, counters: this.counters() };
    for (const d of this.deedList()) {
      if (this.s.deeds[d.id]) continue;
      let ok = false;
      try { ok = evaluate(parse(d.when), ctx); } catch { /* a bad pack line never stops the game */ }
      if (!ok) continue;
      this.s.deeds[d.id] = new Date().toISOString();
      this.s.xp += d.xp ?? 0;
      notes.push({ type: 'deed', id: d.id, name: d.name, desc: d.desc, xp: d.xp ?? 0, icon: d.icon });
    }
    const curve = this.rules.levels ?? {};
    let lv = this.s.level;
    while (xpFor(lv + 1, curve) <= this.s.xp) lv++;
    if (lv > this.s.level) { this.s.level = lv; notes.push({ type: 'level', level: lv, title: this.title() }); }
    this.save();
    return notes;
  }
  title() { const t = this.ctx.theme.level_titles ?? []; return t[Math.min(t.length - 1, Math.floor((this.s.level - 1) / 5))] ?? ''; }
  snapshot() {
    const curve = this.rules.levels ?? {};
    return { xp: this.s.xp, level: this.s.level, title: this.title(), xpThis: xpFor(this.s.level, curve), xpNext: xpFor(this.s.level + 1, curve), deeds: this.s.deeds, events: this.s.events };
  }
}

const games = new Map();
/** One Game per world (the state stays in memory; a reloaded context just replaces what it reads rules from). */
export function gameFor(ctx) {
  let g = games.get(ctx.dir);
  if (!g) { g = new Game(ctx); games.set(ctx.dir, g); }
  else g.ctx = ctx;
  return g;
}
