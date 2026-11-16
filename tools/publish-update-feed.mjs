// Update metadata lives on an isolated branch; release assets stay limited to desktop downloads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const FEED_URL = 'https://raw.githubusercontent.com/DigitalDreams-Lab/OpenVorld/updates';
export const MANIFESTS = ['latest-arm64-mac.yml', 'latest-x64-mac.yml', 'latest-x64.yml', 'latest-x64-linux.yml'];
const SUFFIXES = ['mac-arm64.zip', 'mac-x64.zip', 'win-x64.exe', 'linux-x86_64.AppImage'];
export function updateFeedFiles(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable release version is required.');
  const base = `https://github.com/DigitalDreams-Lab/OpenVorld/releases/download/v${version}/`;
  return MANIFESTS.map((name, index) => {
    const info = YAML.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (info.version !== version || !info.releaseNotes?.trim() || info.files?.length !== 1) throw new Error(`Incomplete update manifest: ${name}`);
    const file = info.files[0];
    if (file.url !== `OpenVorld-${version}-${SUFFIXES[index]}` || !file.sha512 || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`Unexpected desktop artifact in ${name}`);
    const url = base + encodeURIComponent(file.url);
    const content = YAML.stringify({ version, files: [{ url, sha512: file.sha512, size: file.size }], path: url, sha512: file.sha512, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate });
    return { path: name, mode: '100644', type: 'blob', content };
  });
}

export async function publishUpdateFeed(files, { token = process.env.GH_TOKEN, fetcher = fetch } = {}) {
  if (!token) throw new Error('GitHub authentication is required to publish the update feed.');
  const request = async (route, method = 'GET', body, optional = false) => {
    const response = await fetcher('https://api.github.com/repos/DigitalDreams-Lab/OpenVorld' + route, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'OpenVorld-release' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`Update feed publication failed (${response.status} ${method} ${route}).`);
    return response.json();
  };
  const current = await request('/git/ref/heads/updates', 'GET', undefined, true);
  if (current) {
    const previous = await request(`/contents/${MANIFESTS[0]}?ref=${current.object.sha}`);
    const before = YAML.parse(Buffer.from(previous.content, 'base64').toString('utf8')).version;
    const after = YAML.parse(files[0].content).version;
    if (![before, after].every(version => /^\d+\.\d+\.\d+$/.test(version))) throw new Error('Cannot compare invalid update feed versions.');
    const compare = (a, b) => a.split('.').reduce((result, part, i) => result || Math.sign(Number(part) - Number(b.split('.')[i])), 0);
    if (compare(after, before) < 0) throw new Error(`Refusing to roll the update feed back from ${before} to ${after}.`);
  }
  const tree = await request('/git/trees', 'POST', { tree: files });
  const commit = await request('/git/commits', 'POST', { message: `Update feed for ${YAML.parse(files[0].content).version}`, tree: tree.sha, parents: current ? [current.object.sha] : [] });
  if (current) await request('/git/refs/heads/updates', 'PATCH', { sha: commit.sha, force: false });
  else await request('/git/refs', 'POST', { ref: 'refs/heads/updates', sha: commit.sha });
  return { url: FEED_URL, commit: commit.sha };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  console.log(JSON.stringify(await publishUpdateFeed(updateFeedFiles(process.argv[2] || 'dist', version))));
}
