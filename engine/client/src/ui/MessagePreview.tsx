import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileAccessError, fileBlob } from '../api';
import { extension, previewDocument, previewKind, previewMime, relatedFileUrl, tableRows, type PreviewKind } from '../previews';
import { Markdown } from './Markdown';
import { OutsideFile } from './MessageFiles';

export function HtmlPreview({ source, title = 'HTML preview', fileUrl }: { source: string; title?: string; fileUrl?: string }) {
  const [document, setDocument] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true, assets = 0, bytes = 0; const abort = new AbortController();
    setDocument(''); setError('');
    const load = async (base: string, reference: string) => {
      const url = relatedFileUrl(base, reference); if (!url || assets++ >= 24) return null;
      const blob = await fileBlob(url, abort.signal, 8 * 1024 * 1024); bytes += blob.size;
      if (bytes > 16 * 1024 * 1024) throw new Error('Local preview assets exceed 16 MB.');
      if (!live) return null;
      return { url, blob };
    };
    // Opaque sandbox origins cannot read the parent's blob URLs. Embed scoped assets
    // as data instead, preserving isolation without granting allow-same-origin.
    const assetUrl = (blob: Blob, name: string): Promise<string> => {
      const font = name.match(/\.(woff2?|ttf|otf)(?:$|[?#])/i)?.[1];
      const mime = font ? `font/${font.toLowerCase()}` : previewMime(name);
      return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not prepare this preview asset.'));
        reader.readAsDataURL(new Blob([blob], { type: mime }));
      });
    };
    const resource = async (reference: string, stylesheet = false) => {
      const loaded = fileUrl && await load(fileUrl, reference); if (!loaded) return null;
      if (stylesheet) {
        let css = await loaded.blob.text();
        for (const match of [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)]) {
          if (/^(?:data:|#)/i.test(match[2])) continue;
          const asset = await load(loaded.url, match[2]).catch(() => null);
          css = css.replace(match[0], asset ? `url("${await assetUrl(asset.blob, match[2])}")` : 'url("")');
        }
        return css;
      }
      return assetUrl(loaded.blob, reference);
    };
    previewDocument(source, fileUrl ? resource : undefined).then(value => { if (live) setDocument(value); }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; abort.abort(); };
  }, [source, fileUrl]);
  return <div className="html-preview">{error ? <p role="alert">{error}</p> : document ? <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={document} /> : <p>Loading preview…</p>}<small>HTML preview · scripts disabled</small></div>;
}

export function TablePreview({ text, delimiter = ',' }: { text: string; delimiter?: string }) {
  const rows = tableRows(text, delimiter);
  return <div className="table-preview"><div className="md-table"><table><thead><tr>{rows[0]?.map((cell, i) => <th key={i} dir="auto">{cell || `Column ${i + 1}`}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} dir="auto">{cell}</td>)}</tr>)}</tbody></table></div>{rows.length >= 101 && <small>Showing the first 100 rows.</small>}</div>;
}

export function InlinePreview({ kind, source, language, thread }: { kind: PreviewKind; source: string; language?: string; thread?: string }) {
  if (kind === 'html' || kind === 'svg') return <HtmlPreview source={source} title={kind === 'svg' ? 'SVG preview' : 'HTML preview'} />;
  if (kind === 'markdown') return <Markdown text={source} thread={thread} />;
  if (kind === 'csv') return <TablePreview text={source} delimiter={language === 'tsv' ? '\t' : ','} />;
  return null;
}

/** Portal keeps the dialog out of inline Markdown and gives Escape/focus a single owner. */
export function PreviewDialog({ name, onClose, children, download }: { name: string; onClose: () => void; children: ReactNode; download?: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab') {
        const focusable = close.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button, a[href], video, audio, iframe, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [onClose]);
  return createPortal(<div className="file-preview-bg" role="presentation" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="file-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${name}`} onClick={event => event.stopPropagation()}>
      <header><strong dir="auto" title={name}>{name}</strong><span>{download}<button ref={close} type="button" className="btn small" onClick={onClose}>Close preview ✕</button></span></header>
      <div className="file-preview-body">{children}</div>
    </section>
  </div>, document.body);
}

export function FilePreview({ url, name, onClose, download }: { url: string; name: string; onClose: () => void; download: ReactNode }) {
  const [content, setContent] = useState<{ kind: PreviewKind; text?: string; object?: string } | null>(null), [error, setError] = useState(''), [outside, setOutside] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true, object = ''; const abort = new AbortController(); setContent(null); setError(''); setOutside('');
    fileBlob(url, abort.signal, 20 * 1024 * 1024).then(async blob => {
      const kind = previewKind(name, blob.type);
      if (!kind) throw new Error('This file type is available to download.');
      if (['html', 'svg', 'markdown', 'json', 'csv', 'text'].includes(kind)) {
        let text = await blob.text();
        if (kind === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Preserve invalid JSON for inspection. */ } }
        if (live) setContent({ kind, text });
      } else {
        if (kind === 'pdf' && !(await blob.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('This file is not a valid PDF.');
        if (!live) return;
        object = URL.createObjectURL(new Blob([blob], { type: blob.type !== 'application/octet-stream' ? blob.type : previewMime(name) }));
        setContent({ kind, object });
      }
    }).catch(error => { if (!live) return; if (error instanceof FileAccessError) setOutside(error.path); else setError(error.message); });
    return () => { live = false; abort.abort(); if (object) URL.revokeObjectURL(object); };
  }, [url, name, attempt]);
  return <PreviewDialog name={name} onClose={onClose} download={download}>
    {outside ? <OutsideFile url={url} path={outside} onAllowed={() => setAttempt(n => n + 1)} /> : error ? <p className="file-error" role="alert">{error}</p> : !content ? <p>Loading preview…</p>
      : content.kind === 'html' || content.kind === 'svg' ? <HtmlPreview source={content.text!} title={`${name} preview`} fileUrl={url} />
      : content.kind === 'markdown' ? <Markdown text={content.text!} thread={url.match(/\/threads\/([^/]+)\//)?.[1]} />
      : content.kind === 'csv' ? <TablePreview text={content.text!} delimiter={extension(name) === 'tsv' ? '\t' : ','} />
      : content.kind === 'image' ? <img className="file-preview-image" src={content.object} alt={name} onError={()=>setError('This image could not be rendered. Download it to open it.')} />
      : content.kind === 'audio' ? <audio controls preload="metadata" src={content.object} onError={()=>setError('This audio format cannot play here. Download it to open it.')}>Audio preview unavailable.</audio>
      : content.kind === 'video' ? <video controls preload="metadata" src={content.object} onError={()=>setError('This video format cannot play here. Download it to open it.')}>Video preview unavailable.</video>
      : content.kind === 'pdf' ? <iframe className="pdf-preview" title={`${name} preview`} referrerPolicy="no-referrer" src={content.object} />
      : <pre className="file-preview-text" dir={content.kind === 'text' ? 'auto' : 'ltr'}>{content.text}</pre>}
  </PreviewDialog>;
}
