// Runs the real desktop window against the live Vite dev server, so Mica, app
// icons, native dialogs and the tray can be tried without building an exe.
// Usage: npm run dev:app   (close any installed AICacheCleaner first — it
// holds port 3333 and the single-instance lock).
import { spawn } from 'node:child_process';
import http from 'node:http';
import electron from 'electron';

const VITE = 'http://localhost:5173';

const up = () => new Promise(resolve => {
  http.get(VITE, res => { res.resume(); resolve(true); }).on('error', () => resolve(false));
});

for (let i = 0; i < 60 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));

const child = spawn(String(electron), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' }
});
child.on('exit', code => process.exit(code ?? 0));
