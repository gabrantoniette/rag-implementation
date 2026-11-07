import type { AskResult } from './rag.js';

export type AskStatus = 'answered' | 'refused' | 'held' | 'retrieval';

/**
 * answered | refused | held | retrieval, from the chain state alone:
 * no answer at all means a retrieval-only run; a failed evidence gate means held (the LLM was
 * not called); a refusal written by the model means refused.
 */
export function askStatus(result: AskResult): AskStatus {
  const s = result.state;
  if (s.answer === undefined && s.rawAnswer === undefined) return 'retrieval';
  if (s.gate?.applied && !s.gate.passed) return 'held';
  return result.refused ? 'refused' : 'answered';
}

/**
 * Fields of the ask.completed log event: the metadata plus the question and answer text.
 * The logger redacts secrets before anything leaves the process.
 */
export function askEventFields(
  result: AskResult,
  extra: { id?: string; source?: 'cli' | 'chat'; marker?: string } = {},
): Record<string, unknown> {
  const s = result.state;
  const status = askStatus(result);
  const checks = status === 'answered' ? (s.verification?.sentences ?? []) : [];
  return {
    event: 'ask.completed',
    ...(extra.id ? { id: extra.id } : {}),
    ...(extra.source ? { source: extra.source } : {}),
    mode: s.mode,
    collection: s.collection ?? null,
    intent: s.intent ?? null,
    status,
    gatePassed: s.gate?.applied ? s.gate.passed : null,
    gateBest: s.gate?.applied ? s.gate.bestScore : null,
    groundingScore: status === 'answered' ? (s.verification?.groundingScore ?? null) : null,
    supported: checks.filter((c) => c.supported).length,
    queried: checks.filter((c) => !c.supported).length,
    model: s.model ?? null,
    promptTokens: s.usage?.promptTokens ?? null,
    completionTokens: s.usage?.completionTokens ?? null,
    totalMs: Object.values(s.timings).reduce((a, b) => a + b, 0),
    timings: s.timings,
    question: s.question,
    answer: s.rawAnswer ?? s.answer ?? '',
    citations: s.citations.map((c) => c.chunkId),
    ...(extra.marker ? { marker: extra.marker } : {}),
  };
}
