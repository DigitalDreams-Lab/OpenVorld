// Development: start the server and the Vite client with one shared per-launch token.
//   npm run dev [-- --home DIR]
// A git-ignored .openvorld-dev.json can pin the data folder and ports: {"home":"../openvorld-data","port":4329,"client_port":5185}
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const i = process.argv.indexOf('--home');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let local = {};
try { local = JSON.parse(fs.readFileSync(path.join(root, '.openvorld-dev.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const env = { ...process.env, OV_TOKEN: crypto.randomBytes(24).toString('hex') };
if (!env.OPENVORLD_HOME && local.home) env.OPENVORLD_HOME = path.resolve(root, local.home);
if (!env.OV_PORT && local.port) env.OV_PORT = String(local.port);
if (!env.OV_CLIENT_PORT && local.client_port) env.OV_CLIENT_PORT = String(local.client_port);
if (i > 0) env.OPENVORLD_HOME = path.resolve(process.argv[i + 1]);
const run = (cmd, args) => spawn(cmd, args, { cwd: root, env, stdio: 'inherit' });
// the server restarts on server, pack and library edits; Vite reloads the client
const procs = [run(process.execPath, ['--watch', '--watch-path=engine/server', '--watch-path=packs', '--watch-path=tools/lib', 'engine/server/index.mjs']), run(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'engine/client/vite.config.mjs'])];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) { console.error('a process exited with', code); stop(); } });
