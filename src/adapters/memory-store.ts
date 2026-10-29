import { dot } from '../core/ports.js';
import type {
  ChunkWrite,
  DeletePlan,
  DocumentChange,
  ExpansionHit,
  ExpansionLimits,
  GraphCounts,
  ListFilter,
  RetrievedChunk,
  SearchHit,
  VectorGraphStore,
} from '../core/store.js';
import { contentTerms } from '../core/text.js';
import type { DocumentRecord } from '../core/types.js';

interface StoredDoc extends DocumentRecord {
  linkTargets: string[];
}

interface MemChunk extends ChunkWrite {
  documentId: string;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * In-process implementation of the store, with brute-force vector search and BM25 keyword search.
 * Used by unit tests and the reuse test; same semantics as Neo4jStore.
 */
export class InMemoryStore implements VectorGraphStore {
  private readonly docs = new Map<string, StoredDoc>();
  private readonly chunks = new Map<string, MemChunk>();
  private readonly entityChunks = new Map<string, Set<string>>();
  private readonly coOccurs = new Map<string, number>();
  private readonly links = new Set<string>(); // `${from}\u0000${to}`
  private bm25: { df: Map<string, number>; avgLen: number; lengths: Map<string, number> } | null =
    null;

  async init(): Promise<void> {}

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const d = this.docs.get(id);
    if (!d) return null;
    const { linkTargets: _l, ...record } = d;
    return structuredClone(record);
  }

  async documentStats(id: string) {
    const chunks = [...this.chunks.values()].filter((c) => c.documentId === id);
    const entities = new Set(chunks.flatMap((c) => c.entities));
    return { chunkCount: chunks.length, entityCount: entities.size };
  }

