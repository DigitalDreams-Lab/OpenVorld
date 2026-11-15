import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `http://127.0.0.1:${process.env.OV_PORT ?? 4317}`;
// Dev only: inject the per-launch token the same way the server does for the built client.
const token = () => ({
  name: 'ov-token',
  apply: 'serve',                  // a build must not carry an empty token tag (the server injects the real one)
  transformIndexHtml: (html) => html.replace('</head>', `<meta name="ov-token" content="${process.env.OV_TOKEN ?? ''}"></head>`),
});

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react(), token()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.OV_CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: SERVER, changeOrigin: true }, '/ws': { target: SERVER.replace('http', 'ws'), ws: true, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
