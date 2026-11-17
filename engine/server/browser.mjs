// A small browser for the crew. Each member that browses gets its OWN private Chrome profile (no cookies of yours),
// driven headless through playwright-core and the Chrome or Edge already installed on this computer.
//
// Two kinds of browsing, never mixed:
//  - plain:  a clean profile. Pages must be on a domain the member holds a net.fetch writ for.
//  - signed: the founder's saved sign-ins (see openSignIn). Only with browser_open{signed_in:true}, only on domains
//            the member holds a net.session writ for, and anything that posts, sends, buys or deletes (a submit-type
//            click, a form POST, Enter in a comment box) also needs a net.act writ. The founder signs in themselves, in a
//            real window; members never see or type passwords.
//
// Safety, enforced here on every call (not by the model):
//  - writs are re-read on each call, so one granted a moment ago applies at once; redirects, link clicks and frames
//    are checked the same way (redirects are followed by us, one hop at a time: Chrome follows them inside its network
//    stack without letting us intercept);
//  - addresses on this computer or network (localhost, 192.168.x.x, ...) are always blocked, so a page can never reach
//    the OpenVorld server or your router;
//  - no typing into password or payment fields, no downloads, no file: or other non-web addresses.
//
// While a member browses, small JPEG frames are pushed to the game ({type:'browser', role, url, title, image, active,
// signed}) so the founder can watch.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { grantsOf } from './gate.mjs';
import { BROWSER_TOOLS, isBrowserTool } from './browser-tools.mjs';
import { vaultDir } from './house.mjs';
import { captureSignInStorage } from './signin-storage.mjs';

const sessions = new Map();     // `${vorld}:${role}:${kind}` -> session
const current = new Map();      // `${vorld}:${role}` -> the kind the member last opened a page in
let shared = null;              // the one headless Chrome process every session's context lives in
const signins = new Map();      // `${vorld}:${role}` -> the open sign-in window
const openingSignins = new Map(); // concurrent requests share one launch

const DEFAULTS = {
  enabled: true, viewport: { width: 1024, height: 640 }, text_chars: 12000, max_elements: 60,
  idle_seconds: 300, active_seconds: 6, frame_ms: 900, jpeg_quality: 55, nav_timeout_seconds: 20, allow_private: false,
  act_words: ['post', 'publish', 'send', 'submit', 'buy', 'purchase', 'pay', 'order', 'checkout', 'delete', 'remove', 'confirm', 'subscribe', 'unsubscribe', 'follow', 'unfollow', 'like', 'comment', 'reply', 'share', 'upload', 'save', 'update', 'book', 'reserve', 'approve', 'accept', 'withdraw', 'transfer', 'donate', 'schedule', 'sign out', 'log out', 'logout'],
};
const cfgOf = (ctx) => ({ ...DEFAULTS, ...(ctx.interactions?.agent?.browser ?? {}), ...(process.env.OV_BROWSER_ALLOW_PRIVATE === '1' ? { allow_private: true } : {}) });

