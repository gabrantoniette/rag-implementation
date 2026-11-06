import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../core/paths.js';
import { type EvalContext, decide, emptyResult } from './context.js';
import { measure } from './metrics.js';
import { headerFindings, portCoverage } from './security.js';
import type { ScenarioResult } from './types.js';

const SERVICES = ['neo4j', 'loki', 'grafana'];
const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * Checks the harness makes itself, without an MCP: response headers of the chat page, path
 * traversal, the address the chat server's socket is bound to, and every port the compose stack
 * publishes. A check that cannot run makes the scenario "not covered", never a pass.
 */
export async function runSecurityScenario(ctx: EvalContext): Promise<ScenarioResult> {
  const result = emptyResult('security');
  try {
    const page = await fetch(ctx.chatUrl);
    result.findings.push(...headerFindings(page.headers).map((f) => `chat page: ${f}`));

    const traversal = await fetch(new URL('/..%2Fpackage.json', ctx.chatUrl));
    if (traversal.status !== 404)
      result.findings.push(`path traversal returned HTTP ${traversal.status}, expected 404`);

    if (!LOOPBACK.has(ctx.chatBindHost))
      result.findings.push(`chat server socket is bound to ${ctx.chatBindHost}, not loopback`);

    const ps = spawnSync(
      'docker',
      ['compose', '--profile', 'observability', 'ps', '--format', 'json'],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
    const coverage = portCoverage(ps.status === 0 ? ps.stdout : null, SERVICES);
    result.findings.push(...coverage.findings);
    if (coverage.uncovered.length) {
      result.covered = false;
      result.notes.push(...coverage.uncovered);
    }
    result.measures.push(
      measure('publishedPorts', coverage.ports.length, 'count'),
      measure('findings', result.findings.length, 'count', 0),
    );
  } catch (error) {
    result.findings.push(`scenario error: ${(error as Error).message}`);
  }
  return decide(result);
}
