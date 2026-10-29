import { rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TfjsIntentClassifier,
  TfjsReranker,
  loadModel,
  saveModel,
  seededRandom,
  trainIntentModel,
  trainRerankerModel,
} from '../../src/adapters/tfjs.js';
import { feedbackLabels, shouldPromote } from '../../src/core/feedback.js';
import { ndcgAtK, reciprocalRank, recallAtK } from '../../src/core/metrics.js';
import { PATHS } from '../../src/core/paths.js';
import { INTENTS } from '../../src/core/types.js';

const dir = (name: string) => path.join(PATHS.cache, 'test-models', name);

/** Separable toy data: class c has a bump at dimensions [8c, 8c+8). */
function toyExamples(perClass: number) {
  const rand = seededRandom(3);
  return INTENTS.flatMap((intent, c) =>
    Array.from({ length: perClass }, () => ({
      intent,
      embedding: Array.from(
        { length: 32 },
        (_, d) => (d >= c * 8 && d < c * 8 + 8 ? 1 : 0) + rand() * 0.3,
      ),
    })),
  );
}

describe('TensorFlow.js models', () => {
  it('intent classifier trains, saves, reloads and predicts the same', async () => {
    const { model, report } = await trainIntentModel(toyExamples(20), { epochs: 40 });
    expect(report.valSize).toBe(16);
    expect(report.valAccuracy).toBeGreaterThanOrEqual(0.9);
    rmSync(dir('intent'), { recursive: true, force: true });
    await saveModel(model, dir('intent'));
    const original = new TfjsIntentClassifier(model);
    const reloaded = await TfjsIntentClassifier.load(dir('intent'));
    const probe = toyExamples(2).map((e) => e.embedding);
    expect(reloaded.probabilities(probe)).toEqual(original.probabilities(probe));
  });

  it('reranker trains on features, saves, reloads and scores the same', async () => {
    const rand = seededRandom(5);
    const rows = Array.from({ length: 400 }, () => Array.from({ length: 9 }, () => rand()));
    const labels = rows.map((r) => (r[0]! + r[8]! > 1 ? 1 : 0));
    const model = await trainRerankerModel(rows, labels, { epochs: 30 });
    rmSync(dir('reranker'), { recursive: true, force: true });
    await saveModel(model, dir('reranker'));
    const a = await new TfjsReranker(model).score(rows.slice(0, 20));
    const b = await new TfjsReranker(await loadModel(dir('reranker'))).score(rows.slice(0, 20));
    expect(b).toEqual(a);
    expect(a.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it('gated retraining promotes only when nDCG@6 is no worse on both eval sets', () => {
    const current = { handNdcg6: 0.6, syntheticNdcg6: 0.7 };
    expect(shouldPromote(null, { handNdcg6: 0.1, syntheticNdcg6: 0.1 })).toBe(true);
    expect(shouldPromote(current, { handNdcg6: 0.6, syntheticNdcg6: 0.7 })).toBe(true);
    expect(shouldPromote(current, { handNdcg6: 0.65, syntheticNdcg6: 0.75 })).toBe(true);
    expect(shouldPromote(current, { handNdcg6: 0.7, syntheticNdcg6: 0.69 })).toBe(false);
    expect(shouldPromote(current, { handNdcg6: 0.59, syntheticNdcg6: 0.9 })).toBe(false);
  });

  it('feedback on deleted chunks is skipped and counted', () => {
    const records = [
      { question: 'q1', chunkIds: ['a', 'b'], cited: ['a'], rating: 'up' as const, at: 't' },
      { question: 'q2', chunkIds: ['gone', 'b'], cited: ['b'], rating: 'up' as const, at: 't' },
      { question: 'q3', chunkIds: ['a', 'b'], cited: ['b'], rating: 'down' as const, at: 't' },
    ];
    const { labels, skipped } = feedbackLabels(records, (id) => id !== 'gone');
    expect(skipped).toBe(1);
    expect(labels).toEqual([
      { question: 'q1', chunkId: 'a', label: 1 },
      { question: 'q1', chunkId: 'b', label: 0 },
      { question: 'q3', chunkId: 'b', label: 0 },
    ]);
  });

  it('ranking metrics', () => {
    expect(reciprocalRank([false, false, true])).toBeCloseTo(1 / 3);
    expect(ndcgAtK([true, false, false], 6, 1)).toBe(1);
    expect(ndcgAtK([false, true], 6, 1)).toBeCloseTo(1 / Math.log2(3));
    const ranked = [
      { documentTitle: 'A', section: 'Career > Early years' },
      { documentTitle: 'B', section: 'Introduction' },
    ];
    expect(recallAtK(ranked, [{ title: 'A', section: 'Career' }, { title: 'C' }], 6)).toBe(0.5);
  });
});
