// A small browser for the crew. Each member that browses gets its OWN private Chrome profile (no cookies of yours),
// driven headless through playwright-core and the Chrome or Edge already installed on this computer.
//
// Safety, enforced here on every call (not by the model):
//  - every page the browser navigates to must be on a domain the member holds a net.fetch writ for (re-read on each
//    call, so a writ granted a moment ago applies at once); redirects and link clicks are checked the same way;
//  - addresses on this computer or network (localhost, 192.168.x.x, ...) are always blocked, so a page can never reach
//    the OpenVorld server or your router;
//  - no typing into password or payment fields, no downloads, no file: or other non-web addresses.
//
// While a member browses, small JPEG frames are pushed to the game ({type:'browser', role, url, title, image, active})
// so the founder can watch.
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { grantsOf } from './gate.mjs';
import { BROWSER_TOOLS, isBrowserTool } from './browser-tools.mjs';

const sessions = new Map();     // `${vorld}:${role}` -> session
let shared = null;              // the one Chrome process every session's context lives in

const DEFAULTS = {
  enabled: true, viewport: { width: 1024, height: 640 }, text_chars: 12000, max_elements: 60,
  idle_seconds: 300, active_seconds: 6, frame_ms: 900, jpeg_quality: 55, nav_timeout_seconds: 20, allow_private: false,
};
const cfgOf = (ctx) => ({ ...DEFAULTS, ...(ctx.interactions?.agent?.browser ?? {}), ...(process.env.OV_BROWSER_ALLOW_PRIVATE === '1' ? { allow_private: true } : {}) });

// ---------- Chrome ----------
const CHROME_PATHS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
};
/** The Chrome-family browser on this computer, or null. OV_CHROME can name one. */
export const findChrome = () => [process.env.OV_CHROME, ...(CHROME_PATHS[process.platform] ?? [])].filter(Boolean).find((p) => fs.existsSync(p)) ?? null;
export const browserAvailable = () => !!findChrome();

async function chrome() {
  const path = findChrome();
  if (!path) throw new Error('Browsing needs Google Chrome or Microsoft Edge installed on this computer.');
  if (shared) { try { const b = await shared; if (b.isConnected()) return b; } catch { /* launch again */ } shared = null; }
  shared = import('playwright-core').then(({ chromium }) => chromium.launch({ executablePath: path, headless: true, args: ['--disable-dev-shm-usage', '--mute-audio'] }));
  try {
    const b = await shared;
    b.on('disconnected', () => { shared = null; for (const [k, s] of sessions) { stopTimers(s); sessions.delete(k); } });
    return b;
  } catch (e) { shared = null; throw new Error(`Could not start the browser: ${String(e.message).split('\n')[0]}`); }
}

