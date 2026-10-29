/** Text embeddings. Vectors are L2-normalized, so cosine similarity equals the dot product. */
export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  /** Queries get the model's retrieval instruction prefix (BGE); passages do not. */
  embedQuery(text: string): Promise<number[]>;
  embedPassages(texts: string[]): Promise<number[][]>;
  close(): Promise<void>;
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Cosine similarity for vectors that may not be normalized. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

export interface EntityInput {
  /** Chunk text (header included). */
  text: string;
  /** Sections of the chunk's document (Wikipedia links live here). */
  sections: import('./types.js').Section[];
}

/** Finds the entity names a chunk mentions. Names are the graph's Entity keys. */
export interface EntityExtractor {
  readonly name: string;
  extract(input: EntityInput): Promise<string[]>;
  close(): Promise<void>;
}

/** Learning-to-rank over feature rows (one row per candidate, see core/features.ts). */
export interface Reranker {
  readonly name: string;
  /** Relevance in [0, 1] per row, in input order. */
  score(features: number[][]): Promise<number[]>;
}

export interface IntentPrediction {
  intent: import('./types.js').Intent;
  confidence: number;
  source: string;
}

export interface IntentClassifier {
  readonly name: string;
  classify(question: string, embedding: number[]): Promise<IntentPrediction>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  /** Skip the development response cache (the evidence command always does). */
  bypassCache?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cached: boolean;
}

/** Text generation. Only free OpenRouter models are allowed in the real client. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
