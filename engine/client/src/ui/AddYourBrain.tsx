// "Your AI isn't listed?": one button that copies an integration prompt (providers.yaml > add_yourself, filled in with this
// computer's paths). The founder pastes it into their own AI, which adds itself in a user pack; then "look again".
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { copyText } from './Markdown';

export function AddYourBrain({ onFound }: { onFound?: (detected: any[]) => void }) {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api('/detect/add-yourself').then((r) => setText(r.text)).catch(() => {}); }, []);      // ready before the click, so copying keeps the gesture
  const copy = async () => { if (!text) return; await copyText(text); setCopied(true); };
  const again = async () => {
    try { const d = await api('/detect', { body: {} }); onFound?.(d); toast({ kind: 'info', title: d.length ? `Found: ${d.map((x: any) => x.label).join(', ')}` : 'Still no agent found' }); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  return (
    <div className="add-brain small">
      <span className="muted">Your AI isn't listed?</span>
      <button type="button" className="btn small" disabled={!text} title="Paste it into your own AI: it adds itself to OpenVorld" onClick={copy}>{copied ? 'Copied ✓' : 'Copy integration prompt'}</button>
      {copied && <span className="muted">Paste it into your AI, then <button type="button" className="link small" onClick={again}>look again</button></span>}
    </div>
  );
}
