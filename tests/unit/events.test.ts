import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuotaGuard } from '../../src/adapters/quota.js';
import { type ChainState, initialState } from '../../src/core/chain.js';
import type { Logger } from '../../src/core/logger.js';
import { projectPath } from '../../src/core/paths.js';
import { askEventFields } from '../../src/core/events.js';
import type { AskResult } from '../../src/core/rag.js';

const result = (state: ChainState, refused = false): AskResult => ({
  state,
  answer: state.answer ?? '',
  refused,
  confidence: state.verification?.groundingScore ?? null,
  turn: { question: state.question, answer: state.answer ?? '', entities: [] },
});

function answeredState(): ChainState {
  const s = initialState('Q?', { mode: 'full', collection: 'docs' });
  s.intent = 'lookup';
  s.gate = { applied: true, passed: true, bestScore: 0.9, threshold: 0.5 };
  s.rawAnswer = '## Answer\nFirst [1]. Second [2].\n\n## Key points\n- Third.';
  s.answer = `${s.rawAnswer}\n\n## Sources\n[1] Doc > Intro`;
  s.model = 'free/model:free';
  s.usage = { promptTokens: 800, completionTokens: 60, totalTokens: 860 };
  s.timings = { classifyIntent: 10, hybridRetrieve: 20 };
  s.citations = [
    {
      n: 1,
      chunkId: 'c1',
      documentTitle: 'Doc',
      documentUri: 'u',
      section: 'Intro',
      locator: 'x',
    },
  ];
  s.verification = {
    citationsValid: true,
    invalidCitations: [],
    groundingScore: 2 / 3,
    passed: false,
    structureErrors: [],
    sentences: [
      { sentence: 'First [1].', citations: [1], support: 0.8, supported: true },
      { sentence: 'Second [2].', citations: [2], support: 0.7, supported: true },
      { sentence: 'Third.', citations: [], support: 0, supported: false },
    ],
  };
  return s;
}

describe('askEventFields', () => {
  it('summarises an answered full-mode result with question and answer text', () => {
    const f = askEventFields(result(answeredState()), { source: 'chat', id: 'x1' });
    expect(f).toMatchObject({
      event: 'ask.completed',
      status: 'answered',
      mode: 'full',
      collection: 'docs',
      intent: 'lookup',
      question: 'Q?',
      supported: 2,
      queried: 1,
      groundingScore: 2 / 3,
      gatePassed: true,
      gateBest: 0.9,
      model: 'free/model:free',
      promptTokens: 800,
      completionTokens: 60,
      citations: ['c1'],
      source: 'chat',
      id: 'x1',
    });
    expect(f.answer).toContain('## Answer');
    expect(f.totalMs).toBe(30);
    expect(f).not.toHaveProperty('marker');
  });

  it('marks a gate refusal as held with no model', () => {
    const s = initialState('Out of corpus?', { mode: 'full' });
    s.gate = { applied: true, passed: false, bestScore: 0.1, threshold: 0.5 };
    s.answer = '## Answer\nThe sources I have do not contain enough information.';
    const f = askEventFields(result(s, true), { source: 'cli', marker: 'm-1' });
    expect(f).toMatchObject({ status: 'held', model: null, groundingScore: null, marker: 'm-1' });
    expect(f.answer).toContain('do not contain enough information');
  });

  it('marks a model refusal as refused and reports no grounding', () => {
    const s = answeredState();
    s.rawAnswer = '## Answer\nThe sources I have do not contain enough information.';
    s.verification = { ...s.verification!, sentences: [], groundingScore: 1 };
    const f = askEventFields(result(s, true));
    expect(f).toMatchObject({ status: 'refused', groundingScore: null, supported: 0, queried: 0 });
  });

  it('marks a retrieval-only result as retrieval', () => {
    const s = initialState('Q?', { mode: 'hybrid' });
    s.timings = { hybridRetrieve: 5 };
    const f = askEventFields(result(s));
    expect(f).toMatchObject({ status: 'retrieval', mode: 'hybrid', answer: '', model: null });
    expect(f.totalMs).toBe(5);
  });
});

describe('quota warning events', () => {
  it('logs quota.warning with used, warnAt and blockAt once usage reaches warnAt', async () => {
    const dir = projectPath('.cache', 'tmp', 'events-test');
    mkdirSync(dir, { recursive: true });
    const warnings: { message: string; data: unknown }[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: (message, data) => warnings.push({ message, data }),
    };
    const quota = new QuotaGuard({
      file: path.join(dir, `usage-${Math.random()}.json`),
      warnAt: 1,
      blockAt: 5,
      perMinute: 100,
      logger,
    });
    await quota.acquire();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('Free-model usage today: 1 requests');
    expect(warnings[0]!.data).toEqual({
      event: 'quota.warning',
      kind: 'daily',
      used: 1,
      warnAt: 1,
      blockAt: 5,
    });
  });
});
