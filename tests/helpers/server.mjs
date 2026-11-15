// The real server in-process: http.createServer is mocked so no port is opened, and `call` drives its request handler.
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { home } from './vorld.mjs';

const TOKEN = (process.env.OV_TOKEN = 'test-token');
const PORT = (process.env.OV_PORT ??= '24390');
let handler = null;

export async function startServer(t) {
  if (!handler) {
    t.mock.method(http, 'createServer', (fn) => { handler = fn; return { on() {}, listen(_p, _h, done) { done(); } }; });
    await import('../../engine/server/index.mjs');
  }
  return { home, call };
}

/** One request: JSON body (or a Buffer), JSON answer when the server sends JSON. */
export async function call(method, url, body, headers = {}, auth = true) {
  const raw = Buffer.isBuffer(body) ? body : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = Readable.from(raw ? [raw] : []);
  Object.assign(req, { method, url, headers: { host: `127.0.0.1:${PORT}`, ...(auth ? { 'x-ov-token': TOKEN } : {}), ...headers } });
  const chunks = [];
  const res = new Writable({ write(chunk, _e, done) { chunks.push(Buffer.from(chunk)); done(); } });
  res.writeHead = (status, h) => { res.status = status; res.headers = h; res.headersSent = true; };
  await handler(req, res);
  const data = Buffer.concat(chunks);
  return { status: res.status, headers: res.headers, data: res.headers?.['content-type'] === 'application/json' ? JSON.parse(data) : data };
}

/** Found a vorld through the API; returns its id and API root. */
export async function newVorld(input = {}) {
  const r = await call('POST', '/api/vorlds', { name: 'Lantern Tea', about: 'A small tea shop', template: 'blank', brain: { provider: 'none' }, ...input });
  if (r.status !== 200) throw new Error(r.data?.error ?? `HTTP ${r.status}`);
  return { id: r.data.id, root: `/api/vorlds/${r.data.id}` };
}
