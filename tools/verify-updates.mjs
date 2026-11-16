// Reject broken feeds before release publication, including missing or altered installers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export async function verifyUpdates(directory, version) {
  const manifests = fs.readdirSync(directory).filter(name => /^latest-.*\.yml$/.test(name));
  if (!manifests.length) throw new Error('No architecture-specific update manifests were generated.');
  for (const name of manifests) {
    const info = YAML.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (info.version !== version || !info.releaseNotes?.trim() || !info.files?.length) throw new Error(`Incomplete update manifest: ${name}`);
    for (const file of info.files) {
      if (typeof file.url !== 'string' || path.basename(file.url) !== file.url || /[\\/]/.test(file.url)) throw new Error(`Invalid installer path in ${name}`);
      const installer = path.join(directory, file.url);
      if (fs.statSync(installer).size !== file.size) throw new Error(`Installer size mismatch: ${file.url}`);
      const hash = crypto.createHash('sha512');
      for await (const bytes of fs.createReadStream(installer)) hash.update(bytes);
      if (hash.digest('base64') !== file.sha512) throw new Error(`Installer checksum mismatch: ${file.url}`);
    }
  }
  return manifests;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const manifests = await verifyUpdates(process.argv[2] || 'release', version);
  console.log(`Verified ${manifests.join(', ')}`);
}
