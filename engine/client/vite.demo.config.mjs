// The playable web demo (npm run demo:build): the real client with demo/api.ts in place of src/api.ts, so it runs with
// no server. Data and art come from tools/demo-build.mjs (demo/generated/public). Output: release/demo.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const realApi = path.join(here, 'src/api.ts'), demoApi = path.join(here, 'demo/api.ts');

// Every import of src/api.ts (from any client module) gets the demo engine instead.
const swapApi = {
  name: 'openvorld-demo-api',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !/(^|\/)api(\.ts)?$/.test(source)) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved && path.normalize(resolved.id) === realApi ? demoApi : null;
  },
};

export default defineConfig({
  root: path.join(here, 'demo'),
  base: './',
  publicDir: path.join(here, 'demo/generated/public'),
  plugins: [react(), swapApi],
  define: { __OPENVORLD_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version) },
  server: { host: '127.0.0.1', port: 4791, fs: { allow: [path.join(here, '../..')] } },
  preview: { host: '127.0.0.1', port: 4791 },
  build: { outDir: path.join(here, '../../release/demo'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
});
