import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../core/paths.js';
import { type EvalContext, decide, emptyResult } from './context.js';
import { measure } from './metrics.js';
import { headerFindings, loopbackFindings, parseComposePs } from './security.js';
import type { ScenarioResult } from './types.js';

const SERVICES = ['neo4j', 'loki', 'grafana'];

/**
 * Checks the harness makes itself, without an MCP: response headers of the chat page, path
 * traversal, the chat server's bind address, and every port the compose stack publishes.
 */
export async function runSecurityScenario(ctx: EvalContext): Promise<ScenarioResult> {
  const result = emptyResult('security');
  try {
    const page = await fetch(ctx.chatUrl);
    result.findings.push(...headerFindings(page.headers).map((f) => `chat page: ${f}`));

    const traversal = await fetch(new URL('/..%2Fpackage.json', ctx.chatUrl));
    if (traversal.status !== 404)
      result.findings.push(`path traversal returned HTTP ${traversal.status}, expected 404`);

    const host = new URL(ctx.chatUrl).hostname;
    if (host !== '127.0.0.1') result.findings.push(`chat server listens on ${host}, not 127.0.0.1`);

    const ps = spawnSync(
      'docker',
      ['compose', '--profile', 'observability', 'ps', '--format', 'json'],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
    if (ps.status !== 0) {
      result.notes.push('docker compose ps failed; published ports were not checked');
    } else {
      const ports = parseComposePs(ps.stdout);
      result.findings.push(...loopbackFindings(ports));
      const seen = new Set(ports.map((p) => p.service));
      const missing = SERVICES.filter((s) => !seen.has(s));
      if (missing.length) result.notes.push(`not running, so not checked: ${missing.join(', ')}`);
      result.measures.push(measure('publishedPorts', ports.length, 'count'));
    }
    result.measures.push(measure('findings', result.findings.length, 'count', 0));
  } catch (error) {
    result.findings.push(`scenario error: ${(error as Error).message}`);
  }
  return decide(result);
}
