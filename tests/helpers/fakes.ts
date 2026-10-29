import { InMemoryStore } from '../../src/adapters/memory-store.js';
import { DEFAULT_PARAMETERS } from '../../src/core/config.js';
import { DocumentService } from '../../src/core/document-service.js';
import { sha256 } from '../../src/core/hash.js';
import { silentLogger } from '../../src/core/logger.js';
import type { Embedder, EntityExtractor } from '../../src/core/ports.js';
import type { VectorGraphStore } from '../../src/core/store.js';
import { contentTerms } from '../../src/core/text.js';
import { approximateTokenCounter } from '../../src/core/tokens.js';
import { createRegistry } from '../../src/loaders/index.js';
import { loaderContext } from './context.js';

/**
 * Deterministic bag-of-words embedder (hashed terms, L2-normalized). No model download; texts that
 * share words are similar, which is enough for store and pipeline unit tests.
 */
export class HashEmbedder implements Embedder {
  readonly modelId = 'test/hash-embedder';
  passagesEmbedded = 0;
  queriesEmbedded = 0;
  constructor(readonly dimensions = 64) {}

  vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const term of contentTerms(text)) {
      const h = parseInt(sha256(term).slice(0, 8), 16);
      v[h % this.dimensions]! += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
  async embedQuery(text: string): Promise<number[]> {
    this.queriesEmbedded++;
    return this.vector(text);
  }
  async embedPassages(texts: string[]): Promise<number[][]> {
    this.passagesEmbedded += texts.length;
    return texts.map((t) => this.vector(t));
  }
  async close(): Promise<void> {}
}

/** Capitalized words (4+ letters) after the header line, as stand-in entities. */
export const capitalizedEntities: EntityExtractor = {
  name: 'capitalized',
  async extract({ text }) {
    const body = text.slice(text.indexOf('\n') + 1);
    return [...new Set(body.match(/\b[A-Z][a-z]{3,}\b/g) ?? [])];
  },
  async close() {},
};

export function makeService(
  store: VectorGraphStore = new InMemoryStore(),
  embedder = new HashEmbedder(),
  extractor: EntityExtractor = capitalizedEntities,
) {
  const service = new DocumentService({
    store,
    embedder,
    registry: createRegistry(50 * 1024 * 1024),
    context: async () => loaderContext(),
    tokens: approximateTokenCounter,
    parameters: structuredClone(DEFAULT_PARAMETERS),
    extractorFor: () => extractor,
    defaultCollection: 'fixtures',
    logger: silentLogger,
  });
  return { service, store, embedder };
}

/** Recounts CO_OCCURS from chunk entities: weight = number of chunks mentioning both. */
export async function recountCoOccurs(store: VectorGraphStore, documentIds: string[]) {
  const counts = new Map<string, number>();
  for (const id of documentIds) {
    const chunks = await store.getChunksByIds((await store.getChunks(id)).map((c) => c.id));
    for (const c of chunks) {
      const es = [...new Set(c.entities)].sort();
      for (let i = 0; i < es.length; i++) {
        for (let j = i + 1; j < es.length; j++) {
          const key = `${es[i]}\u0000${es[j]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}
