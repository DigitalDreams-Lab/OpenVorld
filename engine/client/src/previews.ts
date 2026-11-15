export type PreviewKind = 'html' | 'svg' | 'image' | 'audio' | 'video' | 'pdf' | 'markdown' | 'json' | 'csv' | 'text' | null;
const imageMimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
export function fileName(value: string) {
  try {
    const url = new URL(value, 'https://preview.invalid');
    const pathname = url.searchParams.get('path') || decodeURIComponent(url.pathname);
    return pathname.replace(/:\d+(?::\d+)?$/, '').split(/[\\/]/).at(-1) || 'file';
  } catch { return value.split(/[\\/]/).at(-1) || 'file'; }
}
export function extension(name: string) { return fileName(name).split('.').at(-1)?.toLowerCase() || ''; }
export function previewKind(name: string, type = ''): PreviewKind {
  const ext = extension(name);
  if (ext === 'svg' || type === 'image/svg+xml') return 'svg';
  if (['html', 'htm'].includes(ext) || type === 'text/html') return 'html';
  if (imageMimes[ext] || type.startsWith('image/')) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext) || type.startsWith('audio/')) return 'audio';
  if (['mp4', 'webm', 'mov', 'ogv'].includes(ext) || type.startsWith('video/')) return 'video';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'json' || type === 'application/json') return 'json';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (type.startsWith('text/') || ['txt', 'log', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'yaml', 'yml', 'xml', 'py', 'sh', 'toml', 'ini', 'sql', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp'].includes(ext)) return 'text';
  return null;
}
export function previewMime(name: string) {
  const ext = extension(name);
  return imageMimes[ext] || ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', pdf: 'application/pdf' } as Record<string, string>)[ext] || 'application/octet-stream';
}
export function codePreviewKind(language: string, source: string): PreviewKind {
  if (['html', 'htm'].includes(language)) return 'html';
  if (language === 'svg' || language === 'xml' && /^\s*<svg\b/i.test(source)) return 'svg';
  if (['md', 'markdown'].includes(language)) return 'markdown';
  if (['csv', 'tsv'].includes(language)) return 'csv';
  return null;
}
export const rawMarkup = (text: string) => /^\s*(?:<!doctype\s+html\b|<html\b|<svg\b)/i.test(text);

/** Resolve an asset through the same conversation-scoped access checks as the HTML file. */
export function relatedFileUrl(fileUrl: string, relative: string) {
  if (!relative || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(relative)) return null;
  try {
    const url = new URL(fileUrl, 'https://preview.invalid');
    const file = url.searchParams.get('path');
    if (!file || !/^\/api\/vorlds\/[^/]+\/threads\/[^/]+\/file$/.test(url.pathname)) return null;
    const resolved = new URL(relative, 'https://preview.invalid/' + file.replace(/\\/g, '/').replace(/^\//, ''));
    let pathname = decodeURIComponent(resolved.pathname);
    if (/^\/[a-z]:\//i.test(pathname)) pathname = pathname.slice(1);
    url.search = ''; url.searchParams.set('path', pathname);
    return url.pathname + url.search;
  } catch { return null; }
}

/** Quoted delimiters and newlines are preserved; keep table previews bounded. */
export function tableRows(text: string, delimiter = ',', maxRows = 101): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === delimiter || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row.slice(0, 30)); row = []; if (rows.length >= maxRows) return rows; }
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row.slice(0, 30)); }
  return rows;
}

export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

/** Parse in an inert template, then isolate the result in a scriptless, opaque-origin iframe. */
export async function previewDocument(source: string, resource?: (reference: string, stylesheet?: boolean) => Promise<string | null>) {
  const template = document.createElement('template'); template.innerHTML = source;
  template.content.querySelectorAll('script, base, meta, iframe, object, embed').forEach(element => element.remove());
  let loaded = 0;
  const load = async (reference: string, stylesheet = false) => resource && loaded++ < 24 ? resource(reference, stylesheet).catch(() => null) : null;
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'action', 'formaction', 'ping', 'target', 'autofocus'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'LINK') {
      if (element.getAttribute('rel')?.toLowerCase() === 'stylesheet') {
        const css = await load(element.getAttribute('href') || '', true);
        if (css) { const style = document.createElement('style'); style.textContent = css; element.replaceWith(style); continue; }
      }
      element.remove(); continue;
    }
    for (const attribute of ['src', 'poster', 'href', 'xlink:href']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      if (value.startsWith('#') || /^(?:data:(?:image|audio|video|font)\/|blob:)/i.test(value)) continue;
      element.removeAttribute(attribute);
      if (['IMG', 'SOURCE', 'VIDEO', 'AUDIO'].includes(element.tagName) && attribute !== 'href') {
        const blob = await load(value); if (blob) element.setAttribute(attribute, blob);
      }
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img,video,svg{max-width:100%}</style></head><body>${template.innerHTML}</body></html>`;
}
