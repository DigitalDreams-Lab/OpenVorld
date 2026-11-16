// Spawn an agent CLI, feed the prompt, yield parsed JSON lines. Strips the parent harness's session
// variables so a nested agent CLI behaves like a fresh one.
import { spawn } from 'node:child_process';

export function cleanEnv() {
  const env = { ...process.env };
  // The desktop engine uses Electron's bundled Node, but agent CLIs must launch normally.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OV_NODE_EXECUTABLE;
  delete env.OV_DESKTOP;
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN') || k.startsWith('CODEX_SANDBOX')) delete env[k];
  return env;
}

export function runJsonLines({ cmd, args, cwd, stdin, env, signal, onLine, onStderr }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ? { ...cleanEnv(), ...env } : cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', kill, { once: true });
    let buf = '', err = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onLine(JSON.parse(line)); } catch { /* non-JSON noise */ }
      }
    });
    child.stderr.on('data', (d) => { err += d; onStderr?.(String(d)); });
    // A CLI may close input immediately (for example on an authentication error).
    // Keep reading its output and exit status instead of throwing an unhandled pipe error.
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
        child.kill('SIGTERM');
        reject(new Error(`${cmd}: ${error.message}`));
      }
    });
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (buf.trim()) { try { onLine(JSON.parse(buf)); } catch {} }
      if (signal?.aborted) return reject(new Error('stopped by the founder'));
      code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} exited with ${code}`));
    });
    if (stdin != null) child.stdin.end(stdin); else child.stdin.end();
  });
}