  async listDocuments(filter: ListFilter): Promise<DocumentRecord[]> {
    const needle = filter.titleContains?.toLowerCase();
    const all = [...this.docs.keys()]
      .map((id) => this.docs.get(id)!)
      .filter((d) => !filter.collection || d.collection === filter.collection)
      .filter((d) => !filter.format || d.format === filter.format)
      .filter((d) => !needle || d.title.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const page = all.slice(filter.offset, filter.offset + filter.limit);
    return Promise.all(page.map(async (d) => (await this.getDocument(d.id))!));
  }

  private toRetrieved(c: MemChunk, withEmbedding = true): RetrievedChunk {
    const d = this.docs.get(c.documentId)!;
    return {
      id: c.id,
      documentId: c.documentId,
      documentTitle: d.title,
      documentUri: d.uri,
      documentFormat: d.format,
      collection: d.collection,
      chunkIndex: c.chunkIndex,
      text: c.text,
      section: c.section,
      locator: c.locator,
      modality: c.modality,
      tokenCount: c.tokenCount,
      contentHash: c.contentHash,
      embedding: withEmbedding ? c.embedding : [],
      entities: [...c.entities],
    };
  }

  async getChunks(documentId: string): Promise<RetrievedChunk[]> {
    return [...this.chunks.values()]
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((c) => this.toRetrieved(c, false));
  }

  private touch(entities: Iterable<string>, into: Set<string>) {
    for (const e of entities) into.add(e);
  }

  private recomputeEntities(touched: Set<string>) {
    for (const key of [...this.coOccurs.keys()]) {
      const [a, b] = key.split('\u0000') as [string, string];
      if (touched.has(a) || touched.has(b)) this.coOccurs.delete(key);
    }
    for (const e of touched) {
      const chunkIds = this.entityChunks.get(e);
      if (!chunkIds || chunkIds.size === 0) {
        this.entityChunks.delete(e); // orphan
        continue;
      }
      const counts = new Map<string, number>();
      for (const id of chunkIds) {
        for (const f of new Set(this.chunks.get(id)!.entities)) {
          if (f !== e) counts.set(f, (counts.get(f) ?? 0) + 1);
        }
      }
      for (const [f, w] of counts) this.coOccurs.set(pairKey(e, f), w);
    }
  }

  private rebuildLinks(doc: StoredDoc) {
    for (const key of [...this.links]) {
      if (key.startsWith(`${doc.id}\u0000`)) this.links.delete(key);
    }
    const targets = new Set(doc.linkTargets);
    for (const other of this.docs.values()) {
      if (other.id === doc.id) continue;
      if (targets.has(other.title)) this.links.add(`${doc.id}\u0000${other.id}`);
      if (other.linkTargets.includes(doc.title)) this.links.add(`${other.id}\u0000${doc.id}`);
    }
  }

  async applyChange(change: DocumentChange): Promise<void> {
    const touched = new Set<string>();
    this.docs.set(change.document.id, {
      ...structuredClone(change.document),
      linkTargets: [...change.linkTargets],
    });
    for (const id of change.removeChunkIds) {
      const c = this.chunks.get(id);
      if (!c) continue;
      this.touch(c.entities, touched);
      for (const e of c.entities) this.entityChunks.get(e)?.delete(id);
      this.chunks.delete(id);
    }
    for (const k of change.keepChunks) {
      const c = this.chunks.get(k.id);
      if (c) c.chunkIndex = k.chunkIndex;
    }
    for (const c of change.addChunks) {
      this.chunks.set(c.id, { ...structuredClone(c), documentId: change.document.id });
      this.touch(c.entities, touched);
      for (const e of c.entities) {
        if (!this.entityChunks.has(e)) this.entityChunks.set(e, new Set());
        this.entityChunks.get(e)!.add(c.id);
      }
    }
    this.recomputeEntities(touched);
    this.rebuildLinks(this.docs.get(change.document.id)!);
    this.bm25 = null;
  }

  async updateDocument(document: DocumentRecord): Promise<void> {
    const existing = this.docs.get(document.id);
    if (!existing) return;
    const titleChanged = existing.title !== document.title;
    this.docs.set(document.id, { ...structuredClone(document), linkTargets: existing.linkTargets });
    if (titleChanged) this.rebuildLinks(this.docs.get(document.id)!);
  }

  async documentIdsInCollection(collection: string): Promise<string[]> {
    return [...this.docs.values()].filter((d) => d.collection === collection).map((d) => d.id);
  }

  async planDelete(documentIds: string[]): Promise<DeletePlan> {
    const ids = documentIds.filter((id) => this.docs.has(id));
    const idSet = new Set(ids);
    const chunks = [...this.chunks.values()].filter((c) => idSet.has(c.documentId));
    const chunkIds = new Set(chunks.map((c) => c.id));
    const entities = new Set(chunks.flatMap((c) => c.entities));
    let orphans = 0;
    for (const e of entities) {
      const remaining = [...(this.entityChunks.get(e) ?? [])].filter((id) => !chunkIds.has(id));
      if (remaining.length === 0) orphans++;
    }
    const linksTo = [...this.links].filter((k) => {
      const [a, b] = k.split('\u0000') as [string, string];
      return idSet.has(a) || idSet.has(b);
    }).length;
    return {
      documentIds: ids,
      chunks: chunks.length,
      mentions: chunks.reduce((n, c) => n + new Set(c.entities).size, 0),
      orphanEntities: orphans,
      linksTo,
    };
  }

  async deleteDocuments(documentIds: string[]): Promise<DeletePlan> {
    const plan = await this.planDelete(documentIds);
    const idSet = new Set(plan.documentIds);
    const touched = new Set<string>();
    for (const c of [...this.chunks.values()]) {
      if (!idSet.has(c.documentId)) continue;
      this.touch(c.entities, touched);
      for (const e of c.entities) this.entityChunks.get(e)?.delete(c.id);
      this.chunks.delete(c.id);
    }
    for (const key of [...this.links]) {
      const [a, b] = key.split('\u0000') as [string, string];
      if (idSet.has(a) || idSet.has(b)) this.links.delete(key);
    }
    for (const id of idSet) this.docs.delete(id);
    this.recomputeEntities(touched);
    this.bm25 = null;
    return plan;
  }

  private inCollection(c: MemChunk, collection?: string) {
    return !collection || this.docs.get(c.documentId)?.collection === collection;
  }

  async vectorSearch(embedding: number[], k: number, collection?: string): Promise<SearchHit[]> {
    return [...this.chunks.values()]
      .filter((c) => this.inCollection(c, collection))
      .map((c) => ({ chunk: this.toRetrieved(c), score: dot(embedding, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  private bm25Index() {
    if (!this.bm25) {
      const df = new Map<string, number>();
      const lengths = new Map<string, number>();
      for (const c of this.chunks.values()) {
        const terms = contentTerms(c.text);
        lengths.set(c.id, terms.length);
        for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
      }
      const total = [...lengths.values()].reduce((a, b) => a + b, 0);
      this.bm25 = { df, lengths, avgLen: lengths.size ? total / lengths.size : 1 };
    }
    return this.bm25;
  }

  /** BM25 (k1 = 1.2, b = 0.75) over content terms. */
  async fulltextSearch(query: string, k: number, collection?: string): Promise<SearchHit[]> {
    const q = [...new Set(contentTerms(query))];
    if (q.length === 0) return [];
    const { df, lengths, avgLen } = this.bm25Index();
    const n = this.chunks.size;
    const hits: SearchHit[] = [];
    for (const c of this.chunks.values()) {
      if (!this.inCollection(c, collection)) continue;
      const terms = contentTerms(c.text);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        const len = lengths.get(c.id) ?? 0;
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * len) / avgLen));
      }
      if (score > 0) hits.push({ chunk: this.toRetrieved(c), score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  async getChunksByIds(ids: string[]): Promise<RetrievedChunk[]> {
    return ids.flatMap((id) => {
      const c = this.chunks.get(id);
      return c ? [this.toRetrieved(c)] : [];
    });
  }

  async expand(seedIds: string[], limits: ExpansionLimits): Promise<ExpansionHit[]> {
    const seeds = seedIds.map((id) => this.chunks.get(id)).filter((c): c is MemChunk => !!c);
    const seedSet = new Set(seedIds);
    const out: ExpansionHit[] = [];
    const ok = (c: MemChunk) => !seedSet.has(c.id) && this.inCollection(c, limits.collection);
    // NEXT neighbours (+/-1).
    for (const s of seeds) {
      for (const c of this.chunks.values()) {
        if (c.documentId === s.documentId && Math.abs(c.chunkIndex - s.chunkIndex) === 1 && ok(c)) {
          out.push({ chunk: this.toRetrieved(c), kind: 'next', fromChunkId: s.id, via: [] });
        }
      }
    }
    // Chunks sharing non-hub entities with the seeds.
    const shared = new Map<string, { from: string; via: Set<string> }>();
    for (const s of seeds) {
      for (const e of new Set(s.entities)) {
        const holders = this.entityChunks.get(e);
        if (!holders || holders.size > limits.hubDegreeThreshold) continue;
        for (const id of holders) {
          const c = this.chunks.get(id)!;
          if (!ok(c)) continue;
          const entry = shared.get(id) ?? { from: s.id, via: new Set<string>() };
          entry.via.add(e);
          shared.set(id, entry);
        }
      }
    }
    [...shared.entries()]
      .map(([id, v]) => ({ c: this.chunks.get(id)!, ...v }))
      .sort(
        (a, b) =>
          b.via.size - a.via.size ||
          dot(limits.queryEmbedding, b.c.embedding) - dot(limits.queryEmbedding, a.c.embedding),
      )
      .slice(0, limits.perKindLimit)
      .forEach((x) =>
        out.push({
          chunk: this.toRetrieved(x.c),
          kind: 'entity',
          fromChunkId: x.from,
          via: [...x.via],
        }),
      );
    // Chunks of documents linked from the seeds' documents, most similar to the query first.
    const linked: { c: MemChunk; from: string; title: string }[] = [];
    for (const s of seeds) {
      for (const key of this.links) {
        const [a, b] = key.split('\u0000') as [string, string];
        if (a !== s.documentId) continue;
        for (const c of this.chunks.values()) {
          if (c.documentId === b && ok(c))
            linked.push({ c, from: s.id, title: this.docs.get(b)!.title });
        }
      }
    }
    const seen = new Set<string>();
    linked
      .sort(
        (x, y) =>
          dot(limits.queryEmbedding, y.c.embedding) - dot(limits.queryEmbedding, x.c.embedding),
      )
      .filter((x) => (seen.has(x.c.id) ? false : (seen.add(x.c.id), true)))
      .slice(0, limits.perKindLimit)
      .forEach((x) =>
        out.push({
          chunk: this.toRetrieved(x.c),
          kind: 'link',
          fromChunkId: x.from,
          via: [x.title],
        }),
      );
    return out;
  }

  async entityDegrees(): Promise<number[]> {
    return [...this.entityChunks.values()].map((s) => s.size);
  }

  async counts(): Promise<GraphCounts> {
    const perDoc = new Map<string, number>();
    for (const c of this.chunks.values())
      perDoc.set(c.documentId, (perDoc.get(c.documentId) ?? 0) + 1);
    return {
      documents: this.docs.size,
      chunks: this.chunks.size,
      entities: this.entityChunks.size,
      hasChunk: this.chunks.size,
      next: [...perDoc.values()].reduce((n, k) => n + Math.max(0, k - 1), 0),
      mentions: [...this.chunks.values()].reduce((n, c) => n + new Set(c.entities).size, 0),
      linksTo: this.links.size,
      coOccurs: this.coOccurs.size,
      orphanEntities: [...this.entityChunks.values()].filter((s) => s.size === 0).length,
    };
  }

  /** CO_OCCURS weights (tests compare them with a recount). */
  coOccurrenceWeights(): Map<string, number> {
    return new Map(this.coOccurs);
  }

  async close(): Promise<void> {}
}
