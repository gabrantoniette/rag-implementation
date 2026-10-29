import type { ExpansionKind, RetrievedChunk, SearchHit } from './store.js';
import type { Intent } from './types.js';

/**
 * vector: vector search only. hybrid: + fulltext and RRF. graph: + graph expansion.
 * rerank: + TensorFlow.js learning-to-rank. full: + evidence gate, generation and verification.
 */
export type Mode = 'vector' | 'hybrid' | 'graph' | 'rerank' | 'full';
export const MODES: readonly Mode[] = ['vector', 'hybrid', 'graph', 'rerank', 'full'];

export interface Turn {
  question: string;
  answer: string;
  entities: string[];
}

export interface Candidate {
  chunk: RetrievedChunk;
  vectorRank?: number;
  vectorScore?: number;
  fulltextRank?: number;
  fulltextScore?: number;
  /** Reciprocal rank fusion score (0 for chunks reached only through the graph). */
  rrf: number;
  /** Dot product of the query and chunk embeddings (both normalized). */
  cosine: number;
  expansion?: { kind: ExpansionKind; fromChunkId: string; via: string[] };
  features?: number[];
  rerankScore?: number;
  /** Score used for the final order in the current mode. */
  score: number;
}

export interface Citation {
  n: number;
  chunkId: string;
  documentTitle: string;
  documentUri: string;
  section: string;
  locator: string;
}

export interface SentenceCheck {
  sentence: string;
  citations: number[];
  support: number;
  supported: boolean;
}

export interface Verification {
  citationsValid: boolean;
  invalidCitations: number[];
  sentences: SentenceCheck[];
  groundingScore: number;
  passed: boolean;
  structureErrors: string[];
}

/** The typed state every pipeline stage reads and writes. */
export interface ChainState {
  question: string;
  collection?: string;
  mode: Mode;
  history: Turn[];
  /** Question plus remembered entities for short or pronoun questions (local heuristic). */
  retrievalQuery: string;
  intent?: Intent;
  intentSource?: string;
  queryEmbedding?: number[];
  vectorHits: SearchHit[];
  fulltextHits: SearchHit[];
  fused: Candidate[];
  expanded: Candidate[];
  ranked: Candidate[];
  context: Candidate[];
  gate?: { applied: boolean; passed: boolean; bestScore: number; threshold: number };
  prompt?: string;
  rawAnswer?: string;
  answer?: string;
  citations: Citation[];
  verification?: Verification;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  timings: Record<string, number>;
  warnings: string[];
}

export function initialState(
  question: string,
  options: { mode?: Mode; collection?: string; history?: Turn[] } = {},
): ChainState {
  return {
    question,
    ...(options.collection ? { collection: options.collection } : {}),
    mode: options.mode ?? 'full',
    history: options.history ?? [],
    retrievalQuery: question,
    vectorHits: [],
    fulltextHits: [],
    fused: [],
    expanded: [],
    ranked: [],
    context: [],
    citations: [],
    timings: {},
    warnings: [],
  };
}

export const usesFulltext = (m: Mode) => m !== 'vector';
export const usesGraph = (m: Mode) => m === 'graph' || m === 'rerank' || m === 'full';
export const usesReranker = (m: Mode) => m === 'rerank' || m === 'full';
