// Founding a vorld: one short form. Name it, say what it is for, pick its project folder (the one place the whole crew
// works on), pick a start (a crew and a starter party), name your companion and pick the brain everyone thinks with.
// Everything can be changed later in the game.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { play } from '../audio/sfx';

type Agent = { name: string; job: string; function: string; slot?: number };

export function Onboarding({ boot, onDone, onCancel }: { boot: any; onDone: (id: string) => void; onCancel: () => void }) {
  const templates: any[] = boot.templates;
  const names: string[] = boot.theme.agent_names ?? [];
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [template, setTemplate] = useState(templates[0]?.id ?? 'blank');
  const [crew, setCrew] = useState<Agent[]>([]);
  const [companion, setCompanion] = useState({ name: boot.theme.companion?.name ?? 'Buzz', form: boot.theme.companion?.form ?? 'creature', species: boot.theme.companion?.species ?? 'bee' });
  const [brain, setBrain] = useState(boot.detected[0]?.id ?? 'none');
  const [project, setProject] = useState('');           // '' = a new folder inside the vorld
  const [ownFolder, setOwnFolder] = useState(false);
  const [native, setNative] = useState<string | null>(null);
  useEffect(() => { api('/fs/native').then((r) => setNative(r.native ?? null)).catch(() => setNative(null)); }, []);
  const pick = async () => {
    try { const r = await api('/fs/pick', { body: { start: project || undefined, prompt: 'Choose the project folder' } }); if (r.path) setProject(r.path); }
    catch (e: any) { setError(e.message); play('ui.error'); }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = templates.find((x) => x.id === template);
  // picking a start fills the crew with its members (named from the theme); edits after that are yours
  useEffect(() => { setCrew((t?.crew ?? []).map((c: any, i: number) => ({ name: names[i] ?? `Agent ${i + 1}`, job: c.job ?? '', function: c.function ?? '', slot: i }))); }, [template]);
  const setAgent = (i: number, patch: Partial<Agent>) => setCrew((c) => c.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const found = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/vorlds', { body: { name, about, template, crew, companion, brain: { provider: brain }, project: ownFolder ? project : null } });
      play('trial.passed'); onDone(r.id);
    } catch (e: any) { setError(e.message); play('ui.error'); } finally { setBusy(false); }
  };
  return (
    <div className="title-screen onboarding">
      <form className="title-card panel ob-form" onSubmit={(e) => { e.preventDefault(); void found(); }}>
        <h1 className="logo small">New vorld</h1>

        <section>
          <label>Name<input className="field" autoFocus value={name} maxLength={60} placeholder="e.g. Lantern Tea Co." onChange={(e) => setName(e.target.value)} /></label>
          <label>What is it for?<textarea className="field" rows={2} value={about} maxLength={400} placeholder="The project, company or activity your crew works on. Every crew member reads this." onChange={(e) => setAbout(e.target.value)} /></label>
        </section>

        <section>
          <h3>Project folder</h3>
          <p className="muted small">The one folder the whole crew works on. Everyone can read it; changing files in it needs your writ. Each member also gets a workbench of their own, and a private house for their keys.</p>
          <label className="radio"><input type="radio" name="project" checked={!ownFolder} onChange={() => setOwnFolder(false)} /> A new folder inside the vorld</label>
          <label className="radio"><input type="radio" name="project" checked={ownFolder} onChange={() => setOwnFolder(true)} /> A folder on this computer (a repo, a shared drive…)</label>
          {ownFolder && (
            <div className="pf-row">
              <input className="field grow" value={project} placeholder="/Users/you/projects/lantern-tea" onChange={(e) => setProject(e.target.value)} />
              {native && <button type="button" className="btn small" onClick={pick}>Choose…</button>}
            </div>
          )}
        </section>

        <section>
          <h3>Start with</h3>
          <div className="ob-templates">
            {templates.map((x) => (
              <button type="button" key={x.id} className={`ob-template ${x.id === template ? 'on' : ''}`} onClick={() => { play('ui.click'); setTemplate(x.id); }}>
                <b>{x.label}</b><span>{x.description}</span>
                {x.parties?.length > 0 && <small>Starts with a party: {x.parties.join(', ')}</small>}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Your crew</h3>
          {crew.map((a, i) => (
            <div key={i} className="ob-agent">
              <input className="field" value={a.name} maxLength={40} placeholder="Name" onChange={(e) => setAgent(i, { name: e.target.value })} />
              <input className="field" value={a.job} maxLength={40} placeholder="Job title" onChange={(e) => setAgent(i, { job: e.target.value })} />
              <input className="field grow" value={a.function} maxLength={400} placeholder="What they do" onChange={(e) => setAgent(i, { function: e.target.value })} />
              <button type="button" className="x" aria-label={`Remove ${a.name}`} onClick={() => setCrew((c) => c.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setCrew((c) => [...c, { name: names[c.length] ?? '', job: '', function: '' }])}>+ Agent</button>
        </section>

        <section className="ob-row">
          <div>
            <h3>Your companion</h3>
            <label>Name<input className="field" value={companion.name} maxLength={40} onChange={(e) => setCompanion({ ...companion, name: e.target.value })} /></label>
          </div>
          <div>
            <h3>Brain</h3>
            <p className="muted small">Everyone thinks with this until you pick another in their settings. API models (OpenRouter, Ollama…) can be added in Settings.</p>
            {[...boot.detected, { id: 'none', label: 'None for now' }].map((d: any) => (
              <label key={d.id} className="radio"><input type="radio" name="brain" checked={brain === d.id} onChange={() => setBrain(d.id)} /> {d.label}{d.version ? <small className="muted"> {d.version}</small> : null}</label>
            ))}
          </div>
        </section>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="row between">
          <button type="button" className="btn" onClick={onCancel}>Back</button>
          <button className="btn primary big" disabled={busy || !name.trim() || (ownFolder && !project.trim())}>{busy ? 'Creating…' : 'Create the vorld'}</button>
        </div>
      </form>
    </div>
  );
}
