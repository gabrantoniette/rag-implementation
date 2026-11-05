import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectPath } from '../../src/core/paths.js';
import type { Reranker } from '../../src/core/ports.js';
import { approximateTokenCounter } from '../../src/core/tokens.js';
import { createRag } from '../../src/index.js';
import type { AnswerView, CompareView } from '../../src/web/present.js';
import { splitParts } from '../../src/web/present.js';
import { type ChatServer, startChatServer } from '../../src/web/server.js';
import { HashEmbedder, capitalizedEntities } from '../helpers/fakes.js';

const tmp = projectPath('.cache', 'tmp', 'web-test');
mkdirSync(tmp, { recursive: true });

async function toyRag(reranker: Reranker) {
  const rag = await createRag({
    env: {},
    domainDir: 'domains/_template',
    store: 'memory',
    embedder: new HashEmbedder(),
    tokens: approximateTokenCounter,
    llm: 'mock',
    reranker,
    intent: 'rules',
    entityExtractor: capitalizedEntities,
  });
  await rag.documents.create({
    id: 'handbook',
    source: {
      text: '# Office handbook\n## Opening hours\nThe Lisbon office opens at nine every weekday morning.',
      format: 'md',
      title: 'Office handbook',
    },
  });
  return rag;
}

const confident: Reranker = {
  name: 'fixed',
  score: async (rows) => rows.map((_, i) => 0.9 - i * 0.01),
};
const doubtful: Reranker = { name: 'low', score: async (rows) => rows.map(() => 0.05) };

async function post<T>(server: ChatServer, route: string, body: unknown) {
  const res = await fetch(new URL(route, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('splitParts', () => {
  it('separates Answer sentences from Key points bullets', () => {
    const parts = splitParts(
      '## Answer\nFirst fact [1]. Second fact [2].\n\n## Key points\n- One point [1].\n- Two [2].',
    );
    expect(parts.answer).toEqual(['First fact [1].', 'Second fact [2].']);
    expect(parts.points).toEqual(['One point [1].', 'Two [2].']);
  });
});

describe('chat server', () => {
  let server: ChatServer;
  let held: ChatServer;

  beforeAll(async () => {
    const options = { usageFile: path.join(tmp, 'usage.json'), lastAskFile: null };
    server = await startChatServer({ ...options, createRag: () => toyRag(confident) });
    held = await startChatServer({ ...options, createRag: () => toyRag(doubtful) });
  });
  afterAll(async () => {
    await server.close();
    await held.close();
  });

  it('reports status with the domain, thresholds and modes', async () => {
    const status = (await (await fetch(new URL('/api/status', server.url))).json()) as {
      ready: boolean;
      domain: string;
      hasKey: boolean;
      modes: string[];
      thresholds: { support: number };
    };
    expect(status.ready).toBe(true);
    expect(status.domain).toBe('template');
    expect(status.hasKey).toBe(true);
    expect(status.modes).toEqual(['vector', 'hybrid', 'graph', 'rerank', 'full']);
    expect(typeof status.thresholds.support).toBe('number');
  });

  it('answers with checked sentences, sources and a trace', async () => {
    const { status, body } = await post<AnswerView>(server, '/api/ask', {
      question: 'When does the Lisbon office open?',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('answered');
    expect(body.sentences.length).toBeGreaterThan(0);
    expect(body.sentences[0]!.part).toBe('answer');
    expect(body.sentences[0]!.text).not.toMatch(/\[\d+\]/);
    expect(body.sentences.every((s) => typeof s.support === 'number')).toBe(true);
    expect(body.checkedCount).toBe(body.sentences.length);
    expect(body.sources[0]!.title).toBe('Office handbook');
    expect(body.sources[0]!.cited).toBe(true);
    expect(body.trace.ranked.length).toBeGreaterThan(0);
    expect(body.trace.gate?.passed).toBe(true);
    expect(body.turn.question).toBe('When does the Lisbon office open?');
  });

  it('marks a retrieval-only run and never calls the model', async () => {
    const { body } = await post<AnswerView>(server, '/api/ask', {
      question: 'When does the Lisbon office open?',
      mode: 'hybrid',
      retrievalOnly: true,
    });
    expect(body.status).toBe('retrieval');
    expect(body.sentences).toEqual([]);
    expect(body.trace.model).toBeNull();
  });

  it('holds when the evidence gate refuses, without an LLM call', async () => {
    const { body } = await post<AnswerView>(held, '/api/ask', {
      question: 'When does the Lisbon office open?',
    });
    expect(body.status).toBe('held');
    expect(body.refusal).toBeTruthy();
    expect(body.trace.gate?.passed).toBe(false);
    expect(body.trace.model).toBeNull();
  });

  it('compares the context of every mode with retrieval only', async () => {
    const { body } = await post<CompareView>(server, '/api/compare', {
      question: 'When does the Lisbon office open?',
    });
    expect(body.modes.map((m) => m.mode)).toEqual(['vector', 'hybrid', 'graph', 'rerank', 'full']);
    expect(body.modes.every((m) => m.context.length > 0)).toBe(true);
  });

  it('rejects invalid input and unknown feedback ids', async () => {
    const empty = await post<{ kind: string }>(server, '/api/ask', { question: '  ' });
    expect(empty.status).toBe(400);
    expect(empty.body.kind).toBe('input');
    const mode = await post<{ kind: string }>(server, '/api/ask', { question: 'x', mode: 'magic' });
    expect(mode.status).toBe(400);
    const feedback = await post<{ kind: string }>(server, '/api/feedback', {
      id: '00000000-0000-4000-8000-000000000000',
      rating: 'up',
    });
    expect(feedback.status).toBe(404);
  });

  it('serves the page with a strict CSP and refuses paths outside web/', async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain('<textarea');
    const escape = await fetch(new URL('/..%2Fpackage.json', server.url));
    expect(escape.status).toBe(404);
    const unknown = await fetch(new URL('/missing.js', server.url));
    expect(unknown.status).toBe(404);
  });

  it('binds to the loopback interface only', () => {
    expect(new URL(server.url).hostname).toBe('127.0.0.1');
  });
});
