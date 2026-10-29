import type { LlmClient, LlmRequest, LlmResponse } from '../core/ports.js';

/**
 * Deterministic LLM for tests and key-less runs. The default responder answers with the first
 * sentence of the first two numbered sources it finds in the prompt ('[n] ...' lines).
 */
export class MockLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly responder: (prompt: string) => string = defaultResponder) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const prompt = request.messages.map((m) => m.content).join('\n');
    return { text: this.responder(prompt), model: 'mock/llm', cached: false };
  }
}

function defaultResponder(prompt: string): string {
  const sources = [...prompt.matchAll(/^\[(\d+)\] [^\n]*\n([^\n]+)/gm)].map((m) => ({
    n: Number(m[1]),
    first: (m[2]!.match(/^[^.!?]+[.!?]/)?.[0] ?? m[2]!).trim(),
  }));
  if (sources.length === 0) return '## Answer\nNo sources.\n\n## Key points\n- None.';
  const [a, b] = sources;
  return [
    '## Answer',
    `${a!.first.replace(/[.!?]$/, '')} [${a!.n}].`,
    '',
    '## Key points',
    `- ${a!.first.replace(/[.!?]$/, '')} [${a!.n}].`,
    ...(b ? [`- ${b.first.replace(/[.!?]$/, '')} [${b.n}].`] : []),
  ].join('\n');
}
