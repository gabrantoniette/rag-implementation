import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { upsertEnvLine } from '../../src/cli/env-file.js';
import { secretRulesIn } from '../../src/cli/secret-patterns.js';
import { PROJECT_ROOT, projectPath } from '../../src/core/paths.js';
// @ts-expect-error plain JavaScript launcher without type declarations
import { DEFAULT_GRAFANA_URL, GRAFANA_MCP_IMAGE, dockerArgs } from '../../scripts/mcp-grafana.mjs';

const tmp = projectPath('.cache', 'tmp', 'mcp-wrappers');
mkdirSync(tmp, { recursive: true });

function writeTemp(name: string, content: string): string {
  const file = path.join(tmp, `${Date.now()}-${Math.random()}-${name}`);
  writeFileSync(file, content);
  return file;
}

describe('MCP launchers', () => {
  it('mcp-grafana wrapper exits 1 without a token', () => {
    const env = writeTemp('.env', 'GRAFANA_SERVICE_ACCOUNT_TOKEN=\n');
    const r = spawnSync(process.execPath, ['scripts/mcp-grafana.mjs'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MCP_ENV_FILE: env, GRAFANA_SERVICE_ACCOUNT_TOKEN: '' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('npm run obs:token');
  });

  it('passes the token to docker through the environment, never as an argument', () => {
    const args: string[] = dockerArgs();
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-i']);
    expect(args).toContain(GRAFANA_MCP_IMAGE);
    expect(GRAFANA_MCP_IMAGE).toMatch(/^grafana\/mcp-grafana:\d+\.\d+\.\d+$/);
    expect(args).toEqual(expect.arrayContaining(['-t', 'stdio', '--disable-write']));
    expect(args.join(' ')).not.toMatch(/glsa_|GRAFANA_SERVICE_ACCOUNT_TOKEN=/);
    expect(args).toContain('GRAFANA_SERVICE_ACCOUNT_TOKEN');
    for (const kept of ['search', 'datasource', 'loki', 'dashboard', 'navigation', 'query']) {
      expect(args).not.toContain(`--disable-${kept}`);
    }
    expect(args).toEqual(expect.arrayContaining(['--disable-prometheus', '--disable-admin']));
  });

  it('.mcp.json starts both servers through the node wrappers', () => {
    const cfg = JSON.parse(readFileSync(projectPath('.mcp.json'), 'utf8'));
    expect(cfg.mcpServers.grafana).toEqual({ command: 'node', args: ['scripts/mcp-grafana.mjs'] });
    expect(cfg.mcpServers.playwright).toEqual({
      command: 'node',
      args: ['scripts/mcp-playwright.mjs'],
    });
  });

  it('the playwright config only allows loopback origins', () => {
    const cfg = JSON.parse(readFileSync(projectPath('ops', 'playwright-mcp.config.json'), 'utf8'));
    expect(cfg.network.allowedOrigins).toEqual(['http://localhost:*', 'http://127.0.0.1:*']);
  });

  it('obs:token replaces only the token line in .env and keeps everything else', () => {
    const before = 'NEO4J_PASSWORD=abc\nGRAFANA_SERVICE_ACCOUNT_TOKEN=\nLOG_LEVEL=info\n';
    const after = upsertEnvLine(before, 'GRAFANA_SERVICE_ACCOUNT_TOKEN', 'new-value');
    expect(after).toBe(
      'NEO4J_PASSWORD=abc\nGRAFANA_SERVICE_ACCOUNT_TOKEN=new-value\nLOG_LEVEL=info\n',
    );
    expect(upsertEnvLine('A=1', 'B', '2')).toBe('A=1\nB=2\n');
  });

  it('secret scan flags a Grafana service account token', () => {
    const token = `glsa_${'A1b2'.repeat(8)}`;
    expect(secretRulesIn(`GRAFANA_SERVICE_ACCOUNT_TOKEN=${token}`)).toContain(
      'grafana-service-account-token',
    );
    expect(secretRulesIn('nothing secret here')).toEqual([]);
  });

  it('runs the Grafana MCP on the fixed compose network with a memory limit (works on Linux too)', () => {
    const args: string[] = dockerArgs();
    expect(args[args.indexOf('--network') + 1]).toBe('rag-implementation');
    expect(args[args.indexOf('--memory') + 1]).toMatch(/^\d+m$/);
    expect(args.indexOf('--network')).toBeLessThan(args.indexOf(GRAFANA_MCP_IMAGE));
    expect(DEFAULT_GRAFANA_URL).toBe('http://grafana:3000');
  });

  it('pins the compose network name so it does not depend on the clone folder', () => {
    const compose = readFileSync(projectPath('docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/^networks:\r?\n {2}default:\r?\n {4}name: rag-implementation$/m);
  });
});
