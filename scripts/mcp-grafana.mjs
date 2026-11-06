// Launcher for the Grafana MCP server (grafana/mcp-grafana), read-only, over stdio in Docker.
// Used by .mcp.json (agents) and by npm run mcp:eval. Plain JavaScript on purpose: agents start
// it with `node`, on Windows, macOS and Linux alike, without tsx or a build step.
//
// Claude Code expands ${VAR} in .mcp.json from the shell environment only, never from .env, so
// this launcher reads exactly one secret from .env itself: GRAFANA_SERVICE_ACCOUNT_TOKEN (a
// Viewer token written by `npm run obs:token`). The token reaches the container through the
// environment, never as a command-line argument.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GRAFANA_MCP_IMAGE = 'grafana/mcp-grafana:2.1.1';

/**
 * The container joins the compose network (name pinned in docker-compose.yml) and reaches Grafana
 * by its service name. host.docker.internal is avoided: it does not exist on Docker Engine for
 * Linux, and a port published on the host's 127.0.0.1 is unreachable from a container anyway.
 */
export const COMPOSE_NETWORK = 'rag-implementation';
export const DEFAULT_GRAFANA_URL = 'http://grafana:3000';

/**
 * Tool categories turned off, taken from `docker run grafana/mcp-grafana:2.1.1 --help`. Kept on:
 * search, datasource, loki, dashboard, navigation, query and examples (what log reading needs).
 */
export const DISABLED_CATEGORIES = [
  'admin',
  'agento11y',
  'alerting',
  'annotations',
  'api',
  'asserts',
  'assistant',
  'athena',
  'clickhouse',
  'cloudlogging',
  'cloudwatch',
  'config',
  'docs',
  'elasticsearch',
  'folder',
  'graphite',
  'incident',
  'influxdb',
  'oncall',
  'plugin',
  'prometheus',
  'provisioning',
  'proxied',
  'pyroscope',
  'quickwit',
  'rendering',
  'runpanelquery',
  'snapshot',
  'snowflake',
  'sql',
  'tempo',
  'user',
];

/** docker arguments; the two -e flags name variables whose values come from the environment. */
export function dockerArgs() {
  return [
    'run',
    '--rm',
    '-i',
    '--network',
    COMPOSE_NETWORK,
    '--memory',
    '256m',
    '-e',
    'GRAFANA_URL',
    '-e',
    'GRAFANA_SERVICE_ACCOUNT_TOKEN',
    GRAFANA_MCP_IMAGE,
    '-t',
    'stdio',
    '--disable-write',
    ...DISABLED_CATEGORIES.map((c) => `--disable-${c}`),
  ];
}

function readEnvFile() {
  const file = process.env.MCP_ENV_FILE || path.join(root, '.env');
  if (!existsSync(file)) return {};
  const parsed = dotenv.parse(readFileSync(file, 'utf8'));
  return {
    GRAFANA_SERVICE_ACCOUNT_TOKEN: parsed.GRAFANA_SERVICE_ACCOUNT_TOKEN ?? '',
    GRAFANA_URL: parsed.GRAFANA_URL ?? '',
  };
}

function main() {
  const fromFile = readEnvFile();
  const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || fromFile.GRAFANA_SERVICE_ACCOUNT_TOKEN;
  const url = process.env.GRAFANA_URL || fromFile.GRAFANA_URL || DEFAULT_GRAFANA_URL;
  if (!token) {
    process.stderr.write('GRAFANA_SERVICE_ACCOUNT_TOKEN is empty. Run npm run obs:token.\n');
    process.exit(1);
  }
  const child = spawn('docker', dockerArgs(), {
    stdio: 'inherit',
    env: { ...process.env, GRAFANA_URL: url, GRAFANA_SERVICE_ACCOUNT_TOKEN: token },
  });
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('error', (error) => {
    process.stderr.write(`Could not start docker: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
