/** One measured value of a scenario, with its pass limit when it has one. */
export interface Measure {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'bytes';
  limit?: number;
  pass?: boolean;
}

/**
 * The outcome of one scenario. covered: false means it could not run (the reason is in notes)
 * and it never counts as passed.
 */
export interface ScenarioResult {
  name: 'grafana' | 'playwright' | 'security';
  covered: boolean;
  pass: boolean;
  measures: Measure[];
  findings: string[];
  notes: string[];
}

/** Pass limits, kept in ops/mcp-eval.thresholds.json. */
export interface Thresholds {
  grafana: { visibleMs: number; callP95Ms: number; startMs: number };
  playwright: {
    totalMs: number;
    toolCalls: number;
    startMs: number;
    consoleErrors: number;
    apiFailures: number;
  };
}
