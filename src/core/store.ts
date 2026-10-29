import type { DocumentRecord, Locator, Modality } from './types.js';

/** A chunk ready to be written: embedded, with the entities it mentions. */
export interface ChunkWrite {
  id: string;
  chunkIndex: number;
  text: string;
  section: string;
  locator: Locator;
  modality: Modality;
  tokenCount: number;
  contentHash: string;
  embedding: number[];
  entities: string[];
  warnings: string[];
}

/**
 * Everything one create/update does to one document, applied atomically by the store:
 * upsert the Document, delete removed chunks, add new chunks, renumber kept chunks, rebuild the
 * NEXT chain, write MENTIONS for new chunks, rebuild LINKS_TO in both directions, recompute
 * CO_OCCURS and degree for every touched entity and delete entities nothing mentions any more.
 */
export interface DocumentChange {
  document: DocumentRecord;
  addChunks: ChunkWrite[];
  keepChunks: { id: string; chunkIndex: number }[];
  removeChunkIds: string[];
  /** Outgoing link targets (article titles); LINKS_TO is created only for titles in the store. */
  linkTargets: string[];
}

/** A chunk as returned by retrieval queries, with its document context. */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  documentUri: string;
  documentFormat: string;
  collection: string;
  chunkIndex: number;
  text: string;
  section: string;
  locator: Locator;
  modality: Modality;
  tokenCount: number;
  contentHash: string;
  embedding: number[];
  entities: string[];
}

export interface SearchHit {
  chunk: RetrievedChunk;
  score: number;
}

export type ExpansionKind = 'next' | 'entity' | 'link';

export interface ExpansionHit {
  chunk: RetrievedChunk;
  kind: ExpansionKind;
  /** The seed chunk this one was reached from. */
  fromChunkId: string;
  /** Shared entity names (entity), or the linked document title (link). */
  via: string[];
}

export interface ListFilter {
  collection?: string;
  format?: string;
  titleContains?: string;
  limit: number;
  offset: number;
}

export interface GraphCounts {
  documents: number;
  chunks: number;
  entities: number;
  hasChunk: number;
  next: number;
  mentions: number;
  linksTo: number;
  coOccurs: number;
  orphanEntities: number;
}

export interface DeletePlan {
  documentIds: string[];
  chunks: number;
  mentions: number;
  /** Entities that no remaining chunk would mention (deleted with the documents). */
  orphanEntities: number;
  linksTo: number;
}

export interface ExpansionLimits {
  hubDegreeThreshold: number;
  perKindLimit: number;
  collection?: string;
  queryEmbedding: number[];
}

/** Vector index plus knowledge graph. Neo4jStore and InMemoryStore implement it. */
export interface VectorGraphStore {
  init(dimensions: number): Promise<void>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  documentStats(id: string): Promise<{ chunkCount: number; entityCount: number }>;
  listDocuments(filter: ListFilter): Promise<DocumentRecord[]>;
  /** Chunks of one document ordered by chunkIndex (embeddings omitted). */
  getChunks(documentId: string): Promise<RetrievedChunk[]>;
  applyChange(change: DocumentChange): Promise<void>;
  updateDocument(document: DocumentRecord): Promise<void>;
  documentIdsInCollection(collection: string): Promise<string[]>;
  planDelete(documentIds: string[]): Promise<DeletePlan>;
  deleteDocuments(documentIds: string[]): Promise<DeletePlan>;

  vectorSearch(embedding: number[], k: number, collection?: string): Promise<SearchHit[]>;
  fulltextSearch(query: string, k: number, collection?: string): Promise<SearchHit[]>;
  getChunksByIds(ids: string[]): Promise<RetrievedChunk[]>;
  expand(seedChunkIds: string[], limits: ExpansionLimits): Promise<ExpansionHit[]>;
  /** Number of chunks mentioning each entity (degree), for the hub threshold. */
  entityDegrees(): Promise<number[]>;
  counts(): Promise<GraphCounts>;
  close(): Promise<void>;
}
