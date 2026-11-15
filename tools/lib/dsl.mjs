// The condition language of deeds (packs/core/achievements.yaml):
//   event:name                    something happened at least once        event:party.job_done
//   count(event:name) OP n        how many times it happened              count(event:party.job_done) >= 10
//   counter OP n                  an engine counter                       crew.agents >= 3
//   all(a, b, ...) / any(a, ...)
// OP is one of >= <= == > <.
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '>': (a, b) => a > b, '<': (a, b) => a < b };

function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parse(src) {
  const s = String(src).trim();
  const group = s.match(/^(all|any)\((.*)\)$/s);
  if (group) {
    const args = splitArgs(group[2]);
    if (!args.length) throw new Error(`empty ${group[1]}() in "${src}"`);
    return { type: group[1], args: args.map(parse) };
  }
  const count = s.match(/^count\(event:([\w.:-]+)\)\s*(>=|<=|==|>|<)\s*(\d+(?:\.\d+)?)$/);
  if (count) return { type: 'count', event: count[1], op: count[2], value: Number(count[3]) };
  if (/^event:[\w.:-]+$/.test(s)) return { type: 'event', event: s.slice(6) };
  const cmp = s.match(/^([a-z][\w.]*)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (cmp) return { type: 'counter', name: cmp[1], op: cmp[2], value: Number(cmp[3]) };
  throw new Error(`cannot read condition "${src}"`);
}

/** ctx: { events: {name: count}, counters: {name: number} } */
export function evaluate(ast, ctx) {
  switch (ast.type) {
    case 'all': return ast.args.every((a) => evaluate(a, ctx));
    case 'any': return ast.args.some((a) => evaluate(a, ctx));
    case 'event': return (ctx.events?.[ast.event] ?? 0) > 0;
    case 'count': return OPS[ast.op](ctx.events?.[ast.event] ?? 0, ast.value);
    case 'counter': return OPS[ast.op](ctx.counters?.[ast.name] ?? 0, ast.value);
    default: return false;
  }
}
