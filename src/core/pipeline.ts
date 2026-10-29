import {
  type Candidate,
  type ChainState,
  type Turn,
  usesFulltext,
  usesGraph,
  usesReranker,
} from './chain.js';
import type { Parameters } from './config.js';
import { computeFeatures } from './features.js';
import { type Embedder, type IntentClassifier, type Reranker, dot } from './ports.js';
import type { RetrievedChunk, SearchHit, VectorGraphStore } from './store.js';
import { contentTerms, estimateTokens } from './text.js';

export interface RetrievalDeps {
  store: VectorGraphStore;
  embedder: Embedder;
  intent: IntentClassifier;
  reranker: Reranker;
  parameters: Parameters;
}

async function timed<T>(state: ChainState, stage: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    state.timings[stage] = Math.round(performance.now() - start);
  }
}

// ---------- conversation memory (local heuristic, no LLM call) ----------

const PRONOUNS = /\b(he|she|him|her|his|hers|they|them|their|it|its|that|this|those|these)\b/i;

/** Last `turns` turns, dropping the oldest while the history exceeds about `tokenBudget` tokens. */
export function trimHistory(history: Turn[], turns: number, tokenBudget: number): Turn[] {
  const kept = history.slice(-turns);
  while (
    kept.length > 0 &&
    kept.reduce((n, t) => n + estimateTokens(t.question + t.answer), 0) > tokenBudget
  ) {
    kept.shift();
  }
  return kept;
}

/** Short questions and questions with pronouns get the previous answer's entities appended. */
export function buildRetrievalQuery(question: string, history: Turn[]): string {
  const last = history[history.length - 1];
  if (!last || last.entities.length === 0) return question;
  const short = contentTerms(question).length < 4;
  if (!short && !PRONOUNS.test(question)) return question;
  return `${question} ${last.entities.slice(0, 5).join(' ')}`;
}

// ---------- fusion ----------

/** Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank), ranks starting at 1. */
export function rrfScores(lists: string[][], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

function candidateFrom(chunk: RetrievedChunk, query: number[]): Candidate {
  return { chunk, rrf: 0, cosine: dot(query, chunk.embedding), score: 0 };
}

// ---------- stages ----------

export async function classifyIntent(state: ChainState, deps: RetrievalDeps): Promise<ChainState> {
  return timed(state, 'classifyIntent', async () => {
    state.queryEmbedding ??= await deps.embedder.embedQuery(state.retrievalQuery);
    const prediction = await deps.intent.classify(state.question, state.queryEmbedding);
    state.intent = prediction.intent;
    state.intentSource = prediction.source;
    return state;
  });
}

/** Vector top-k plus fulltext top-k fused with RRF into the candidate list. */
export async function hybridRetrieve(state: ChainState, deps: RetrievalDeps): Promise<ChainState> {
  return timed(state, 'hybridRetrieve', async () => {
    const r = deps.parameters.retrieval;
    const q = (state.queryEmbedding ??= await deps.embedder.embedQuery(state.retrievalQuery));
    state.vectorHits = await deps.store.vectorSearch(q, r.vectorTopK, state.collection);
    state.fulltextHits = usesFulltext(state.mode)
      ? await deps.store.fulltextSearch(state.retrievalQuery, r.fulltextTopK, state.collection)
      : [];
    const byId = new Map<string, Candidate>();
    const take = (hits: SearchHit[], kind: 'vector' | 'fulltext') =>
      hits.forEach((h, rank) => {
        const c = byId.get(h.chunk.id) ?? candidateFrom(h.chunk, q);
        if (kind === 'vector') {
          c.vectorRank = rank;
          c.vectorScore = h.score;
        } else {
          c.fulltextRank = rank;
          c.fulltextScore = h.score;
        }
        byId.set(h.chunk.id, c);
      });
    take(state.vectorHits, 'vector');
    take(state.fulltextHits, 'fulltext');
    const fused = rrfScores(
      [state.vectorHits.map((h) => h.chunk.id), state.fulltextHits.map((h) => h.chunk.id)],
      r.rrfK,
    );
    state.fused = [...byId.values()]
      .map((c) => ({ ...c, rrf: fused.get(c.chunk.id) ?? 0, score: fused.get(c.chunk.id) ?? 0 }))
      .sort((a, b) => b.rrf - a.rrf || b.cosine - a.cosine)
      .slice(0, r.candidatesAfterFusion);
    return state;
  });
}

/**
 * NEXT neighbours of the best seeds, chunks sharing non-hub entities with them, and chunks of
 * linked documents. Hub entities (degree above the threshold) are skipped.
 */
export async function expandGraph(state: ChainState, deps: RetrievalDeps): Promise<ChainState> {
  return timed(state, 'expandGraph', async () => {
    if (!usesGraph(state.mode) || state.fused.length === 0) return state;
    const r = deps.parameters.retrieval;
    const seeds = state.fused.slice(0, r.graphSeedCount).map((c) => c.chunk.id);
    const hits = await deps.store.expand(seeds, {
      hubDegreeThreshold: r.hubDegreeThreshold,
      perKindLimit: 10,
      queryEmbedding: state.queryEmbedding!,
      ...(state.collection ? { collection: state.collection } : {}),
    });
    const known = new Set(state.fused.map((c) => c.chunk.id));
    state.expanded = [];
    for (const h of hits) {
      if (known.has(h.chunk.id)) continue;
      known.add(h.chunk.id);
      state.expanded.push({
        ...candidateFrom(h.chunk, state.queryEmbedding!),
        expansion: { kind: h.kind, fromChunkId: h.fromChunkId, via: h.via },
      });
    }
    return state;
  });
}

/**
 * vector and hybrid: fused order. graph: RRF over the vector list, the fulltext list and the
 * whole pool (fused plus expanded) ranked by cosine, so graph chunks can enter.
 * rerank and full: the TensorFlow.js reranker scores the feature rows.
 */
export async function rank(state: ChainState, deps: RetrievalDeps): Promise<ChainState> {
  return timed(state, 'rank', async () => {
    const pool = [...state.fused, ...state.expanded];
    if (!usesGraph(state.mode)) {
      state.ranked = state.fused.map((c) => ({ ...c, score: c.rrf }));
      return state;
    }
    if (!usesReranker(state.mode)) {
      const byCosine = [...pool].sort((a, b) => b.cosine - a.cosine).map((c) => c.chunk.id);
      const extra = rrfScores([byCosine], deps.parameters.retrieval.rrfK);
      state.ranked = pool
        .map((c) => ({ ...c, score: c.rrf + (extra.get(c.chunk.id) ?? 0) }))
        .sort((a, b) => b.score - a.score);
      return state;
    }
    const features = computeFeatures(state.question, pool, deps.parameters.chunking.maxTokens);
    const scores = await deps.reranker.score(features);
    state.ranked = pool
      .map((c, i) => ({ ...c, features: features[i]!, rerankScore: scores[i]!, score: scores[i]! }))
      .sort((a, b) => b.score - a.score);
    return state;
  });
}

/** Top chunks by intent (lookup 4, explain 6, compare 8, timeline 8) within the token cap. */
export function selectContext(state: ChainState, parameters: Parameters): ChainState {
  const r = parameters.retrieval;
  const k = r.finalKByIntent[state.intent ?? 'lookup'];
  const context: Candidate[] = [];
  let tokens = 0;
  for (const c of state.ranked) {
    if (context.length >= k) break;
    if (context.length > 0 && tokens + c.chunk.tokenCount > r.contextTokenCap) continue;
    context.push(c);
    tokens += c.chunk.tokenCount;
  }
  state.context = context;
  return state;
}

/** Full mode only: refuse without calling the LLM when the best reranker score is too low. */
export function evidenceGate(state: ChainState, parameters: Parameters): ChainState {
  const threshold = parameters.evidenceGate.threshold;
  const best = state.context[0]?.rerankScore ?? 0;
  const applied = state.mode === 'full';
  state.gate = { applied, passed: !applied || best >= threshold, bestScore: best, threshold };
  return state;
}

/** Stages 1 to 6 (no LLM). */
export async function retrieve(state: ChainState, deps: RetrievalDeps): Promise<ChainState> {
  await classifyIntent(state, deps);
  await hybridRetrieve(state, deps);
  await expandGraph(state, deps);
  await rank(state, deps);
  selectContext(state, deps.parameters);
  evidenceGate(state, deps.parameters);
  return state;
}
