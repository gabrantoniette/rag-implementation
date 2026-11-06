import { type McpSession, openMcp } from './client.js';
import { type EvalContext, decide, emptyResult } from './context.js';
import { measure } from './metrics.js';
import { findRef, resultText } from './parse.js';
import type { ScenarioResult } from './types.js';

/** Error lines in browser_console_messages output ("[ERROR] ..." entries). */
export function consoleErrors(text: string): string[] {
  return text.split('\n').filter((l) => /\[error\]/i.test(l));
}

/** HTTP statuses in browser_network_requests output ("[POST] url => [200] OK" entries). */
export function networkStatuses(text: string): { url: string; status: number }[] {
  return [...text.matchAll(/(\S*\/api\/\S*)\s*=>\s*\[(\d{3})\]/g)].map((m) => ({
    url: m[1]!,
    status: Number(m[2]),
  }));
}

/** The argument name a tool uses for the element reference (0.0.84 says target; older, ref). */
function refKey(session: McpSession, tool: string): string {
  const schema = session.tools.find((t) => t.name === tool)?.inputSchema as
    { properties?: Record<string, unknown> } | undefined;
  return schema?.properties && 'ref' in schema.properties ? 'ref' : 'target';
}

/**
 * Playwright MCP: an agent opens the chat page in a real headless browser, asks the question,
 * waits for the checked answer and reads console errors and the /api/ requests.
 */
export async function runPlaywrightScenario(ctx: EvalContext): Promise<ScenarioResult> {
  const result = emptyResult('playwright');
  const t = ctx.thresholds.playwright;
  let session: McpSession | null = null;
  try {
    session = await openMcp('playwright', ctx.mcp.playwright!);
    result.measures.push(
      measure('startMs', session.startMs, 'ms', t.startMs),
      measure('tools', session.tools.length, 'count'),
      measure('toolSchemaBytes', JSON.stringify(session.tools).length, 'bytes'),
    );
    const started = performance.now();
    await session.call('browser_navigate', { url: ctx.chatUrl });
    // The question field stays disabled until /api/status has loaded the library.
    await session.call('browser_wait_for', { text: 'Domain', time: 30 });
    const snapshot = resultText((await session.call('browser_snapshot', {})).result);
    const ref = findRef(snapshot, 'textbox', 'Question');
    if (!ref) throw new Error('the Question textbox is not in the page snapshot');
    await session.call('browser_type', {
      [refKey(session, 'browser_type')]: ref,
      element: 'Question',
      text: ctx.question,
      submit: true,
    });
    const waited = await session.call('browser_wait_for', { text: 'Rate this answer', time: 30 });
    if (waited.result.isError) result.findings.push('the checked answer never appeared');

    const consoleText = resultText(
      (await session.call('browser_console_messages', { level: 'error' })).result,
    );
    const errors = consoleErrors(consoleText);
    const networkText = resultText(
      (await session.call('browser_network_requests', { filter: '/api/' })).result,
    );
    const requests = networkStatuses(networkText);
    const failures = requests.filter((r) => r.status >= 400);
    await session.call('browser_close', {});

    result.measures.push(
      measure('totalMs', Math.round(performance.now() - started), 'ms', t.totalMs),
      measure('toolCalls', session.calls.length, 'count', t.toolCalls),
      measure('consoleErrors', errors.length, 'count', t.consoleErrors),
      measure('apiFailures', failures.length, 'count', t.apiFailures),
      measure('apiRequests', requests.length, 'count'),
    );
    for (const e of errors) result.findings.push(`console error: ${e.trim().slice(0, 300)}`);
    for (const f of failures) result.findings.push(`HTTP ${f.status} from ${f.url}`);
    if (!requests.some((r) => r.url.includes('/api/ask')))
      result.findings.push('no /api/ask request was seen by the browser');
    const failedCalls = session.calls.filter((c) => !c.ok).map((c) => c.tool);
    if (failedCalls.length) result.findings.push(`tool calls failed: ${failedCalls.join(', ')}`);
    result.notes.push(
      `Network: ${requests.map((r) => `${r.url.replace(ctx.chatUrl, '/')} ${r.status}`).join(', ')}`,
    );
  } catch (error) {
    result.findings.push(`scenario error: ${(error as Error).message}`);
    if (session?.stderr()) result.notes.push(`server stderr: ${session.stderr().slice(-500)}`);
  } finally {
    await session?.close().catch(() => undefined);
  }
  return decide(result);
}
