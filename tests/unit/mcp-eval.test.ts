import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectPath } from '../../src/core/paths.js';
import { measure, summarize } from '../../src/mcp-eval/metrics.js';
import { findRef, isWriteTool, leakedSecrets, lokiLines } from '../../src/mcp-eval/parse.js';
import { uncovered } from '../../src/mcp-eval/preflight.js';
import {
  headerFindings,
  loopbackFindings,
  parseComposePs,
  portCoverage,
} from '../../src/mcp-eval/security.js';
import { startChatServer } from '../../src/web/server.js';

const fixture = (name: string) =>
  readFileSync(projectPath('tests', 'fixtures', 'mcp', name), 'utf8');

describe('preflight', () => {
  const ok = { lokiReady: true, grafanaHealthy: true, token: 'glsa_x', docker: true, chrome: true };

  it('leaves every scenario covered when everything is available', () => {
    expect(uncovered(ok)).toEqual({ grafana: null, playwright: null, security: null });
  });

  it('marks only the Grafana scenario uncovered when the token is empty', () => {
    expect(uncovered({ ...ok, token: '' })).toEqual({
      grafana: 'GRAFANA_SERVICE_ACCOUNT_TOKEN is empty (npm run obs:token)',
      playwright: null,
      security: null,
    });
  });

  it('needs Chrome for Playwright and Docker for Grafana and security', () => {
    const r = uncovered({ ...ok, docker: false, chrome: false });
    expect(r.playwright).toMatch(/Chrome/);
    expect(r.grafana).toMatch(/Docker/);
    expect(r.security).toMatch(/Docker/);
  });
});

describe('metrics', () => {
  it('summarises latencies with nearest-rank percentiles', () => {
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ count: 5, p50: 3, p95: 5, max: 5 });
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, max: 0 });
  });

  it('marks a measure as passing when it is within its limit', () => {
    expect(measure('visibleMs', 900, 'ms', 1000)).toEqual({
      name: 'visibleMs',
      value: 900,
      unit: 'ms',
      limit: 1000,
      pass: true,
    });
    expect(measure('calls', 13, 'count', 12).pass).toBe(false);
    expect(measure('bytes', 10, 'bytes')).toEqual({ name: 'bytes', value: 10, unit: 'bytes' });
  });
});

describe('security checks', () => {
  it('reads the published ports from docker compose ps', () => {
    expect(parseComposePs(fixture('compose-ps.jsonl'))).toEqual(
      expect.arrayContaining([
        { service: 'neo4j', hostIp: '127.0.0.1', hostPort: 7474 },
        { service: 'neo4j', hostIp: '127.0.0.1', hostPort: 7687 },
        { service: 'loki', hostIp: '127.0.0.1', hostPort: 3100 },
        { service: 'grafana', hostIp: '127.0.0.1', hostPort: 3000 },
      ]),
    );
  });

  it('finds no exposure when every port is on loopback', () => {
    expect(loopbackFindings(parseComposePs(fixture('compose-ps.jsonl')))).toEqual([]);
  });

  it('reports a port published on every interface', () => {
    const exposed = fixture('compose-ps.jsonl').replace(
      '"URL":"127.0.0.1","TargetPort":7474',
      '"URL":"0.0.0.0","TargetPort":7474',
    );
    const findings = loopbackFindings(parseComposePs(exposed));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('neo4j');
    expect(findings[0]).toContain('7474');
  });

  it('accepts the chat server headers and flags a page without CSP', async () => {
    const server = await startChatServer({
      createRag: () => Promise.reject(new Error('not needed for static files')),
      lastAskFile: null,
    });
    try {
      const res = await fetch(server.url);
      expect(headerFindings(res.headers)).toEqual([]);
    } finally {
      await server.close();
    }
    const bare = new Headers({ 'x-content-type-options': 'nosniff' });
    expect(headerFindings(bare).join(' ')).toMatch(/content-security-policy/i);
  });
});

describe('parsers', () => {
  it('finds the ref of the question textbox in a Playwright snapshot', () => {
    expect(findRef(fixture('snapshot.txt'), 'textbox', 'Question')).toBe('e25');
    expect(findRef(fixture('snapshot.txt'), 'button', 'Ask')).toBe('e26');
    expect(findRef(fixture('snapshot.txt'), 'textbox', 'Missing')).toBeNull();
  });

  it('recognises write tools by name', () => {
    expect(isWriteTool('update_dashboard')).toBe(true);
    expect(isWriteTool('create_incident')).toBe(true);
    expect(isWriteTool('query_loki_logs')).toBe(false);
    expect(isWriteTool('list_datasources')).toBe(false);
  });
});

describe('lokiLines (real query_loki_logs response)', () => {
  it('extracts the shipped ask.completed line from the captured response', () => {
    const response = JSON.parse(fixture('query-loki-logs.json')) as Parameters<typeof lokiLines>[0];
    const lines = lokiLines(response);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"event":"ask.completed"');
    expect(JSON.parse(lines[0]!).question).toMatch(/\(mcp-eval-[0-9a-f-]{36}\)$/);
  });
});

describe('leakedSecrets (review fix)', () => {
  it('finds a secret in a log line even when JSON escaped it', () => {
    const secret = String.raw`pa"ss\word123`;
    const shipped = JSON.stringify({ q: `my ${secret}` }); // {"q":"my pa\"ss\\word123"}
    expect(leakedSecrets(shipped, [secret])).toBe(1);
    expect(leakedSecrets('{"q":"clean"}', [secret])).toBe(0);
    expect(leakedSecrets('{"k":"sk-or-v1-abc"}', [])).toBe(1);
    expect(leakedSecrets('{"k":"glsa_abc"}', [''])).toBe(1);
  });
});

describe('portCoverage (review fix)', () => {
  const expected = ['neo4j', 'loki', 'grafana'];

  it('leaves the port check uncovered when docker compose ps fails', () => {
    const r = portCoverage(null, expected);
    expect(r.uncovered).toEqual(['docker compose ps failed, so no published port was checked']);
    expect(r.findings).toEqual([]);
  });

  it('marks each expected service that is not running as uncovered', () => {
    const onlyNeo4j = fixture('compose-ps.jsonl')
      .split('\n')
      .filter((l) => l.includes('"Service":"neo4j"'))
      .join('\n');
    expect(portCoverage(onlyNeo4j, expected).uncovered).toEqual([
      'loki is not running, so its ports were not checked',
      'grafana is not running, so its ports were not checked',
    ]);
  });

  it('is fully covered with no findings when every service runs on loopback', () => {
    const r = portCoverage(fixture('compose-ps.jsonl'), expected);
    expect(r).toMatchObject({ uncovered: [], findings: [] });
    expect(r.ports).toHaveLength(4);
  });
});
