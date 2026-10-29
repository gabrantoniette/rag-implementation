import path from 'node:path';
import type { LoaderRegistry } from '../loaders/registry.js';
import type { LoaderContext } from '../loaders/types.js';
import { chunkDocument } from './chunker.js';
import type { Parameters } from './config.js';
import { ConflictError, ConfigError, NotFoundError } from './errors.js';
import { sha1 } from './hash.js';
import type { Logger } from './logger.js';
import type { Embedder, EntityExtractor } from './ports.js';
import type {
  ChunkWrite,
  DeletePlan,
  ListFilter,
  RetrievedChunk,
  VectorGraphStore,
} from './store.js';
import type { TokenCounter } from './tokens.js';
import type { DocumentRecord, MetadataValue, ParsedDocument } from './types.js';

export type DocumentSource =
  { path: string } | { url: string } | { text: string; format: string; title: string };

export interface CreateInput {
  source: DocumentSource;
  id?: string;
  title?: string;
  collection?: string;
  metadata?: Record<string, MetadataValue>;
}

export interface UpdateInput {
  source?: DocumentSource;
  title?: string;
  collection?: string;
  metadata?: Record<string, MetadataValue>;
}

export interface UpdateResult {
  status: 'unchanged' | 'metadata' | 'reindexed';
  added: number;
  removed: number;
  kept: number;
}

export interface DocumentView extends DocumentRecord {
  chunkCount: number;
  entityCount: number;
}

export interface DeleteResult {
  executed: boolean;
  plan: DeletePlan;
}

/** Resolves a URL source to a parsed document (Wikipedia articles, generic downloads). */
export type UrlResolver = (url: string, ctx: LoaderContext) => Promise<ParsedDocument>;

export interface DocumentServiceDeps {
  store: VectorGraphStore;
  embedder: Embedder;
  registry: LoaderRegistry;
  context: () => Promise<LoaderContext>;
  tokens: TokenCounter;
  parameters: Parameters;
  extractorFor: (format: string) => EntityExtractor;
  defaultCollection: string;
  logger: Logger;
  resolveUrl?: UrlResolver;
  now?: () => Date;
}

/** Chunk ids are stable for a given document, content hash and occurrence of that hash. */
export function chunkId(documentId: string, contentHash: string, occurrence: number): string {
  return sha1(`${documentId}|${contentHash}|${occurrence}`);
}

/**
 * CRUD for documents with incremental re-indexing. Writes to the same document are serialized
 * in-process (single-writer assumption: one process writes a given store at a time).
 */
export class DocumentService {
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Embedding calls made by this service (tests use it to prove unchanged updates embed nothing). */
  embeddedChunks = 0;

