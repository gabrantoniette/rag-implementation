import { chunkDocument } from '../../src/core/chunker.js';
import { DEFAULT_PARAMETERS } from '../../src/core/config.js';
import { type Embedder, dot } from '../../src/core/ports.js';
import type { TokenCounter } from '../../src/core/tokens.js';
import type { ChunkDraft, ParsedDocument } from '../../src/core/types.js';

export interface IndexedChunk extends ChunkDraft {
  documentTitle: string;
  embedding: number[];
}

/** Chunks and embeds documents for brute-force retrieval checks (no database). */
export async function indexDocuments(
  docs: ParsedDocument[],
  tokens: TokenCounter,
  embedder: Embedder,
): Promise<IndexedChunk[]> {
  const chunks = docs.flatMap((d) =>
    chunkDocument(d, tokens, DEFAULT_PARAMETERS.chunking).map((c) => ({
      ...c,
      documentTitle: d.title,
    })),
  );
  const vectors = await embedder.embedPassages(chunks.map((c) => c.text));
  return chunks.map((c, i) => ({ ...c, embedding: vectors[i]! }));
}

export async function topK(
  index: IndexedChunk[],
  embedder: Embedder,
  query: string,
  k: number,
): Promise<IndexedChunk[]> {
  const q = await embedder.embedQuery(query);
  return [...index].sort((a, b) => dot(q, b.embedding) - dot(q, a.embedding)).slice(0, k);
}