// ---------- Chrome ----------
const CHROME_PATHS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
};
// The founder's default browser goes first when it is one of these (macOS only for now). Only browsers already in
// CHROME_PATHS are listed: Playwright starts them with its own flags (--remote-debugging-pipe, a temporary
// --user-data-dir), and other Chromium-based browsers (Dia, Arc, ...) are not known to honour those.
const DEFAULT_IDS = {
  darwin: { 'com.google.chrome': 'Google Chrome', 'com.microsoft.edgemac': 'Microsoft Edge', 'org.chromium.chromium': 'Chromium', 'com.brave.browser': 'Brave Browser' },
};
/** The bundle id that opens https links, read from the output of `defaults read ... LSHandlers`, or ''. */
export function defaultBrowserId(text) {
  const entry = String(text ?? '').split(/^\s*\},?\s*$/m).find((e) => /LSHandlerURLScheme = "?https"?;/.test(e));
  // the nested LSHandlerPreferredVersions has a LSHandlerRoleAll too, always "-"
  return [...(entry ?? '').matchAll(/LSHandlerRoleAll = "?([^";\s]+)"?;/g)].map((m) => m[1].toLowerCase()).find((id) => id !== '-') ?? '';
}
/** Which browser to use: OV_CHROME, then the founder's default browser if it is a known one, then the fixed list. */
export function pickChrome({ override = '', defaultId = '', platform = process.platform, exists = fs.existsSync } = {}) {
  const paths = CHROME_PATHS[platform] ?? [], app = DEFAULT_IDS[platform]?.[String(defaultId).toLowerCase()];
  return [override, app && paths.find((p) => p.includes(`/${app}.app/`)), ...paths].filter(Boolean).find((p) => exists(p)) ?? null;
}
/** A short name for a browser path, for the sign-in card: "Chrome", "Edge", ... or the file's own name. */
export function browserName(exe) {
  const file = String(exe ?? '').split(/[\\/]/).pop().replace(/\.exe$/i, '');
  return [[/chromium/i, 'Chromium'], [/chrome/i, 'Chrome'], [/edge/i, 'Edge'], [/brave/i, 'Brave']].find(([re]) => re.test(file))?.[1] ?? file;
}
let defaultSeen = { at: 0, id: '' };   // asked at most once a minute: findChrome runs on every sign-in state
function systemDefaultId() {
  if (process.platform !== 'darwin' || process.env.OV_CHROME) return '';
  if (defaultSeen.at && Date.now() - defaultSeen.at < 60000) return defaultSeen.id;
  let id = '';
  try { id = defaultBrowserId(execFileSync('/usr/bin/defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* no default chosen: the fixed list */ }
  defaultSeen = { at: Date.now(), id };
  return id;
}
/** The Chrome-family browser on this computer, or null. OV_CHROME can name one. */
export const findChrome = () => pickChrome({ override: process.env.OV_CHROME, defaultId: systemDefaultId() });
export const browserAvailable = () => !!findChrome();

async function chrome() {
  const exe = findChrome();
  if (!exe) throw new Error('Browsing needs Google Chrome or Microsoft Edge installed on this computer.');
  if (shared) { try { const b = await shared; if (b.isConnected()) return b; } catch { /* launch again */ } shared = null; }
  const mine = shared = import('playwright-core').then(({ chromium }) => chromium.launch({ executablePath: exe, headless: true, args: ['--disable-dev-shm-usage', '--mute-audio'] }));
  try {
    const b = await mine;
    // only this browser's own state: a slow "disconnected" from an old Chrome must not wipe a newer one
    b.on('disconnected', () => { if (shared === mine) shared = null; for (const [k, s] of sessions) if (s.browser === b) { stopTimers(s); sessions.delete(k); } });
    return b;
  } catch (e) { if (shared === mine) shared = null; throw new Error(`Could not start the browser: ${String(e.message).split('\n')[0]}`); }
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
const CAP = { plain: 'net.fetch', signed: 'net.session' };
/** The domains a member may open in a kind of browsing (plain = net.fetch writs, signed = net.session writs). */
export const domainsOf = (ctx, role, kind = 'plain') => grantsOf(ctx, role).filter((g) => g.capability === CAP[kind]).map((g) => g.scope);
export const allowsHost = (domains, host) => domains.includes('*') || domains.some((d) => host === d || host.endsWith('.' + d));
/** Does the member hold a writ of this capability that covers the host? */
const holds = (ctx, role, capability, host) => allowsHost(grantsOf(ctx, role).filter((g) => g.capability === capability).map((g) => g.scope), host);

const fail = (msg) => { throw new Error(msg); };

// ---------- the founder's saved sign-ins (one set per crew member, in its vault) ----------
const sessionFile = (ctx, role) => path.join(vaultDir(ctx, role), 'session.json');
/** The member's saved sign-ins (Playwright storage state: cookies and local storage), or undefined. */
function loadSession(ctx, role) { try { return JSON.parse(fs.readFileSync(sessionFile(ctx, role), 'utf8')); } catch { return undefined; } }
export function saveSession(ctx, role, state) { fs.writeFileSync(sessionFile(ctx, role), JSON.stringify(state), { mode: 0o600 }); }
const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
const siteOf = (domain) => { const p = String(domain).replace(/^\./, '').toLowerCase().split('.'); return p.length > 2 && SLD.has(p.at(-2)) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
/** Sites the founder has signed in to for this member: [{ domain, cookies }], most cookies first. */
export function sessionSites(ctx, role) {
  const counts = new Map();
  for (const c of loadSession(ctx, role)?.cookies ?? []) counts.set(siteOf(c.domain), (counts.get(siteOf(c.domain)) ?? 0) + 1);
  return [...counts].map(([domain, cookies]) => ({ domain, cookies })).sort((a, b) => b.cookies - a.cookies || a.domain.localeCompare(b.domain));
}
/** Has the founder signed in to a site that covers this host (www.youtube.com is covered by youtube.com)? */
export const signedInTo = (ctx, role, host) => sessionSites(ctx, role).some((s) => host === s.domain || host.endsWith('.' + s.domain));
export const signInState = (ctx, role, site = '') => ({ role, available: browserAvailable(), browser: browserName(findChrome()), open: signins.has(`${ctx.id}:${role}`), sites: sessionSites(ctx, role), ...(site ? { site, signed: signedInTo(ctx, role, site) } : {}) });

/**
 * Open a real, visible Chrome window for the founder to sign in to sites AS this member. Whatever they sign in to is
 * saved periodically to the member's vault (cookies, local storage and IndexedDB, on this computer only); the
 * member uses it only through writs. Resolves once the window is up. `emit` hears { type: 'signin', role, open, sites }.
 */
export async function openSignIn(ctx, role, { url = '', emit = null } = {}) {
  let start = '';
  if (url) {
    let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`); } catch { fail('that is not a web address'); }
    if (!/^https?:$/.test(u.protocol)) fail('that is not a web address');
    start = u.href;
  }
  const wkey = `${ctx.id}:${role}`;
  if (openingSignins.has(wkey)) { await openingSignins.get(wkey); return signInState(ctx, role); }
  if (signins.has(wkey)) { await signins.get(wkey).page.bringToFront().catch(() => {}); return signInState(ctx, role); }
  const opening = launchSignIn(ctx, role, wkey, start, emit);
  openingSignins.set(wkey, opening);
  try { await opening; } finally { if (openingSignins.get(wkey) === opening) openingSignins.delete(wkey); }
  return signInState(ctx, role);
}

async function launchSignIn(ctx, role, wkey, start, emit) {
  const exe = findChrome();
  if (!exe) fail('Signing in needs Google Chrome or Microsoft Edge installed on this computer.');
  const { chromium } = await import('playwright-core');
  // not flagged as automated: this is the founder's own window, and some sign-in pages refuse automated browsers
  const browser = await chromium.launch({ executablePath: exe, headless: process.env.OV_SIGNIN_HEADLESS === '1', ignoreDefaultArgs: ['--enable-automation'], args: ['--no-first-run', '--no-default-browser-check'] });
  let previous = loadSession(ctx, role) ?? { cookies: [], origins: [] };
  let context, page;
  try { context = await browser.newContext({ viewport: null, storageState: previous }); page = await context.newPage(); }
  catch (e) { await browser.close().catch(() => {}); throw e; }
  const w = { browser, context, page, timer: null, debounce: null };
  signins.set(wkey, w);
  let saving = null, closed = false;
  const save = () => {
    if (closed) return Promise.resolve();
    if (saving) return saving;
    saving = captureSignInStorage(context, previous).then((st) => {
      if (!closed) { saveSession(ctx, role, st); previous = st; }
    }).catch(() => {}).finally(() => { saving = null; });
    return saving;
  };
  w.save = save;
  w.timer = setInterval(save, 3000); w.timer.unref?.();
  const later = () => { clearTimeout(w.debounce); w.debounce = setTimeout(save, 600); };
  context.on('page', (p) => p.on('framenavigated', later));
  w.page.on('framenavigated', later);
  browser.on('disconnected', async () => {
    closed = true;
    clearInterval(w.timer); clearTimeout(w.debounce);
    if (signins.get(wkey) === w) signins.delete(wkey);
    await closeKind(ctx, 'signed', role);          // the member picks up the new sign-ins the next time it opens a page
    emit?.({ type: 'signin', ...signInState(ctx, role) });
  });
  if (start) await w.page.goto(start, { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
  emit?.({ type: 'signin', ...signInState(ctx, role) });
}
/** For tests: the member's open sign-in window ({ context, page, save, browser }), or null. */
export const signInWindow = (ctx, role) => signins.get(`${ctx.id}:${role}`) ?? null;

/** Delete every saved sign-in of the member. */
export async function forgetSignIns(ctx, role) {
  try { fs.rmSync(sessionFile(ctx, role), { force: true }); } catch { /* nothing saved */ }
  await closeKind(ctx, 'signed', role);
  return signInState(ctx, role);
}

// ---------- sessions ----------
const rkey = (ctx, role) => `${ctx.id}:${role}`;
const skey = (ctx, role, kind) => `${rkey(ctx, role)}:${kind}`;
const stopTimers = (s) => { clearInterval(s.timer); clearTimeout(s.idle); s.timer = s.idle = null; };

async function sessionOf(ctx, role, kind) {
  const key = skey(ctx, role, kind), cfg = cfgOf(ctx);
  let s = sessions.get(key);
  if (s?.page && !s.page.isClosed()) return s;
  const browser = await chrome();
  const ua = `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36 OpenVorld/1`;
  const context = await browser.newContext({ viewport: cfg.viewport, acceptDownloads: false, serviceWorkers: 'block', locale: 'en-US', userAgent: ua, permissions: [], ...(kind === 'signed' ? { storageState: loadSession(ctx, role) } : {}) });
  s = { key, ctx, role, kind, browser, context, page: null, queue: Promise.resolve(), denied: [], hops: 0, last: null, hash: '', timer: null, idle: null, activeUntil: 0, emit: null, cfg };
  context.on('page', (p) => { s.page = p; p.on('dialog', (d) => d.dismiss().catch(() => {})); });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch { return route.abort('blockedbyclient'); }
    if (!/^https?:$/.test(u.protocol)) return route.abort('blockedbyclient');
    // a blocked page the member asked for is reported; a blocked frame, ad or tracker on an allowed page is just not loaded
    const main = req.resourceType() === 'document' && (() => { try { return !req.frame().parentFrame(); } catch { return true; } })();
    if (!s.cfg.allow_private && await isPrivateHost(u.hostname)) { if (main) s.denied.push({ host: u.hostname, private: true }); return route.abort('blockedbyclient'); }
    if (req.resourceType() !== 'document') return route.continue();
    // pages and frames: the domain must be granted, and redirects are followed HERE, one hop at a time
    if (!allowsHost(domainsOf(s.ctx, s.role, s.kind), u.hostname)) { if (main) s.denied.push({ host: u.hostname, url: u.href }); return route.abort('blockedbyclient'); }
    // a form submission (POST) while signed in changes things as the founder
    if (s.kind === 'signed' && !['GET', 'HEAD'].includes(req.method()) && !holds(s.ctx, s.role, 'net.act', u.hostname)) { if (main) s.denied.push({ host: u.hostname, url: u.href, act: true }); return route.abort('blockedbyclient'); }
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
  if (![...sessions.values()].some((x) => x.ctx.id === s.ctx.id && x.role === s.role)) { current.delete(rkey(s.ctx, s.role)); s.emit?.({ type: 'browser', role: s.role, closed: true }); }
  await s.context.close().catch(() => {});
  if (!sessions.size && shared) { const b = shared; shared = null; b.then((x) => x.close()).catch(() => {}); }
}
async function closeKind(ctx, kind, role = null) { for (const s of [...sessions.values()]) if (s.ctx.id === ctx.id && s.kind === kind && (!role || s.role === role)) await closeSession(s); }
export async function close(ctx, role) { for (const s of [...sessions.values()]) if (s.ctx.id === ctx.id && s.role === role) await closeSession(s); }
export async function closeAll() {
  await Promise.allSettled([...openingSignins.values()]);
  for (const s of [...sessions.values()]) await closeSession(s);
  for (const w of [...signins.values()]) { clearInterval(w.timer); clearTimeout(w.debounce); await w.save(); await w.browser.close().catch(() => {}); }
  signins.clear();
}

/** The last frame this member's browser showed (for a panel opened later), or null. */
export function latest(ctx, role) {
  const list = [...sessions.values()].filter((s) => s.ctx.id === ctx.id && s.role === role && s.last).sort((a, b) => b.last.at - a.last.at);
  return list[0] ? { ...list[0].last, active: !!list[0].timer, signed: list[0].kind === 'signed' } : null;
}

// ---------- the live view ----------
async function frame(s) {
  if (!s.page || s.page.isClosed()) return;
  try {
    const buf = await s.page.screenshot({ type: 'jpeg', quality: s.cfg.jpeg_quality, timeout: 4000 });
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    s.last = { url: s.page.url(), title: await s.page.title().catch(() => ''), image: buf.toString('base64'), at: Date.now() };
    if (hash !== s.hash || s.final) { s.hash = hash; s.emit?.({ type: 'browser', role: s.role, ...s.last, active: !!s.timer, signed: s.kind === 'signed' }); }
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
  if (here && /^https?:$/.test(here.protocol) && (!allowsHost(domainsOf(s.ctx, s.role, s.kind), here.hostname) || (!s.cfg.allow_private && await isPrivateHost(here.hostname)))) {
    await s.page.goto('about:blank').catch(() => {});
    fail(`the page ended up on ${here.hostname}, which this member may not read`);
  }
  const signed = s.kind === 'signed';
  const actSource = `(?:^|[^a-z])(?:${(s.cfg.act_words ?? []).map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:[^a-z]|$)`;
  const d = await s.page.evaluate(({ maxEls, signed, actSource }) => {
    document.querySelectorAll('[data-ov-id]').forEach((e) => { e.removeAttribute('data-ov-id'); e.removeAttribute('data-ov-act'); });
    const actRe = new RegExp(actSource, 'i');
    const visible = (e) => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none' && r.bottom > -innerHeight && r.top < innerHeight * 4; };
    const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.getAttribute('title') || e.name || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    // while signed in, a click that submits a form (not a plain search) or whose label says it posts, sends, buys or deletes acts as the founder
    const acts = (e, tag, type, text) => {
      if (!signed) return false;
      const submits = type === 'submit' || (tag === 'button' && !type && e.form);
      if (submits && e.form && (e.form.getAttribute('method') || 'get').toLowerCase() !== 'get') return true;
      return actRe.test(text);
    };
    const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]')].filter(visible).slice(0, maxEls);
    const items = els.map((e, i) => {
      e.setAttribute('data-ov-id', String(i + 1));
      const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase(), text = label(e);
      const typing = (tag === 'input' && !['submit', 'button', 'reset', 'checkbox', 'radio'].includes(type)) || tag === 'textarea' || tag === 'select';
      const act = !typing && acts(e, tag, type, text);
      if (act) e.setAttribute('data-ov-act', '1');
      const flag = act ? ' (acts as you: needs approval)' : '';
      if (tag === 'a') return `[${i + 1}] link "${text}" → ${String(e.href).slice(0, 120)}${flag}`;
      if (tag === 'select') return `[${i + 1}] select "${text || e.name}" = "${e.value}"`;
      if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) return `[${i + 1}] button "${text}"${flag}`;
      if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return `[${i + 1}] ${type} "${text}" ${e.checked ? '(checked)' : ''}`;
      if (tag === 'input' || tag === 'textarea') return type === 'password' ? `[${i + 1}] password field (you cannot type here)` : `[${i + 1}] field${type ? `(${type})` : ''} "${text}" = "${String(e.value).slice(0, 60)}"`;
      return `[${i + 1}] button "${text}"${flag}`;
    });
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    return { title: document.title, url: location.href, text: document.body?.innerText ?? '', items, percent: Math.min(100, Math.round((scrollY / max) * 100)) };
  }, { maxEls, signed, actSource });
  const text = d.text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters; use browser_read with scroll to see more)` : text;
  return `Page: ${d.title || '(no title)'}\nURL: ${d.url}${signed ? '\nSigned in as the founder: be careful, and never act without approval' : ''}\nScrolled: ${d.percent}%\n\n${body || '(no text on this page)'}\n\nElements:\n${d.items.join('\n') || '(none)'}`;
}

/** Turn pages the browser refused into writ requests, and say so. */
function settle(s, onRequest) {
  const denied = s.denied.splice(0);
  const seen = new Set(), notes = [];
  for (const d of denied) {
    const id = `${d.host}|${d.act ? 'act' : ''}`;
    if (seen.has(id)) continue; seen.add(id);
    if (d.private) { notes.push(`${d.host} is on this computer or network and is always blocked`); continue; }
    if (d.act) { onRequest?.({ capability: 'net.act', scope: d.host, why: `submit a form at ${String(d.url ?? d.host).slice(0, 80)}` }); notes.push(`submitting at ${d.host} acts as the founder. The founder has been asked to approve; wait for their answer`); continue; }
    onRequest?.({ capability: CAP[s.kind], scope: d.host, why: `open ${String(d.url ?? d.host).slice(0, 80)}${s.kind === 'signed' ? ' signed in as you' : ''}` });
    notes.push(`no writ for ${d.host}. The founder has been asked; wait for their answer`);
  }
  return notes;
}

const settled = async (s) => { await s.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}); await s.page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {}); };

/** Acting as the founder (signed in only): ask for a net.act writ, or say why not. */
function needAct(s, onRequest, what) {
  const host = (() => { try { return new URL(s.page.url()).hostname; } catch { return ''; } })();
  if (holds(s.ctx, s.role, 'net.act', host)) return;
  onRequest?.({ capability: 'net.act', scope: host, why: what });
  fail(`${what} would act as the founder on ${host}. The founder has been asked to approve; wait for their answer`);
}

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
    if (s.kind === 'signed' && (await el.first().getAttribute('data-ov-act'))) {
      const text = await el.first().evaluate((e) => (e.getAttribute('aria-label') || e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 60));
      needAct(s, o.onRequest, `clicking "${text}"`);
    }
    await el.first().click({ timeout: 5000 }).catch((e) => fail(`could not click [${id}]: ${String(e.message).split('\n')[0]}`));
    await settled(s);
    const notes = settle(s, o.onRequest);
    if (notes.length) { if (/^chrome-error:/.test(s.page.url())) await s.page.goBack().catch(() => {}); fail(`${notes.join('; ')}. You are still on the previous page`); }
    return snapshot(s);
  },
  async browser_type(s, { id, text, submit }, o) {
    const el = s.page.locator(`[data-ov-id="${Number(id)}"]`);
    if (!(await el.count())) fail(`there is no element [${id}] on this page; call browser_read to get the current numbers`);
    const info = await el.first().evaluate((e) => ({ type: (e.getAttribute('type') || '').toLowerCase(), hint: `${e.name ?? ''} ${e.id ?? ''} ${e.getAttribute('autocomplete') ?? ''} ${e.getAttribute('aria-label') ?? ''}`, label: (e.getAttribute('aria-label') || e.placeholder || e.name || '').slice(0, 40), inForm: !!e.form, method: e.form ? (e.form.getAttribute('method') || 'get').toLowerCase() : null }));
    if (info.type === 'password' || /passw|passwd|card.?n|cc-|cvv|cvc|\bssn\b|iban/i.test(info.hint)) fail('you cannot type passwords or payment details; ask the founder to do that themselves');
    // Enter in a signed-in comment box or message field posts it; Enter in a plain search form does not
    if (submit && s.kind === 'signed' && !(info.inForm && info.method === 'get') && info.type !== 'search') needAct(s, o.onRequest, `pressing Enter in "${info.label || 'a field'}"`);
    await el.first().fill(String(text), { timeout: 5000 }).catch((e) => fail(`could not type into [${id}]: ${String(e.message).split('\n')[0]}`));
    if (submit) { await s.page.keyboard.press('Enter'); await settled(s); const notes = settle(s, o.onRequest); if (notes.length) fail(notes.join('; ')); }
    return snapshot(s);
  },
  async browser_back(s) {
    await s.page.goBack({ timeout: 8000 }).catch(() => fail('there is no earlier page'));
    await settled(s);
    return snapshot(s);
  },
  async browser_screenshot(s, { post = true, caption = '' } = {}, o) {
    if (!s.page || s.page.isClosed()) fail('no page is open to screenshot');
    const buf = await s.page.screenshot({ type: 'jpeg', quality: s.cfg.jpeg_quality ?? 85, timeout: 5000 });
    const url = s.page.url(), title = await s.page.title().catch(() => '');
    const b64 = buf.toString('base64');
    const desc = caption ? ` "${caption}"` : '';
    const note = `Screenshot of ${url}${title ? ` ("${title}")` : ''}${desc} (${buf.length} bytes)`;
    return {
      output: note,
      images: [{ data: b64, type: 'image/jpeg', name: 'screenshot.jpg' }],
      image: { data: b64, type: 'image/jpeg' },
      post: post !== false,
      caption: caption || undefined,
    };
  },
};

/**
 * Run one browser tool for a member. `emit` receives live frames; `onRequest` receives writ requests for sites the
 * member may not open yet (net.fetch), signed-in use (net.session) or acting as the founder (net.act). Rejects with a
 * plain message the model can act on.
 */
export async function callTool(ctx, role, name, args = {}, { emit = null, onRequest = null } = {}) {
  if (!isBrowserTool(name)) fail(`unknown tool ${name}`);
  const cfg = cfgOf(ctx);
  if (cfg.enabled === false) fail('the browser is switched off for this vorld');
  let kind;
  // before opening Chrome at all: a page the member has no writ for, or that is private, never starts a browser
  if (name === 'browser_open') {
    let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(args.url)) ? String(args.url) : `https://${args.url}`); } catch { fail('that is not a web address'); }
    if (!/^https?:$/.test(u.protocol)) fail('only http and https addresses can be opened');
    if (!cfg.allow_private && await isPrivateHost(u.hostname)) fail(`${u.hostname} is on this computer or network and is always blocked`);
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !cfg.allow_private) fail('open sites by their domain name, not by an IP address');
    kind = args.signed_in === true ? 'signed' : 'plain';
    // no sign-in for this site yet: a card in the chat lets the founder sign in right there and approve
    if (kind === 'signed' && !signedInTo(ctx, role, u.hostname)) {
      onRequest?.({ capability: 'net.session', scope: u.hostname, signin: true, why: `sign in to ${u.hostname} for you, then let you use it` });
      fail(`the founder is not signed in to ${u.hostname} for you yet. A card in the chat asks them to sign in and approve; wait for their answer, then try again.`);
    }
    if (!allowsHost(domainsOf(ctx, role, kind), u.hostname)) {
      onRequest?.({ capability: CAP[kind], scope: u.hostname, why: `open ${u.href.slice(0, 80)}${kind === 'signed' ? ' signed in as you' : ''}` });
      fail(`no writ for ${u.hostname}${kind === 'signed' ? ' (signed in)' : ''}. The founder has been asked; wait for their answer.`);
    }
    current.set(rkey(ctx, role), kind);
  } else {
    kind = current.get(rkey(ctx, role));
    if (!kind || !sessions.has(skey(ctx, role, kind))) fail('no page is open yet; use browser_open first');
  }
  const s = await sessionOf(ctx, role, kind);
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
