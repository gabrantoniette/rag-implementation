// Launcher for the Playwright MCP server (@playwright/mcp, pinned in devDependencies), over stdio.
// Used by .mcp.json (agents) and by npm run mcp:eval. Headless, with an in-memory browser
// profile, and allowed to open only localhost and 127.0.0.1 (ops/playwright-mcp.config.json).
// Plain JavaScript so `node` starts it the same way on Windows, macOS and Linux.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js');

if (!existsSync(cli)) {
  process.stderr.write('@playwright/mcp is not installed. Run npm install.\n');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    cli,
    '--headless',
    '--isolated',
    '--output-dir',
    path.join(root, '.playwright-mcp'),
    '--config',
    path.join(root, 'ops', 'playwright-mcp.config.json'),
  ],
  { stdio: 'inherit' },
);
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 1));
