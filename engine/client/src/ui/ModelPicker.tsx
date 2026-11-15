// A model chooser for one mind: lists the models its provider offers (static list, a CLI's list, the endpoint's list or what was
// typed in Settings), starts with "default for the tier", and still lets the founder type any model name ("Other…").
import { useEffect, useState } from 'react';
import { api } from '../api';

type Models = { models: string[]; tiers: Record<string, string>; live: boolean } | null;
const OTHER = '__other';

export function ModelPicker({ wid, provider, name, tier, value, onChange, className = 'field' }: {
  wid: string; provider: string; name?: string; tier?: string; value?: string; onChange: (model: string | undefined) => void; className?: string;
}) {
  const [list, setList] = useState<Models>(null);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    setList(null);
    if (!provider || provider === 'none') return;
    let live = true;
    const qs = new URLSearchParams({ provider, ...(name ? { name } : {}), ...(value ? { current: value } : {}) });
    api(`/vorlds/${wid}/models?${qs}`).then((m) => { if (live) setList(m); }).catch(() => { if (live) setList({ models: [], tiers: {}, live: false }); });
    return () => { live = false; };
  }, [wid, provider, name]);

  if (!provider || provider === 'none') return <select className={className} disabled><option>No mind, no model</option></select>;
  if (!list) return <select className={className} disabled><option>Loading models…</option></select>;
  const def = tier && list.tiers[tier] ? `Default for the "${tier}" tier (${list.tiers[tier]})` : `Default${tier ? ` for the "${tier}" tier` : ''}`;
  if (!list.models.length || typing) return (
    <input className={className} placeholder={def} value={value ?? ''} autoFocus={typing} onChange={(e) => onChange(e.target.value.trim() || undefined)} onBlur={() => { if (!value) setTyping(false); }} />
  );
  return (
    <select className={className} value={value ?? ''} onChange={(e) => { if (e.target.value === OTHER) { setTyping(true); return; } onChange(e.target.value || undefined); }}>
      <option value="">{def}</option>
      {list.models.map((m) => <option key={m} value={m}>{m}{Object.entries(list.tiers).filter(([, v]) => v === m).map(([t]) => ` · ${t}`).join('')}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
  );
}
