import type { McpServerSpec } from './client.js';
import type { ScenarioResult, Thresholds } from './types.js';

/** Everything a scenario needs; built once by src/cli/mcp-eval.ts. */
export interface EvalContext {
  /** Base URL of the chat server the harness started, ending in '/'. */
  chatUrl: string;
  /** The address the chat server's socket is bound to (ChatServer.address().host). */
  chatBindHost: string;
  /** Unique string carried by the question, so its log line can be found in Loki. */
  marker: string;
  question: string;
  thresholds: Thresholds;
  mcp: Record<string, McpServerSpec>;
  /** Exact secret values that must never appear in a shipped log line. */
  secrets: string[];
  /** Where to save the first raw query_loki_logs response (a test fixture), if not there yet. */
  captureLokiResponse?: string;
}

/** A scenario result that starts covered and empty; pass is decided at the end. */
export function emptyResult(name: ScenarioResult['name']): ScenarioResult {
  return { name, covered: true, pass: false, measures: [], findings: [], notes: [] };
}

/** Covered, no findings and every limited measure within its limit. */
export function decide(result: ScenarioResult): ScenarioResult {
  result.pass =
    result.covered &&
    result.findings.length === 0 &&
    result.measures.every((m) => m.pass !== false);
  return result;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
