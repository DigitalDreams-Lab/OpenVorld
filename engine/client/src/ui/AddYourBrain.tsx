// "Your AI isn't in the list?": a message the founder copies to their own AI (any agent on this computer), so it can add
// itself to OpenVorld in a user pack (providers.yaml > add_yourself), then a "Look again" for the new brain.
import { useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { copyText } from './Markdown';

export function AddYourBrain({ onFound }: { onFound?: (detected: any[]) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const open = async () => { try { setText((await api('/detect/add-yourself')).text); } catch (e: any) { toast({ kind: 'error', title: e.message }); } };
  const copy = async () => { await copyText(text ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const again = async () => {
    try { const d = await api('/detect', { body: {} }); onFound?.(d); toast({ kind: 'info', title: d.length ? `Found: ${d.map((x: any) => x.label).join(', ')}` : 'Still no agent found' }); }
    catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  if (text === null) return <button type="button" className="link small" onClick={open}>Your AI isn't in the list?</button>;
  return (
    <div className="add-brain">
      <p className="small">Send this message to your AI (any agent on this computer, in its own app or terminal). It adds itself to OpenVorld, then press Look again.</p>
      <pre className="add-brain-text">{text}</pre>
      <div className="row"><button type="button" className="btn small primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy message'}</button><button type="button" className="btn small" onClick={again}>Look again</button><button type="button" className="btn small" onClick={() => setText(null)}>Close</button></div>
    </div>
  );
}
