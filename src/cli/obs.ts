import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import dotenv from 'dotenv';
import { PROJECT_ROOT, projectPath } from '../core/paths.js';
import { parseArgs, runCli } from './args.js';

/**
 * npm run obs:up | obs:down
 * Starts or stops the local observability stack (Loki and Grafana, compose profile
 * "observability") next to Neo4j. Grafana refuses to start without an admin password in .env.
 */
const LOKI_READY = 'http://127.0.0.1:3100/ready';

function compose(args: string[]): number {
  const r = spawnSync('docker', ['compose', '--profile', 'observability', ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

/** Loki's image has no shell for a container healthcheck, so readiness is polled from here. */
async function waitForLoki(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(LOKI_READY);
      if (res.ok && (await res.text()).trim() === 'ready') return true;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  return false;
}

runCli(async () => {
  const action = parseArgs(process.argv.slice(2)).positionals[0];
  if (action === 'down') return compose(['down']);
  if (action !== 'up') {
    process.stderr.write('Usage: npm run obs:up | npm run obs:down\n');
    return 1;
  }
  dotenv.config({ path: projectPath('.env'), quiet: true });
  const password = process.env.GRAFANA_ADMIN_PASSWORD ?? '';
  if (password.length < 12) {
    process.stderr.write(
      'GRAFANA_ADMIN_PASSWORD is empty. Set it in .env (12+ characters) before npm run obs:up.\n',
    );
    return 1;
  }
  const code = compose(['up', '-d', '--wait']);
  if (code !== 0) return code;
  if (!(await waitForLoki())) {
    process.stderr.write(`Loki did not report ready at ${LOKI_READY} within 90 s.\n`);
    return 1;
  }
  process.stdout.write('Loki: http://127.0.0.1:3100  Grafana: http://127.0.0.1:3000\n');
  return 0;
});
