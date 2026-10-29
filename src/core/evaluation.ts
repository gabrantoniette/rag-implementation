import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { type ChainState, type Mode, initialState } from './chain.js';
import { shuffled } from './random.js';
import { computeFeatures } from './features.js';
import {
  type GoldSpec,
  isRelevant,
  matchesGold,
  mean,
  ndcgAtK,
  reciprocalRank,
  recallAtK,
} from './metrics.js';
import { type RetrievalDeps, expandGraph, hybridRetrieve, rank } from './pipeline.js';
import type { RetrievedChunk } from './store.js';

export const EvalQuerySchema = z.object({
  id: z.string(),
  query: z.string(),
  kind: z.string(),
  gold: z.array(z.object({ title: z.string(), section: z.string().optional() })),
  /** On the domain's topic but not answerable from the corpus (used to calibrate the evidence gate). */
  outOfCorpus: z.boolean().default(false),
  note: z.string().optional(),
});
export type EvalQuery = z.infer<typeof EvalQuerySchema>;

export function loadEvalSet(file: string): EvalQuery[] {
  if (!existsSync(file)) return [];
  return z.array(EvalQuerySchema).parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface ModeMetrics {
  queries: number;
  recallAt6: number;
  mrr: number;
  ndcgAt6: number;
}

/** title -> chunks of that document (to know how many relevant chunks exist for nDCG). */
export type ChunkIndex = Map<string, RetrievedChunk[]>;

export async function chunkIndex(deps: RetrievalDeps, collection?: string): Promise<ChunkIndex> {
  const docs = await deps.store.listDocuments({
    limit: 100_000,
    offset: 0,
    ...(collection ? { collection } : {}),
  });
  const index: ChunkIndex = new Map();
  for (const d of docs) index.set(d.title, await deps.store.getChunks(d.id));
  return index;
}

const relevantCount = (gold: GoldSpec[], index: ChunkIndex) =>
  [...new Set(gold.map((g) => g.title))].reduce(
    (n, title) =>
      n + (index.get(title) ?? []).filter((c) => gold.some((g) => matchesGold(c, g))).length,
    0,
  );

/** Retrieval without generation, in one ablation mode (the ranked list is what is scored). */
export async function rankedFor(
  query: string,
  mode: Mode,
  deps: RetrievalDeps,
  collection?: string,
): Promise<ChainState> {
  const state = initialState(query, { mode, ...(collection ? { collection } : {}) });
  await hybridRetrieve(state, deps);
  await expandGraph(state, deps);
  await rank(state, deps);
  return state;
}

/** recall@6, MRR and nDCG@6 of one mode over answerable queries. */
export async function evaluateMode(
  queries: EvalQuery[],
  mode: Mode,
  deps: RetrievalDeps,
  index: ChunkIndex,
  collection?: string,
): Promise<ModeMetrics & { perQuery: { id: string; ndcg: number; rr: number }[] }> {
  const answerable = queries.filter((q) => !q.outOfCorpus && q.gold.length > 0);
  const recall: number[] = [];
  const rr: number[] = [];
  const ndcg: number[] = [];
  const perQuery: { id: string; ndcg: number; rr: number }[] = [];
  for (const q of answerable) {
    const state = await rankedFor(q.query, mode, deps, collection);
    const ranked = state.ranked.map((c) => c.chunk);
    const rel = ranked.map((c) => isRelevant(c, q.gold));
    recall.push(recallAtK(ranked, q.gold, 6));
    rr.push(reciprocalRank(rel));
    ndcg.push(ndcgAtK(rel, 6, relevantCount(q.gold, index)));
    perQuery.push({ id: q.id, ndcg: ndcg[ndcg.length - 1]!, rr: rr[rr.length - 1]! });
  }
  return {
    queries: answerable.length,
    recallAt6: mean(recall),
    mrr: mean(rr),
    ndcgAt6: mean(ndcg),
    perQuery,
  };
}

/**
 * Synthetic pseudo-queries: 'article title + section heading' for sections other than the
 * introduction and infobox. Positives are the chunks of that section.
 */
export function syntheticQueries(index: ChunkIndex): EvalQuery[] {
  const out: EvalQuery[] = [];
  for (const [title, chunks] of index) {
    const sections = [...new Set(chunks.map((c) => c.section))].filter(
      (s) => s !== 'Introduction' && s !== 'Infobox' && s.trim().length > 0,
    );
    for (const section of sections) {
      const heading = section.split(' > ').pop()!;
      out.push({
        id: `syn:${title}:${section}`,
        query: `${title} ${heading}`,
        kind: 'synthetic',
        gold: [{ title, section }],
        outOfCorpus: false,
      });
    }
  }
  return out;
}

/** Feature rows and labels for one query's candidate pool (fused plus graph). */
export async function labelledRows(
  query: EvalQuery,
  deps: RetrievalDeps,
  collection?: string,
): Promise<{ rows: number[][]; labels: number[] }> {
  const state = await rankedFor(query.query, 'graph', deps, collection);
  const pool = [...state.fused, ...state.expanded];
  const rows = computeFeatures(query.query, pool, deps.parameters.chunking.maxTokens);
  return { rows, labels: pool.map((c) => (isRelevant(c.chunk, query.gold) ? 1 : 0)) };
}

export const SYNTHETIC_SEED = 21;
export const SYNTHETIC_VAL = 30;
const SYNTHETIC_TRAIN = 400;

/** Deterministic split of the synthetic pseudo-queries: about 30 for validation, up to 400 for training. */
export function syntheticSplit(index: ChunkIndex) {
  const all = shuffled(syntheticQueries(index), SYNTHETIC_SEED);
  return {
    val: all.slice(0, SYNTHETIC_VAL),
    train: all.slice(SYNTHETIC_VAL, SYNTHETIC_VAL + SYNTHETIC_TRAIN),
  };
}
