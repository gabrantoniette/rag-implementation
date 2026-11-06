import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TransportEntry, createLogger } from '../../src/core/logger.js';
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

describe('chat server logging', () => {
  let server: ChatServer;
  let limited: ChatServer;
  const sent: TransportEntry[] = [];
  type Event = Record<string, unknown> & { labels: Record<string, string> };
  const events = (): Event[] =>
    sent.map((e) => ({ ...(JSON.parse(e.line) as Record<string, unknown>), labels: e.labels }));

  beforeAll(async () => {
    const logger = createLogger({
      labels: { service: 'rag-chat', env: 'test' },
      transport: { send: (e) => sent.push(e), close: async () => {} },
      sink: () => {},
    });
    const options = { usageFile: path.join(tmp, 'usage.json'), lastAskFile: null, logger };
    server = await startChatServer({ ...options, createRag: () => toyRag(confident) });
    limited = await startChatServer({ ...options, createRag: () => toyRag(confident) });
  });
  afterAll(async () => {
    await server.close();
    await limited.close();
  });

  it('logs ask.completed with question and answer text for each /api/ask', async () => {
    const { status } = await post<AnswerView>(server, '/api/ask', {
      question: 'When does the Lisbon office open?',
    });
    expect(status).toBe(200);
    const ask = events().find((e) => e.event === 'ask.completed')!;
    expect(ask).toMatchObject({
      event: 'ask.completed',
      source: 'chat',
      question: 'When does the Lisbon office open?',
      status: 'answered',
    });
    expect(String(ask.answer).length).toBeGreaterThan(0);
    expect(typeof ask.id).toBe('string');
  });

  it('logs http.request with route, status and duration', async () => {
    await fetch(new URL('/api/status', server.url));
    await expect
      .poll(() => events().find((e) => e.event === 'http.request' && e.route === '/api/status'))
      .toMatchObject({ method: 'GET', status: 200, labels: { level: 'info' } });
    const req = events().find((e) => e.event === 'http.request' && e.route === '/api/status')!;
    expect(typeof req.ms).toBe('number');
  });

  it('accepts a client log and records it as browser.error under service rag-browser', async () => {
    const res = await fetch(new URL('/api/client-log', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'TypeError: x is undefined', page: '/' }),
    });
    expect(res.status).toBe(204);
    const err = events().find((e) => e.event === 'browser.error')!;
    expect(err).toMatchObject({ message: 'TypeError: x is undefined', page: '/' });
    expect(err.labels).toMatchObject({ service: 'rag-browser', level: 'warn', env: 'test' });
  });

  it('rejects oversized client logs', async () => {
    const { status, body } = await post<{ kind: string }>(server, '/api/client-log', {
      message: 'x'.repeat(2001),
    });
    expect(status).toBe(400);
    expect(body.kind).toBe('input');
  });

  it('rate-limits client logs with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await fetch(new URL('/api/client-log', limited.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: `error ${i}` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
    const ask = await post<AnswerView>(limited, '/api/ask', {
      question: 'When does the Lisbon office open?',
    });
    expect(ask.status).toBe(200);
  });
});

describe('chat server logging when the library fails to load (review fix)', () => {
  it('logs rag.load_failed and still accepts client logs through the injected logger', async () => {
    const sent: TransportEntry[] = [];
    const logger = createLogger({
      labels: { service: 'rag-chat' },
      transport: { send: (e) => sent.push(e), close: async () => {} },
      sink: () => {},
    });
    const failing = await startChatServer({
      createRag: () => Promise.reject(new Error('NEO4J_PASSWORD is empty')),
      lastAskFile: null,
      logger,
    });
    try {
      const status = (await (await fetch(new URL('/api/status', failing.url))).json()) as {
        ready: boolean;
      };
      expect(status.ready).toBe(false);
      const events = sent.map((e) => JSON.parse(e.line) as Record<string, unknown>);
      expect(events).toContainEqual(
        expect.objectContaining({ event: 'rag.load_failed', error: 'NEO4J_PASSWORD is empty' }),
      );
      const res = await fetch(new URL('/api/client-log', failing.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'TypeError: page broke' }),
      });
      expect(res.status).toBe(204);
    } finally {
      await failing.close();
    }
  });
});
