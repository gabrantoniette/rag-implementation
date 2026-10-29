// Launcher for the npm scripts. It runs a TypeScript entry point with tsx and points every
// temp directory (TMP, TEMP, TMPDIR) inside the project, so tsx's transform cache and any
// library temp file stay in .cache/tmp instead of the user's system temp folder.
// Plain JavaScript on purpose: tsx cannot launch itself.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, '.cache', 'tmp');
mkdirSync(tmp, { recursive: true });

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('Usage: node scripts/tsx.mjs <entry.ts> [args...]');
  process.exit(2);
}

const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), entry, ...args], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
