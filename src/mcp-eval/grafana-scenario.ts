import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type McpSession, openMcp } from './client.js';
import { type EvalContext, decide, emptyResult, sleep } from './context.js';
import { measure, summarize } from './metrics.js';
import { isWriteTool, lokiLines } from './parse.js';
import type { ScenarioResult } from './types.js';

const REPEATS = 10;

/**
 * Grafana MCP: the agent must find, in Loki, the ask.completed line of a question the harness
 * just asked. Measures start-up, how long until the line is visible, and query latency.
 */
export async function runGrafanaScenario(ctx: EvalContext): Promise<ScenarioResult> {
  const result = emptyResult('grafana');
  const t = ctx.thresholds.grafana;
  let session: McpSession | null = null;
  try {
    session = await openMcp('grafana', ctx.mcp.grafana!);
    result.measures.push(
      measure('startMs', session.startMs, 'ms', t.startMs),
      measure('tools', session.tools.length, 'count'),
      measure('toolSchemaBytes', JSON.stringify(session.tools).length, 'bytes'),
    );
    const writes = session.tools.filter((tool) => isWriteTool(tool.name)).map((x) => x.name);
    if (writes.length) result.findings.push(`write tools exposed: ${writes.join(', ')}`);

    const ask = await fetch(new URL('api/ask', ctx.chatUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: ctx.question }),
    });
    if (!ask.ok) result.findings.push(`/api/ask returned HTTP ${ask.status}`);
    const askedAt = performance.now();

    const args = {
      datasourceUid: 'loki',
      logql: `{service="rag-chat", env="eval"} |= "${ctx.marker}"`,
      limit: 5,
      startRfc3339: 'now-15m',
    };
    // Poll past the limit (up to 3x) so a slow result is still measured, not just failed.
    let line: string | undefined;
    while (!line && performance.now() - askedAt < Math.max(t.visibleMs * 3, 30_000)) {
      const { result: response } = await session.call('query_loki_logs', args);
      line = lokiLines(response).find((l) => l.includes(ctx.marker));
      if (line && ctx.captureLokiResponse && !existsSync(ctx.captureLokiResponse)) {
        mkdirSync(path.dirname(ctx.captureLokiResponse), { recursive: true });
        writeFileSync(ctx.captureLokiResponse, `${JSON.stringify(response, null, 2)}\n`);
      }
      if (!line) await sleep(500);
    }
    result.measures.push(
      measure('visibleMs', Math.round(performance.now() - askedAt), 'ms', t.visibleMs),
    );
    if (!line) {
      result.findings.push('the ask.completed line never appeared in Loki');
      return decide(result);
    }

    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.event !== 'ask.completed') result.findings.push(`unexpected event ${event.event}`);
    if (!String(event.question ?? '').includes(ctx.marker))
      result.findings.push('the logged question does not carry the marker');
    if (String(event.answer ?? '').length === 0)
      result.findings.push('the logged answer text is empty');
    const leaked = ['sk-or-', 'glsa_', ...ctx.secrets].filter((s) => s && line.includes(s));
    if (leaked.length)
      result.findings.push(`${leaked.length} secret value(s) found in the log line`);
    result.notes.push(
      `Found status=${event.status} mode=${event.mode} with ${String(event.answer).length} characters of answer text.`,
    );

    const latencies: number[] = [];
    for (let i = 0; i < REPEATS; i++)
      latencies.push((await session.call('query_loki_logs', args)).ms);
    const s = summarize(latencies);
    result.measures.push(
      measure('callP50Ms', s.p50, 'ms'),
      measure('callP95Ms', s.p95, 'ms', t.callP95Ms),
      measure('toolCalls', session.calls.length, 'count'),
    );
    const failed = session.calls.filter((c) => !c.ok).length;
    if (failed) result.findings.push(`${failed} tool call(s) returned an error`);
  } catch (error) {
    result.findings.push(`scenario error: ${(error as Error).message}`);
    if (session?.stderr()) result.notes.push(`server stderr: ${session.stderr().slice(-500)}`);
  } finally {
    await session?.close().catch(() => undefined);
  }
  return decide(result);
}
