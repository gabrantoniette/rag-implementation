import { describe, expect, it } from 'vitest';
import { PassThroughReranker, RuleIntentClassifier } from '../../src/adapters/baselines.js';
import { InMemoryStore } from '../../src/adapters/memory-store.js';
import { type Candidate, initialState } from '../../src/core/chain.js';
import { DEFAULT_PARAMETERS } from '../../src/core/config.js';
import {
  buildRetrievalQuery,
  retrieve,
  rrfScores,
  selectContext,
  trimHistory,
  type RetrievalDeps,
} from '../../src/core/pipeline.js';
import type { Reranker } from '../../src/core/ports.js';
import type { RetrievedChunk } from '../../src/core/store.js';
import { HashEmbedder, makeService } from '../helpers/fakes.js';

const sentence = (s: string) => `${s} ` + 'filler '.repeat(70).trim() + '.';

async function corpus() {
  const store = new InMemoryStore();
  const embedder = new HashEmbedder();
  const { service } = makeService(store, embedder);
  await service.create({
    id: 'tennis',
    collection: 'sports',
    source: {
      text: [
        '# Tennis',
        '## Federer',
        sentence('Federer won Wimbledon eight times on grass'),
        '## Nadal',
        sentence('Nadal won the French Open on clay at Roland Garros'),
        '## Djokovic',
        sentence('Djokovic won the Australian Open in Melbourne'),
      ].join('\n\n'),
      format: 'md',
      title: 'Tennis',
    },
  });
  await service.create({
    id: 'recipes',
    collection: 'cooking',
    source: {
      text: sentence('Federer cake recipe with Wimbledon strawberries'),
      format: 'txt',
      title: 'Cake',
    },
  });
  const deps: RetrievalDeps = {
    store,
    embedder,
    intent: new RuleIntentClassifier(),
    reranker: new PassThroughReranker(),
    parameters: structuredClone(DEFAULT_PARAMETERS),
  };
  return { store, deps };
}

describe('retrieval pipeline', () => {
  it('RRF orders by summed reciprocal ranks', () => {
    const scores = rrfScores(
      [
        ['a', 'b', 'c'],
        ['c', 'a'],
      ],
      60,
    );
    const order = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(order).toEqual(['a', 'c', 'b']);
    expect(scores.get('a')).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('filters by collection after the vector and fulltext queries', async () => {
    const { deps } = await corpus();
    const state = await retrieve(
      initialState('Federer Wimbledon', { mode: 'hybrid', collection: 'sports' }),
      deps,
    );
    expect(state.fused.length).toBeGreaterThan(0);
    expect(state.fused.every((c) => c.chunk.collection === 'sports')).toBe(true);
    const all = await retrieve(initialState('Federer Wimbledon', { mode: 'hybrid' }), deps);
    expect(all.fused.some((c) => c.chunk.collection === 'cooking')).toBe(true);
  });

  it('each mode switches stages on or off', async () => {
    const { deps } = await corpus();
    const vector = await retrieve(initialState('Who won on clay?', { mode: 'vector' }), deps);
    expect(vector.fulltextHits).toEqual([]);
    expect(vector.expanded).toEqual([]);
    const hybrid = await retrieve(initialState('Who won on clay?', { mode: 'hybrid' }), deps);
    expect(hybrid.fulltextHits.length).toBeGreaterThan(0);
    expect(hybrid.expanded).toEqual([]);
    const graph = await retrieve(
      initialState('Federer grass', { mode: 'graph', collection: 'sports' }),
      deps,
    );
    expect(graph.timings).toHaveProperty('expandGraph');
    expect(graph.ranked.every((c) => c.rerankScore === undefined)).toBe(true);
    const reranked = await retrieve(initialState('Federer grass', { mode: 'rerank' }), deps);
    expect(reranked.ranked.every((c) => c.features?.length === 9)).toBe(true);
    expect(reranked.gate?.applied).toBe(false);
  });

  it('graph expansion skips hub entities above the degree threshold', async () => {
    const store = new InMemoryStore();
    const { service } = makeService(store);
    for (const [i, extra] of ['Rare', 'Rare', '', '', ''].entries()) {
      await service.create({
        id: `d${i}`,
        source: { text: sentence(`Hubland ${extra} item${i}`), format: 'txt', title: `Doc ${i}` },
      });
    }
    const seed = (await store.getChunks('d0'))[0]!.id;
    const q = new HashEmbedder().vector('x');
    const loose = await store.expand([seed], {
      hubDegreeThreshold: 10,
      perKindLimit: 10,
      queryEmbedding: q,
    });
    expect(loose.filter((h) => h.kind === 'entity')).toHaveLength(4); // all others share 'Hubland'
    const strict = await store.expand([seed], {
      hubDegreeThreshold: 2,
      perKindLimit: 10,
      queryEmbedding: q,
    });
    const entityHits = strict.filter((h) => h.kind === 'entity');
    expect(entityHits.map((h) => h.chunk.documentId)).toEqual(['d1']);
    expect(entityHits[0]!.via).toEqual(['Rare']);
  });

  it('context selection respects the intent size and the token cap', () => {
    const chunk = (id: string, tokenCount: number) =>
      ({ id, tokenCount, entities: [], embedding: [] }) as unknown as RetrievedChunk;
    const ranked: Candidate[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
      chunk: chunk(id, i === 3 ? 100 : 1000),
      rrf: 1,
      cosine: 1,
      score: 1 - i / 10,
    }));
    const state = { ...initialState('q'), intent: 'compare' as const, ranked };
    const picked = selectContext(state, DEFAULT_PARAMETERS).context.map((c) => c.chunk.id);
    expect(picked).toEqual(['a', 'b', 'd']); // c would exceed 2500 tokens; d still fits
    const lookup = selectContext(
      {
        ...state,
        intent: 'lookup',
        ranked: ranked.map((c) => ({ ...c, chunk: chunk(c.chunk.id, 10) })),
      },
      DEFAULT_PARAMETERS,
    );
    expect(lookup.context).toHaveLength(4);
  });

  it('the evidence gate refuses in full mode when the best reranker score is below the threshold', async () => {
    const { deps } = await corpus();
    const low: Reranker = { name: 'low', score: async (rows) => rows.map(() => 0.1) };
    const high: Reranker = { name: 'high', score: async (rows) => rows.map(() => 0.9) };
    const refused = await retrieve(initialState('anything', { mode: 'full' }), {
      ...deps,
      reranker: low,
    });
    expect(refused.gate).toMatchObject({
      applied: true,
      passed: false,
      bestScore: 0.1,
      threshold: 0.5,
    });
    const passed = await retrieve(initialState('anything', { mode: 'full' }), {
      ...deps,
      reranker: high,
    });
    expect(passed.gate).toMatchObject({ applied: true, passed: true });
  });

  it('conversation memory: short or pronoun questions get the previous entities', () => {
    const history = [
      {
        question: 'Who won Wimbledon in 2003?',
        answer: 'Roger Federer.',
        entities: ['Roger Federer'],
      },
    ];
    expect(buildRetrievalQuery('And his rival?', history)).toBe('And his rival? Roger Federer');
    expect(buildRetrievalQuery('Which club won the 2005 Champions League final?', history)).toBe(
      'Which club won the 2005 Champions League final?',
    );
    const long = Array.from({ length: 5 }, (_, i) => ({
      question: 'q'.repeat(10),
      answer: 'word '.repeat(300) + i,
      entities: [],
    }));
    expect(trimHistory(long, 3, 800).length).toBeLessThan(3);
  });
});
