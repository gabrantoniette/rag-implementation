import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  TfjsReranker,
  currentVersion,
  nextVersion,
  saveModel,
  setCurrentVersion,
  shuffled,
  trainRerankerModel,
} from '../adapters/tfjs.js';
import { chooseThreshold } from '../core/calibration.js';
import { CALIBRATION_FILE, type Calibration } from '../core/config.js';
import {
  type ChunkIndex,
  type EvalQuery,
  chunkIndex,
  evaluateMode,
  labelledRows,
  loadEvalSet,
  rankedFor,
  syntheticSplit,
} from '../core/evaluation.js';
import { PassThroughReranker } from '../adapters/baselines.js';
import { feedbackLabels, readFeedback, shouldPromote } from '../core/feedback.js';
import { chunkBody } from '../core/generation.js';
import { computeFeatures } from '../core/features.js';
import { PATHS } from '../core/paths.js';
import type { RetrievalDeps } from '../core/pipeline.js';
import { type Reranker, dot } from '../core/ports.js';
import { createRag } from '../index.js';
import { runCli } from './args.js';

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Sentences taken from real chunks (scored against their own chunk) vs. against another document. */
async function sentenceSupportData(index: ChunkIndex, deps: RetrievalDeps) {
  const docs = [...index.values()].filter((c) => c.length > 0);
  const picks = shuffled(docs.flat(), 5).slice(0, 120);
  const supported: number[] = [];
  const unrelated: number[] = [];
  for (const [i, chunk] of picks.entries()) {
    const sentences = [...segmenter.segment(chunkBody(chunk.text))]
      .map((s) => s.segment.trim())
      .filter((s) => s.split(/\s+/).length >= 8);
    const sentence = sentences[i % Math.max(1, sentences.length)];
    if (!sentence) continue;
    const other =
      picks.find((c, j) => j > i && c.documentId !== chunk.documentId) ??
      picks.find((c) => c.documentId !== chunk.documentId);
    if (!other) continue;
    const full = await deps.store.getChunksByIds([chunk.id, other.id]);
    const self = full.find((c) => c.id === chunk.id);
    const foreign = full.find((c) => c.id === other.id);
    if (!self || !foreign) continue;
    const [v] = await deps.embedder.embedPassages([sentence]);
    supported.push(dot(v!, self.embedding));
    unrelated.push(dot(v!, foreign.embedding));
  }
  return { supported, unrelated };
}

/**
 * npm run train:reranker: trains the learning-to-rank MLP on synthetic pairs (section headings as
 * pseudo-queries, hard negatives from the same candidate pool) plus data/feedback.jsonl, then
 * promotes it only if nDCG@6 is no worse on the hand-written and synthetic validation sets.
 * Finally calibrates the evidence-gate and sentence-support thresholds (models/calibration.json).
 */
