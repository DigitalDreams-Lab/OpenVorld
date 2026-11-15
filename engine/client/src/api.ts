// Talks to the local server. The token comes from a <meta> the server (or Vite in dev) injects.
let TOKEN = document.querySelector<HTMLMetaElement>('meta[name="ov-token"]')?.content ?? '';
let tokenRefresh: Promise<void> | undefined;

// Refresh a restarted server's launch token without discarding an open onboarding form.
async function refreshToken() {
  if (!tokenRefresh) tokenRefresh = (async () => {
    const page = await fetch('/', { cache: 'no-store' });
    if (!page.ok) throw new Error('Could not reconnect to the openVorld server. Retry in a moment.');
    const html = new DOMParser().parseFromString(await page.text(), 'text/html');
    const token = html.querySelector<HTMLMetaElement>('meta[name="ov-token"]')?.content;
    if (!token) throw new Error('Could not reconnect to the openVorld server. Retry in a moment.');
    TOKEN = token;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="ov-token"]');
    if (meta) meta.content = token;
  })().finally(() => { tokenRefresh = undefined; });
  return tokenRefresh;
}

async function authenticatedFetch(url: string, options: RequestInit = {}) {
  const request = () => fetch(url, { ...options, headers: { ...options.headers, 'x-ov-token': TOKEN } });
  try {
    let res = await request();
    // A 401 is rejected before any action runs, so retrying with the new token is safe.
    if (res.status === 401) { await refreshToken(); res = await request(); }
    return res;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Cannot reach the local openVorld server. Restart npm run dev, then retry.');
    throw error;
  }
}

/** A default sprite sheet image (packs/core/art/default/<name>.png, or a pack that replaces it). */
export async function artImage(name: string) {
  const res = await authenticatedFetch(`/api/art/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Art unavailable'); return res.blob();
}
export async function fileBlob(url: string, signal?: AbortSignal) {
  if (!url.startsWith('/api/vorlds/')) throw new Error('Invalid local file URL');
  const res=await authenticatedFetch(url,{signal});
  if (!res.ok) {const data=await res.json().catch(()=>({}));throw new Error(data.error ?? 'File unavailable');}
  return res.blob();
}
export async function uploadFile(wid: string, thread: string, file: File) {
  const res=await authenticatedFetch(`/api/vorlds/${wid}/threads/${thread}/attachments`,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file});
  const data=await res.json();if(!res.ok)throw new Error(data.error??'Upload failed');return data;
}
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await authenticatedFetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'x-ov-token': TOKEN, 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Live events for one vorld, reconnecting with backoff. Returns a close function. */
export function connect(wid: string, onMsg: (m: any) => void): () => void {
  let ws: WebSocket | null = null, closed = false, delay = 500, connected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(TOKEN)}&vorld=${encodeURIComponent(wid)}`);
    ws.onopen = () => { delay = 500; if (connected) onMsg({ type: 'connection.restored' }); connected = true; };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (closed) return;
      // after a few failures, check whether the token is stale (server restarted) instead of looping
      if (delay >= 4000) void refreshToken().catch(() => {});
      retry = setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    };
  };
  open();
  return () => { closed = true; clearTimeout(retry); ws?.close(); };
}
