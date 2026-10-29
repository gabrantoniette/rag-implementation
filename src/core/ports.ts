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