runCli(async () => {
  const rag = await createRag({ llm: 'none', reranker: 'pass-through' });
  try {
    const deps: RetrievalDeps = { ...rag, parameters: rag.config.parameters };
    const collection = rag.config.domain.collection;
    const index = await chunkIndex(deps, collection);
    if (index.size === 0)
      throw new Error(
        `No documents in collection '${collection}'. Run npm run ingest:build first.`,
      );
    const { train, val } = syntheticSplit(index);
    const hand = loadEvalSet(path.join(rag.config.domain.evalDir, 'retrieval-eval.json'));

    const rows: number[][] = [];
    const labels: number[] = [];
    for (const q of train) {
      const r = await labelledRows(q, deps, collection);
      rows.push(...r.rows);
      labels.push(...r.labels);
    }
    const synthRows = rows.length;

    // Feedback: features of the rated chunks inside each question's candidate pool.
    const known = new Set([...index.values()].flat().map((c) => c.id));
    const records = readFeedback(PATHS.feedback);
    const { labels: fb, skipped } = feedbackLabels(records, (id) => known.has(id));
    let feedbackRows = 0;
    let feedbackMissing = 0;
    for (const question of [...new Set(fb.map((l) => l.question))]) {
      const state = await rankedFor(question, 'graph', deps, collection);
      const pool = [...state.fused, ...state.expanded];
      const features = computeFeatures(question, pool, deps.parameters.chunking.maxTokens);
      for (const l of fb.filter((x) => x.question === question)) {
        const i = pool.findIndex((c) => c.chunk.id === l.chunkId);
        if (i < 0) {
          feedbackMissing++;
          continue;
        }
        rows.push(features[i]!);
        labels.push(l.label);
        feedbackRows++;
      }
    }
    if (skipped > 0)
      rag.logger.warn(`Skipped ${skipped} feedback record(s) that reference deleted chunks`);

    const model = await trainRerankerModel(rows, labels, { epochs: 40 });
    const candidate = new TfjsReranker(model);
    const scoreWith = async (reranker: Reranker, set: EvalQuery[]) =>
      (await evaluateMode(set, 'rerank', { ...deps, reranker }, index, collection)).ndcgAt6;
    const candidateScore = {
      handNdcg6: await scoreWith(candidate, hand),
      syntheticNdcg6: await scoreWith(candidate, val),
    };

    const root = path.join(PATHS.models, 'reranker');
    const currentV = currentVersion(root);
    // With no trained model yet, the bar is the pass-through baseline the pipeline uses today:
    // a first model that ranks worse than plain fusion is not promoted.
    const current = currentV
      ? await TfjsReranker.load(path.join(root, `v${currentV}`))
      : new PassThroughReranker();
    const currentScore = {
      handNdcg6: await scoreWith(current, hand),
      syntheticNdcg6: await scoreWith(current, val),
    };
    const promoted = shouldPromote(currentScore, candidateScore);
    const version = nextVersion(root);
    const dir = path.join(root, `v${version}`);
    await saveModel(model, dir);
    const metrics = {
      version,
      promoted,
      candidate: candidateScore,
      current: { version: currentV ?? 'pass-through', ...currentScore },
      trainQueries: train.length,
      validationQueries: val.length,
      handQueries: hand.filter((q) => !q.outOfCorpus).length,
      rows: rows.length,
      positives: labels.filter((l) => l === 1).length,
      syntheticRows: synthRows,
      feedbackRecords: records.length,
      feedbackRows,
      feedbackSkippedDeletedChunks: skipped,
      feedbackNotInPool: feedbackMissing,
      trainedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    writeFileSync(path.join(root, 'synthetic-val.json'), `${JSON.stringify(val, null, 2)}\n`);
    if (promoted) setCurrentVersion(root, version);

    // Calibration with the active reranker. The pass-through baseline always gives the top chunk
    // 1.0, so the evidence gate is only calibrated when a trained model is active.
    const activeV = currentVersion(root);
    const answerable: number[] = [];
    const outOfCorpus: number[] = [];
    if (activeV) {
      const active = await TfjsReranker.load(path.join(root, `v${activeV}`));
      const best = async (q: string) =>
        (await rankedFor(q, 'rerank', { ...deps, reranker: active }, collection)).ranked[0]
          ?.rerankScore ?? 0;
      for (const q of hand) (q.outOfCorpus ? outOfCorpus : answerable).push(await best(q.query));
    }
    const gate =
      answerable.length && outOfCorpus.length ? chooseThreshold(answerable, outOfCorpus) : null;
    const support = await sentenceSupportData(index, deps);
    const sentence = chooseThreshold(support.supported, support.unrelated);
    const previous: Calibration = existsSync(CALIBRATION_FILE)
      ? JSON.parse(readFileSync(CALIBRATION_FILE, 'utf8'))
      : {};
    const calibration = {
      ...previous,
      ...(gate ? { evidenceGateThreshold: Number(gate.threshold.toFixed(4)) } : {}),
      sentenceSupportThreshold: Number(sentence.threshold.toFixed(4)),
    };
    writeFileSync(CALIBRATION_FILE, `${JSON.stringify(calibration, null, 2)}\n`);
    writeFileSync(
      path.join(PATHS.models, 'calibration-data.json'),
      `${JSON.stringify({ rerankerVersion: activeV, gate, gateScores: { answerable, outOfCorpus }, sentence, sentenceScores: support }, null, 2)}\n`,
    );

    const f = (n: number) => n.toFixed(4);
    process.stdout.write(
      [
        `Reranker v${version}: ${promoted ? 'PROMOTED' : 'NOT promoted (worse than current)'}; active = ${activeV ? `v${activeV}` : 'pass-through baseline'}`,
        `training rows=${rows.length} (synthetic ${synthRows} from ${train.length} queries, feedback ${feedbackRows}), positives=${metrics.positives}`,
        `feedback records=${records.length}, skipped (deleted chunks)=${skipped}, not in pool=${feedbackMissing}`,
        `candidate nDCG@6: hand-written=${f(candidateScore.handNdcg6)} synthetic-val=${f(candidateScore.syntheticNdcg6)}`,
        `current ${currentV ? `v${currentV}` : 'pass-through baseline'} nDCG@6: hand-written=${f(currentScore.handNdcg6)} synthetic-val=${f(currentScore.syntheticNdcg6)}`,
        gate
          ? `evidence gate threshold=${f(gate.threshold)} (answerable ${gate.positives}, out-of-corpus ${gate.negatives}, pass rate ${f(gate.truePositiveRate)}, refuse rate ${f(gate.trueNegativeRate)}, separable=${gate.separable})`
          : activeV
            ? 'evidence gate not calibrated (the eval set needs answerable and out-of-corpus queries)'
            : 'evidence gate not calibrated (no trained reranker is active)',
        `sentence support threshold=${f(sentence.threshold)} (supported ${sentence.positives}, unrelated ${sentence.negatives}, balanced accuracy ${f(sentence.balancedAccuracy)})`,
        '',
      ].join('\n'),
    );
    return 0;
  } finally {
    await rag.close();
  }
});