// ---------- the rules ----------
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
export function privateIp(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((r) => r.test(ip));
  if (net.isIPv6(ip)) { const x = ip.toLowerCase(); return x === '::1' || x === '::' || x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd') || (x.startsWith('::ffff:') && privateIp(x.slice(7))); }
  return false;
}
const dnsCache = new Map();    // host -> { at, priv }
/** True for localhost, internal names, private addresses, and names that resolve to them. */
export async function isPrivateHost(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (net.isIP(h)) return privateIp(h);
  const hit = dnsCache.get(h);
  if (hit && Date.now() - hit.at < 60000) return hit.priv;
  let priv = false;
  try { priv = (await dns.lookup(h, { all: true })).some((a) => privateIp(a.address)); } catch { /* Chrome reports names that do not resolve */ }
  dnsCache.set(h, { at: Date.now(), priv });
  return priv;
}
export const domainsOf = (ctx, role) => grantsOf(ctx, role).filter((g) => g.capability === 'net.fetch').map((g) => g.scope);
export const allowsHost = (domains, host) => domains.includes('*') || domains.some((d) => host === d || host.endsWith('.' + d));

const fail = (msg) => { throw new Error(msg); };

// ---------- sessions ----------
const keyOf = (ctx, role) => `${ctx.id}:${role}`;
const stopTimers = (s) => { clearInterval(s.timer); clearTimeout(s.idle); s.timer = s.idle = null; };

async function sessionOf(ctx, role) {
  const key = keyOf(ctx, role), cfg = cfgOf(ctx);
  let s = sessions.get(key);
  if (s?.page && !s.page.isClosed()) return s;
  const browser = await chrome();
  const ua = `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36 OpenVorld/1`;
  const context = await browser.newContext({ viewport: cfg.viewport, acceptDownloads: false, serviceWorkers: 'block', locale: 'en-US', userAgent: ua, permissions: [] });
  s = { key, ctx, role, context, page: null, queue: Promise.resolve(), denied: [], hops: 0, last: null, hash: '', timer: null, idle: null, activeUntil: 0, emit: null, cfg };
  context.on('page', (p) => { s.page = p; p.on('dialog', (d) => d.dismiss().catch(() => {})); });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch { return route.abort('blockedbyclient'); }
    if (!/^https?:$/.test(u.protocol)) return route.abort('blockedbyclient');
    if (!s.cfg.allow_private && await isPrivateHost(u.hostname)) { s.denied.push({ host: u.hostname, private: true }); return route.abort('blockedbyclient'); }
    if (req.resourceType() !== 'document') return route.continue();
    // pages and frames: the domain must be granted, and redirects are followed HERE, one hop at a time. (Chrome follows
    // redirects inside its network stack without asking us, so a granted site could otherwise send the browser anywhere.)
    if (!allowsHost(domainsOf(s.ctx, s.role), u.hostname)) { s.denied.push({ host: u.hostname, url: u.href }); return route.abort('blockedbyclient'); }
    let resp;
    try { resp = await route.fetch({ maxRedirects: 0, timeout: 30000 }); } catch { return route.abort('failed'); }
    const loc = resp.headers().location;
    if ([301, 302, 303, 307, 308].includes(resp.status()) && loc) {
      let target; try { target = new URL(loc, u).href; } catch { return route.abort('blockedbyclient'); }
      if (++s.hops > 20) return route.abort('blockedbyclient');
      const cookie = resp.headers()['set-cookie'];
      // a 0-second refresh is a new navigation (checked again by this handler) and replaces the history entry like a redirect
      return route.fulfill({ status: 200, contentType: 'text/html', headers: cookie ? { 'set-cookie': cookie } : {}, body: `<!doctype html><meta http-equiv="refresh" content="0;url=${target.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` });
    }
    s.hops = 0;
    return route.fulfill({ response: resp });
  });
  s.page = await context.newPage();
  sessions.set(key, s);
  return s;
}

async function closeSession(s) {
  stopTimers(s);
  sessions.delete(s.key);
  s.emit?.({ type: 'browser', role: s.role, closed: true });
  await s.context.close().catch(() => {});
  if (!sessions.size && shared) { const b = shared; shared = null; b.then((x) => x.close()).catch(() => {}); }
}
export async function close(ctx, role) { const s = sessions.get(keyOf(ctx, role)); if (s) await closeSession(s); }
export async function closeAll() { for (const s of [...sessions.values()]) await closeSession(s); }

/** The last frame this member's browser showed (for a panel opened later), or null. */
export const latest = (ctx, role) => { const s = sessions.get(keyOf(ctx, role)); return s?.last ? { ...s.last, active: !!s.timer } : null; };

// ---------- the live view ----------
async function frame(s) {
  if (!s.page || s.page.isClosed()) return;
  try {
    const buf = await s.page.screenshot({ type: 'jpeg', quality: s.cfg.jpeg_quality, timeout: 4000 });
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    s.last = { url: s.page.url(), title: await s.page.title().catch(() => ''), image: buf.toString('base64'), at: Date.now() };
    if (hash !== s.hash || s.final) { s.hash = hash; s.emit?.({ type: 'browser', role: s.role, ...s.last, active: !!s.timer }); }
  } catch { /* the page is changing; the next frame will do */ }
}
/** Keep sending frames while the member is busy; one last frame when it stops. */
function pulse(s) {
  s.activeUntil = Date.now() + s.cfg.active_seconds * 1000;
  clearTimeout(s.idle);
  s.idle = setTimeout(() => closeSession(s), s.cfg.idle_seconds * 1000); s.idle.unref?.();
  if (s.timer) return;
  s.timer = setInterval(async () => {
    if (Date.now() < s.activeUntil) return frame(s);
    clearInterval(s.timer); s.timer = null; s.final = true; await frame(s); s.final = false;
  }, s.cfg.frame_ms);
  s.timer.unref?.();
}

