import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataHome, desktopPath, engineEnvironment, isAppUrl, isExternalUrl, readSettings, writeSettings } from './runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.setName('OpenVorld');
app.setAppUserModelId('org.openvorld.desktop');
// Allows automated desktop checks to isolate window preferences as well as world data.
if (process.env.OV_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.OV_DESKTOP_USER_DATA));
const settingsFile = path.join(app.getPath('userData'), 'desktop.json');
let engine, window, origin, home, settings, log, quitting = false, shutdown = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (origin) createWindow(); });
  app.whenReady().then(start).catch(fatal);
  app.on('activate', () => { if (!window && origin && !quitting) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (shutdown) return;
    event.preventDefault();
    if (!quitting) quit();
  });
}

async function start() {
  settings = readSettings(settingsFile);
  home = dataHome({ settings, root, development: !app.isPackaged });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(app.getPath('logs'), { recursive: true });
  const logFile = path.join(app.getPath('logs'), 'engine.log');
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.previous');
  log = fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
  log.on('error', error => console.error('Desktop log:', error.message));
  const env = engineEnvironment({ home, token: crypto.randomBytes(32).toString('hex'), executable: process.execPath, cliPath: desktopPath() });
  engine = fork(path.join(root, 'engine/server/index.mjs'), [], {
    execPath: process.execPath, execArgv: [], cwd: home, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  engine.stdout.on('data', data => log.write(data));
  engine.stderr.on('data', data => log.write(data));
  engine.on('exit', (code, signal) => {
    if (quitting || shutdown) return;
    fatal(new Error(`The local engine stopped (${signal ?? code}). Your saved worlds are kept in ${home}.`));
  });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The local engine did not start within 30 seconds.')), 30_000);
    const finish = (error, message) => { clearTimeout(timeout); engine.off('message', messageHandler); engine.off('error', errorHandler); engine.off('exit', exitHandler); error ? reject(error) : resolve(message); };
    const messageHandler = message => { if (message?.type === 'desktop:ready') finish(null, message); };
    const errorHandler = error => finish(error);
    const exitHandler = code => finish(new Error(`The local engine exited during startup (${code}).`));
    engine.on('message', messageHandler); engine.once('error', errorHandler); engine.once('exit', exitHandler);
  });
  origin = `http://127.0.0.1:${ready.port}`;
  installMenu();
  createWindow();
}

function createWindow() {
  window = new BrowserWindow({
    width: settings.width ?? 1440, height: settings.height ?? 960, minWidth: 900, minHeight: 640,
    title: 'OpenVorld', backgroundColor: '#171c24', show: false,
    icon: path.join(root, 'desktop/assets/icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => { if (isExternalUrl(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!isAppUrl(url, origin)) { event.preventDefault(); if (isExternalUrl(url)) shell.openExternal(url).catch(() => {}); } });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const audio = permission === 'media' && details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio');
    const notifications = permission === 'notifications';       // "someone needs you" while the window is in the background
    callback(Boolean(webContents === contents && isAppUrl(details.requestingUrl ?? webContents.getURL(), origin) && (audio || notifications)));
  });
  contents.session.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' ${origin.replace('http:', 'ws:')}; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
  window.once('ready-to-show', () => window?.show());
  window.on('close', () => {
    if (!window.isMaximized() && !window.isFullScreen()) {
      const [width, height] = window.getSize();
      settings = { ...settings, width, height }; writeSettings(settingsFile, settings);
    }
  });
  window.on('closed', () => { window = null; });
  contents.on('did-fail-load', (_event, code, description, url, mainFrame) => { if (mainFrame && code !== -3) fatal(new Error(`Could not open the app: ${description} (${url}).`)); });
  window.loadURL(origin).catch(fatal);
}

function installMenu() {
  const showData = () => shell.openPath(home);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'OpenVorld', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'Open Data Folder', click: showData },
      { label: 'Choose Data Folder…', click: async () => {
        const result = await dialog.showOpenDialog({ title: 'Choose your OpenVorld data folder', defaultPath: home, properties: ['openDirectory', 'createDirectory'] });
        if (result.canceled || !result.filePaths[0] || result.filePaths[0] === home) return;
        const response = await dialog.showMessageBox({ type: 'question', message: 'Switch data folders and restart?', detail: 'Your current worlds will stay in their existing folder. Active agent runs will stop.', buttons: ['Switch and Restart', 'Cancel'], cancelId: 1 });
        if (response.response !== 0) return;
        settings = { ...settings, home: result.filePaths[0] }; writeSettings(settingsFile, settings);
        // OPENVORLD_HOME is an explicit launch override and takes precedence over settings.
        delete process.env.OPENVORLD_HOME;
        app.relaunch(); quit(true);
      } },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('logs')) }] },
  ]));
}

async function engineStatus() {
  if (!engine?.connected) return 0;
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(0), 1500);
    const handler = message => { if (message?.type === 'desktop:status') finish(message.active); };
    const finish = active => { clearTimeout(timer); engine.off('message', handler); resolve(active); };
    engine.on('message', handler); engine.send({ type: 'desktop:status' }, () => {});
  });
}

async function quit(confirmed = false) {
  quitting = true;
  if (!confirmed && await engineStatus()) {
    const result = await dialog.showMessageBox({ type: 'question', message: 'Stop active agents and quit?', detail: 'Saved worlds and conversations will be kept.', buttons: ['Keep Working', 'Stop and Quit'], cancelId: 0, defaultId: 0 });
    if (result.response !== 1) { quitting = false; if (!window && origin) createWindow(); return; }
  }
  if (engine && engine.exitCode === null && engine.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { engine.kill('SIGKILL'); resolve(); }, 8000);
      engine.once('exit', () => { clearTimeout(timer); resolve(); });
      if (engine.connected) engine.send({ type: 'desktop:shutdown' }, () => {}); else engine.kill();
    });
  }
  shutdown = true; log?.end(); app.quit();
}

function fatal(error) {
  if (shutdown || quitting) return;
  console.error(error);
  dialog.showErrorBox('OpenVorld could not continue', `${error.message}\n\nLogs: ${app.getPath('logs')}`);
  quit(true);
}
