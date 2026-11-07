import type { Measure } from './types.js';

/** Count, median, 95th percentile and maximum, using nearest-rank percentiles. */
export function summarize(ms: number[]): { count: number; p50: number; p95: number; max: number } {
  if (ms.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
  return { count: sorted.length, p50: rank(0.5), p95: rank(0.95), max: sorted.at(-1)! };
}

/** A measure; with a limit it passes when value <= limit. */
export function measure(
  name: string,
  value: number,
  unit: Measure['unit'],
  limit?: number,
): Measure {
  return limit === undefined
    ? { name, value, unit }
    : { name, value, unit, limit, pass: value <= limit };
}

/** Time per tool call (spec 5.5): p50 and p95 over every call of a session. */
export function callMeasures(calls: { ms: number }[], p95Limit?: number): Measure[] {
  const s = summarize(calls.map((c) => c.ms));
  return [measure('callP50Ms', s.p50, 'ms'), measure('callP95Ms', s.p95, 'ms', p95Limit)];
}