  constructor(private readonly deps: DocumentServiceDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  private async parse(source: DocumentSource, id: string | undefined, title?: string) {
    const ctx = await this.deps.context();
    if ('path' in source) {
      return this.deps.registry.loadFile(path.resolve(source.path), ctx, title ? { title } : {});
    }
    if ('url' in source) {
      if (!this.deps.resolveUrl) throw new ConfigError('URL sources are not configured');
      const doc = await this.deps.resolveUrl(source.url, ctx);
      return title ? { ...doc, title } : doc;
    }
    if (!id) throw new ConfigError('Text sources require an explicit id');
    return this.deps.registry.loadText(
      source.text,
      source.format,
      title ?? source.title,
      `text://${id}`,
      ctx,
    );
  }

  /** Chunks the parsed document, keeps chunks whose hash already exists, embeds only new ones. */
  private async plan(doc: ParsedDocument, documentId: string, existing: RetrievedChunk[]) {
    const drafts = chunkDocument(doc, this.deps.tokens, this.deps.parameters.chunking);
    const available = new Map<string, string[]>();
    for (const c of existing) {
      if (!available.has(c.contentHash)) available.set(c.contentHash, []);
      available.get(c.contentHash)!.push(c.id);
    }
    const seen = new Map<string, number>();
    const keep: { id: string; chunkIndex: number }[] = [];
    const fresh: { draft: (typeof drafts)[number]; id: string }[] = [];
    for (const draft of drafts) {
      const occurrence = seen.get(draft.contentHash) ?? 0;
      seen.set(draft.contentHash, occurrence + 1);
      const reuse = available.get(draft.contentHash)?.shift();
      if (reuse) keep.push({ id: reuse, chunkIndex: draft.chunkIndex });
      else fresh.push({ draft, id: chunkId(documentId, draft.contentHash, occurrence) });
    }
    const keptIds = new Set(keep.map((k) => k.id));
    const remove = existing.filter((c) => !keptIds.has(c.id)).map((c) => c.id);
    const vectors = fresh.length
      ? await this.deps.embedder.embedPassages(fresh.map((f) => f.draft.text))
      : [];
    this.embeddedChunks += fresh.length;
    const extractor = this.deps.extractorFor(doc.format);
    const add: ChunkWrite[] = [];
    for (const [i, f] of fresh.entries()) {
      const entities = await extractor.extract({ text: f.draft.text, sections: doc.sections });
      add.push({
        id: f.id,
        chunkIndex: f.draft.chunkIndex,
        text: f.draft.text,
        section: f.draft.section,
        locator: f.draft.locator,
        modality: f.draft.modality,
        tokenCount: f.draft.tokenCount,
        contentHash: f.draft.contentHash,
        embedding: vectors[i]!,
        entities,
        warnings: f.draft.warnings,
      });
    }
    return { add, keep, remove };
  }

  private record(
    doc: ParsedDocument,
    id: string,
    input: CreateInput | UpdateInput,
    base?: DocumentRecord,
  ) {
    const now = this.now();
    const revid = doc.metadata.revid;
    const license = doc.metadata.license;
    return {
      id,
      collection: input.collection ?? base?.collection ?? this.deps.defaultCollection,
      title: input.title ?? doc.title,
      uri: doc.uri,
      format: doc.format,
      contentHash: doc.contentHash,
      version: (base?.version ?? 0) + 1,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
      ...(typeof revid === 'number' ? { revid } : {}),
      ...(typeof license === 'string' ? { license } : {}),
      metadata: { ...doc.metadata, ...(base?.metadata ?? {}), ...(input.metadata ?? {}) },
    } satisfies DocumentRecord;
  }

  async create(input: CreateInput): Promise<DocumentView> {
    return this.createParsed(await this.parse(input.source, input.id, input.title), input);
  }

  private createParsed(parsed: ParsedDocument, input: CreateInput): Promise<DocumentView> {
    const id = input.id ?? parsed.id;
    return this.withLock(id, async () => {
      if (await this.deps.store.getDocument(id)) throw new ConflictError(id);
      const { add } = await this.plan(parsed, id, []);
      await this.deps.store.applyChange({
        document: this.record(parsed, id, input),
        addChunks: add,
        keepChunks: [],
        removeChunkIds: [],
        linkTargets: parsed.links,
      });
      this.deps.logger.info(`created ${id} (${add.length} chunks)`);
      return (await this.get(id))!;
    });
  }

  async get(id: string): Promise<DocumentView | null> {
    const doc = await this.deps.store.getDocument(id);
    if (!doc) return null;
    return { ...doc, ...(await this.deps.store.documentStats(id)) };
  }

  list(filter: Partial<ListFilter> = {}): Promise<DocumentRecord[]> {
    return this.deps.store.listDocuments({ limit: 50, offset: 0, ...filter });
  }

  async chunks(id: string): Promise<RetrievedChunk[]> {
    if (!(await this.deps.store.getDocument(id))) throw new NotFoundError(id);
    return this.deps.store.getChunks(id);
  }

  async update(id: string, input: UpdateInput): Promise<UpdateResult> {
    const parsed = input.source ? await this.parse(input.source, id, input.title) : null;
    return this.updateParsed(id, parsed, input);
  }

  private updateParsed(
    id: string,
    parsed: ParsedDocument | null,
    input: UpdateInput,
  ): Promise<UpdateResult> {
    return this.withLock(id, async () => {
      const existing = await this.deps.store.getDocument(id);
      if (!existing) throw new NotFoundError(id);
      const metadataChanged =
        (input.title !== undefined && input.title !== existing.title) ||
        (input.collection !== undefined && input.collection !== existing.collection) ||
        (input.metadata !== undefined &&
          JSON.stringify({ ...existing.metadata, ...input.metadata }) !==
            JSON.stringify(existing.metadata));
      const chunkCount = (await this.deps.store.documentStats(id)).chunkCount;
      if (!parsed || parsed.contentHash === existing.contentHash) {
        if (!metadataChanged)
          return { status: 'unchanged', added: 0, removed: 0, kept: chunkCount };
        // Metadata-only updates never re-embed. Stored chunk headers keep the title they were
        // indexed with until the content itself changes.
        await this.deps.store.updateDocument({
          ...existing,
          title: input.title ?? existing.title,
          collection: input.collection ?? existing.collection,
          metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
          version: existing.version + 1,
          updatedAt: this.now(),
        });
        return { status: 'metadata', added: 0, removed: 0, kept: chunkCount };
      }
      const current = await this.deps.store.getChunks(id);
      const { add, keep, remove } = await this.plan(parsed, id, current);
      await this.deps.store.applyChange({
        document: this.record(parsed, id, input, existing),
        addChunks: add,
        keepChunks: keep,
        removeChunkIds: remove,
        linkTargets: parsed.links,
      });
      this.deps.logger.info(`updated ${id}: +${add.length} -${remove.length} =${keep.length}`);
      return { status: 'reindexed', added: add.length, removed: remove.length, kept: keep.length };
    });
  }

  /** Create or update by id; ingestion uses it so repeated runs are idempotent. The source is parsed once. */
  async upsert(input: CreateInput): Promise<{ created: boolean; result: UpdateResult }> {
    const parsed = await this.parse(input.source, input.id, input.title);
    const id = input.id ?? parsed.id;
    if (!(await this.deps.store.getDocument(id))) {
      const view = await this.createParsed(parsed, { ...input, id });
      return {
        created: true,
        result: { status: 'reindexed', added: view.chunkCount, removed: 0, kept: 0 },
      };
    }
    return { created: false, result: await this.updateParsed(id, parsed, input) };
  }

  /** Without confirm: true nothing is deleted; the plan says what would be. */
  async delete(id: string, options: { confirm?: boolean } = {}): Promise<DeleteResult> {
    return this.withLock(id, async () => {
      if (!(await this.deps.store.getDocument(id))) throw new NotFoundError(id);
      if (!options.confirm)
        return { executed: false, plan: await this.deps.store.planDelete([id]) };
      return { executed: true, plan: await this.deps.store.deleteDocuments([id]) };
    });
  }

  async deleteCollection(name: string, options: { confirm?: boolean } = {}): Promise<DeleteResult> {
    const ids = await this.deps.store.documentIdsInCollection(name);
    if (!options.confirm) return { executed: false, plan: await this.deps.store.planDelete(ids) };
    return { executed: true, plan: await this.deps.store.deleteDocuments(ids) };
  }
}
