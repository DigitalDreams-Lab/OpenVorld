// Split a reply into display text and the optional ```ov {json}``` block at its end.
export function splitEnvelope(text, lang = 'ov') {
  const re = new RegExp('```' + lang + '\\s*([\\s\\S]*?)(```|$)\\s*$');
  const m = text.match(re);
  if (!m) return { text: text.trim(), meta: {} };
  let meta = {};
  try { meta = JSON.parse(m[1].trim()); } catch { meta = {}; }
  const clean = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, 120)) : []);
  return {
    text: text.slice(0, m.index).trim(),
    meta: {
      options: clean(meta.options, 4),
      mood: typeof meta.mood === 'string' ? meta.mood : undefined,
      balloon: typeof meta.balloon === 'string' ? meta.balloon.slice(0, 60) : undefined,
      title: typeof meta.title === 'string' ? meta.title.slice(0, 80) : undefined,
      commands: Array.isArray(meta.commands) ? meta.commands.filter((c) => c && typeof c === 'object' && !Array.isArray(c)).slice(0, 24) : undefined,
      access: Array.isArray(meta.access) ? meta.access.filter((a) => a && typeof a.capability === 'string' && typeof a.scope === 'string').slice(0, 3)
        .map((a) => ({ capability: a.capability.slice(0, 40), scope: a.scope.slice(0, 300), why: typeof a.why === 'string' ? a.why.slice(0, 200) : '' })) : undefined,
    },
  };
}