// ---------- reading a page ----------
async function snapshot(s) {
  const { max_elements: maxEls, text_chars: maxChars } = s.cfg;
  // belt and braces: whatever happened on the way, the member only ever reads a page on an allowed domain
  const here = (() => { try { return new URL(s.page.url()); } catch { return null; } })();
  if (here && /^https?:$/.test(here.protocol) && (!allowsHost(domainsOf(s.ctx, s.role), here.hostname) || (!s.cfg.allow_private && await isPrivateHost(here.hostname)))) {
    await s.page.goto('about:blank').catch(() => {});
    fail(`the page ended up on ${here.hostname}, which this member may not read`);
  }
  const d = await s.page.evaluate(({ maxEls }) => {
    document.querySelectorAll('[data-ov-id]').forEach((e) => e.removeAttribute('data-ov-id'));
    const visible = (e) => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none' && r.bottom > -innerHeight && r.top < innerHeight * 4; };
    const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.getAttribute('title') || e.name || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]')].filter(visible).slice(0, maxEls);
    const items = els.map((e, i) => {
      e.setAttribute('data-ov-id', String(i + 1));
      const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
      if (tag === 'a') return `[${i + 1}] link "${label(e)}" → ${String(e.href).slice(0, 120)}`;
      if (tag === 'select') return `[${i + 1}] select "${label(e) || e.name}" = "${e.value}"`;
      if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) return `[${i + 1}] button "${label(e)}"`;
      if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return `[${i + 1}] ${type} "${label(e)}" ${e.checked ? '(checked)' : ''}`;
      if (tag === 'input' || tag === 'textarea') return type === 'password' ? `[${i + 1}] password field (you cannot type here)` : `[${i + 1}] field${type ? `(${type})` : ''} "${label(e)}" = "${String(e.value).slice(0, 60)}"`;
      return `[${i + 1}] button "${label(e)}"`;
    });
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    return { title: document.title, url: location.href, text: document.body?.innerText ?? '', items, percent: Math.min(100, Math.round((scrollY / max) * 100)) };
  }, { maxEls });
  const text = d.text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters; use browser_read with scroll to see more)` : text;
  return `Page: ${d.title || '(no title)'}\nURL: ${d.url}\nScrolled: ${d.percent}%\n\n${body || '(no text on this page)'}\n\nElements:\n${d.items.join('\n') || '(none)'}`;
}

/** Turn pages the browser refused into writ requests, and say so. */
function settle(s, onRequest) {
  const denied = s.denied.splice(0);
  const seen = new Set(), notes = [];
  for (const d of denied) {
    if (seen.has(d.host)) continue; seen.add(d.host);
    if (d.private) { notes.push(`${d.host} is on this computer or network and is always blocked`); continue; }
    onRequest?.({ capability: 'net.fetch', scope: d.host, why: `open ${String(d.url ?? d.host).slice(0, 80)}` });
    notes.push(`no writ for ${d.host}. The founder has been asked; wait for their answer`);
  }
  return notes;
}

const settled = async (s) => { await s.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}); await s.page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {}); };

const IMPL = {
  async browser_open(s, { url }, o) {
    const u = (() => { try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(url)) ? String(url) : `https://${url}`); } catch { return fail('that is not a web address'); } })();
    await s.page.goto(u.href, { timeout: s.cfg.nav_timeout_seconds * 1000, waitUntil: 'domcontentloaded' }).catch((e) => {
      const notes = settle(s, o.onRequest);
      if (notes.length) fail(notes.join('; '));
      fail(`could not open ${u.href}: ${String(e.message).split('\n')[0].replace(/^page\.goto: /, '')}`);
    });
    await settled(s);
    const notes = settle(s, o.onRequest);
    if (notes.length) { await s.page.goto('about:blank').catch(() => {}); fail(notes.join('; ')); }
    return snapshot(s);
  },
  async browser_read(s, { scroll }) {
    if (scroll) await s.page.evaluate((dir) => (dir === 'top' ? scrollTo(0, 0) : scrollBy(0, (dir === 'down' ? 1 : -1) * innerHeight * 0.85)), scroll);
    return snapshot(s);
  },
  async browser_click(s, { id }, o) {
    const el = s.page.locator(`[data-ov-id="${Number(id)}"]`);
    if (!(await el.count())) fail(`there is no element [${id}] on this page; call browser_read to get the current numbers`);
    await el.first().click({ timeout: 5000 }).catch((e) => fail(`could not click [${id}]: ${String(e.message).split('\n')[0]}`));
    await settled(s);
    const notes = settle(s, o.onRequest);
    if (notes.length) { if (/^chrome-error:/.test(s.page.url())) await s.page.goBack().catch(() => {}); fail(`${notes.join('; ')}. You are still on the previous page`); }
    return snapshot(s);
  },
  async browser_type(s, { id, text, submit }) {
    const el = s.page.locator(`[data-ov-id="${Number(id)}"]`);
    if (!(await el.count())) fail(`there is no element [${id}] on this page; call browser_read to get the current numbers`);
    const info = await el.first().evaluate((e) => ({ type: (e.getAttribute('type') || '').toLowerCase(), hint: `${e.name ?? ''} ${e.id ?? ''} ${e.getAttribute('autocomplete') ?? ''} ${e.getAttribute('aria-label') ?? ''}` }));
    if (info.type === 'password' || /passw|passwd|card.?n|cc-|cvv|cvc|\bssn\b|iban/i.test(info.hint)) fail('you cannot type passwords or payment details; ask the founder to do that themselves');
    await el.first().fill(String(text), { timeout: 5000 }).catch((e) => fail(`could not type into [${id}]: ${String(e.message).split('\n')[0]}`));
    if (submit) { await s.page.keyboard.press('Enter'); await settled(s); }
    return snapshot(s);
  },
  async browser_back(s) {
    await s.page.goBack({ timeout: 8000 }).catch(() => fail('there is no earlier page'));
    await settled(s);
    return snapshot(s);
  },
};

