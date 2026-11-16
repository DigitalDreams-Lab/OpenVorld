// Main-process updates only. No renderer privileges or credentials are needed.
export const RELEASES = 'https://github.com/DigitalDreams-Lab/OpenVorld/releases';
const API = 'https://api.github.com/repos/DigitalDreams-Lab/OpenVorld/releases/latest';

export function newerVersion(candidate, current) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function updateCapability({ platform, arch, macSigned = false, appImage = false }) {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return macSigned;
  if (platform === 'win32' && arch === 'x64') return true;
  return platform === 'linux' && arch === 'x64' && Boolean(appImage);
}

export function notesText(notes) {
  if (Array.isArray(notes)) return notes.map(item => `${item.version}\n${notesText(item.note)}`).join('\n\n').slice(0, 12000);
  return String(notes || 'See the release page for the full changelog.')
    .replace(/<\/?(?:p|li|div|br|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').slice(0, 12000).trim();
}

export async function latestRelease(fetcher = fetch) {
  const response = await fetcher(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenVorld-desktop' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}. Try again later or open the releases page.`);
  const release = await response.json();
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('No stable release is available.');
  return release;
}

export function createUpdates({ updater, version, packaged, automaticInstall, show, openExternal, install, log = console.error, fetchRelease = latestRelease, changed = () => {} }) {
  let busy = false, ready = null, prompting = false, manual = false, failed = false;
  const state = value => changed(value);
  const message = (text, detail, buttons = ['OK']) => show({ type: 'info', title: 'OpenVorld updates', message: text, detail, buttons, cancelId: buttons.length - 1, defaultId: 0 });
  const fail = async error => {
    if (failed) return;
    failed = true; busy = false; state('idle'); log(`Update: ${error.message}`);
    if (manual) await message('Could not check or download the update', 'Your installed app and saved worlds are unchanged. Check your connection and try again. You can also download an installer from Help → Releases.');
  };
  async function offerInstall() {
    if (!ready || prompting) return;
    prompting = true;
    try {
      const result = await message(`OpenVorld ${ready.version} is ready`, `${notesText(ready.releaseNotes)}\n\nRestart to install. Your saved worlds stay in their data folder. Active agent runs require confirmation before stopping.`, ['Restart and Install', 'Later']);
      if (result.response === 0) await install(() => updater.quitAndInstall(false, true));
    } finally { prompting = false; }
  }
  updater.autoDownload = true;
  // Never install during an ordinary quit or silently interrupt an agent run.
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on('error', error => { void fail(error); });
  updater.on('update-available', () => state('downloading'));
  updater.on('update-downloaded', info => { ready = info; busy = false; state('ready'); void offerInstall().catch(fail); });
  return {
    async check(userInitiated = false) {
      if (ready) return offerInstall();
      if (busy) { if (userInitiated) await message('An update check or download is in progress', 'You can keep working. OpenVorld will let you know when the update is ready.'); return; }
      if (!packaged) { if (userInitiated) await message('You are running from source', 'Use Git to update this checkout. Installed desktop releases check GitHub for updates.'); return; }
      busy = true; manual = userInitiated; failed = false; state('checking');
      try {
        if (automaticInstall) {
          const result = await updater.checkForUpdates();
          // Keep the lock through the download, including errors from the returned promise.
          if (result?.downloadPromise) await result.downloadPromise;
          else if (manual && !failed) await message('You’re up to date', `OpenVorld ${version} is installed.`);
        } else {
          const release = await fetchRelease();
          if (newerVersion(release.tag_name, version)) {
            const result = await message(`OpenVorld ${release.tag_name.slice(1)} is available`, `${notesText(release.body)}\n\nThis installation needs an installer update. Replace the app; your saved worlds stay in their data folder.`, ['Get the Update', 'Later']);
            if (result.response === 0) await openExternal(`${RELEASES}/tag/${release.tag_name}`);
          } else if (manual) await message('You’re up to date', `OpenVorld ${version} is installed.`);
        }
      } catch (error) { await fail(error); }
      finally { busy = false; if (!ready) state('idle'); }
    },
  };
}