/**
 * Run one browser tool for a member. `emit` receives live frames; `onRequest` receives writ requests for sites the
 * member may not open yet. Rejects with a plain message the model can act on.
 */
export async function callTool(ctx, role, name, args = {}, { emit = null, onRequest = null } = {}) {
  if (!isBrowserTool(name)) fail(`unknown tool ${name}`);
  const cfg = cfgOf(ctx);
  if (cfg.enabled === false) fail('the browser is switched off for this vorld');
  // before opening Chrome at all: a page the member has no writ for, or that is private, never starts a browser
  if (name === 'browser_open') {
    let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(args.url)) ? String(args.url) : `https://${args.url}`); } catch { fail('that is not a web address'); }
    if (!/^https?:$/.test(u.protocol)) fail('only http and https addresses can be opened');
    if (!cfg.allow_private && await isPrivateHost(u.hostname)) fail(`${u.hostname} is on this computer or network and is always blocked`);
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !cfg.allow_private) fail('open sites by their domain name, not by an IP address');
    if (!allowsHost(domainsOf(ctx, role), u.hostname)) {
      onRequest?.({ capability: 'net.fetch', scope: u.hostname, why: `open ${u.href.slice(0, 80)}` });
      fail(`no writ for ${u.hostname}. The founder has been asked; wait for their answer.`);
    }
  } else if (!sessions.has(keyOf(ctx, role))) fail('no page is open yet; use browser_open first');
  const s = await sessionOf(ctx, role);
  s.emit = emit ?? s.emit; s.cfg = cfg;
  // one action at a time per member, in order
  const run = s.queue.then(async () => {
    pulse(s);
    try { return await IMPL[name](s, args, { onRequest }); }
    finally { await frame(s); }
  });
  s.queue = run.catch(() => {});
  return run;
}

export const toolSpecs = BROWSER_TOOLS;
