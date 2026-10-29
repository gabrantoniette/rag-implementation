import neo4j, { type Driver, type ManagedTransaction } from 'neo4j-driver';
import type {
  DeletePlan,
  DocumentChange,
  ExpansionHit,
  ExpansionKind,
  ExpansionLimits,
  GraphCounts,
  ListFilter,
  RetrievedChunk,
  SearchHit,
  VectorGraphStore,
} from '../core/store.js';
import { contentTerms } from '../core/text.js';
import type { DocumentRecord, Locator, MetadataValue } from '../core/types.js';

export const VECTOR_INDEX = 'chunk_embedding';
export const FULLTEXT_INDEX = 'chunk_text';

export interface Neo4jOptions {
  uri: string;
  user: string;
  password: string;
  database?: string;
  /** Vector and fulltext queries over-fetch by this factor before the collection filter. */
  overFetch?: number;
}

/** Projection shared by every query that returns chunks. */
const CHUNK = `{
  id: c.id, documentId: d.id, documentTitle: d.title, documentUri: d.uri,
  documentFormat: d.format, collection: d.collection, chunkIndex: c.chunkIndex, text: c.text,
  section: c.section, locator: c.locator, modality: c.modality, tokenCount: c.tokenCount,
  contentHash: c.contentHash, embedding: c.embedding,
  entities: [(c)-[:MENTIONS]->(e:Entity) | e.name]
}`;

/** Locator fields stored as plain properties too (graph model), besides the JSON string. */
function locatorProps(l: Locator): Record<string, unknown> {
  switch (l.kind) {
    case 'page':
      return { page: l.page };
    case 'rows':
      return { rowStart: l.start, rowEnd: l.end, sheet: l.sheet ?? null };
    case 'records':
      return { rowStart: l.start, rowEnd: l.end };
    case 'time':
      return { startSec: l.startSec, endSec: l.endSec };
    case 'slide':
      return { slide: l.slide };
    default:
      return {};
  }
}

interface RawChunk extends Omit<RetrievedChunk, 'locator'> {
  locator: string;
}

const toChunk = (raw: RawChunk): RetrievedChunk => ({
  ...raw,
  locator: JSON.parse(raw.locator) as Locator,
  embedding: raw.embedding ?? [],
  entities: raw.entities ?? [],
});

interface RawDoc extends Omit<DocumentRecord, 'metadata'> {
  metadataJson: string;
  revid?: number;
  license?: string;
}

const toDocument = (raw: RawDoc): DocumentRecord => {
  const { metadataJson, ...rest } = raw;
  const doc: DocumentRecord = {
    ...rest,
    metadata: JSON.parse(metadataJson ?? '{}') as Record<string, MetadataValue>,
  };
  if (doc.revid === null || doc.revid === undefined) delete doc.revid;
  if (doc.license === null || doc.license === undefined) delete doc.license;
  return doc;
};

const DOC = `{ id: d.id, collection: d.collection, title: d.title, uri: d.uri, format: d.format,
  contentHash: d.contentHash, version: d.version, createdAt: d.createdAt, updatedAt: d.updatedAt,
  license: d.license, revid: d.revid, metadataJson: d.metadataJson }`;

/**
 * Neo4j as vector index plus knowledge graph:
 * (:Document)-[:HAS_CHUNK]->(:Chunk), (:Chunk)-[:NEXT]->(:Chunk), (:Chunk)-[:MENTIONS]->(:Entity),
 * (:Document)-[:LINKS_TO]->(:Document), (:Entity)-[:CO_OCCURS {weight}]->(:Entity).
 * Neo4j community has one database, so collections are a Document property; vector and fulltext
 * queries over-fetch and filter by collection afterwards.
 */
export class Neo4jStore implements VectorGraphStore {
  private readonly driver: Driver;
  private readonly database: string | undefined;
  private readonly overFetch: number;

  constructor(options: Neo4jOptions) {
    this.driver = neo4j.driver(options.uri, neo4j.auth.basic(options.user, options.password), {
      disableLosslessIntegers: true,
    });
    this.database = options.database;
    this.overFetch = options.overFetch ?? 3;
  }

  private async read<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const { records } = await this.driver.executeQuery(query, params, {
      database: this.database,
      routing: neo4j.routing.READ,
    });
    return records.map((r) => r.toObject() as T);
  }

  private async write<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database });
    try {
      return await session.executeWrite(fn);
    } finally {
      await session.close();
    }
  }

  async init(dimensions: number): Promise<void> {
    await this.driver.verifyConnectivity();
    const statements = [
      'CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE',
      'CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE',
      'CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE',
      'CREATE INDEX document_collection IF NOT EXISTS FOR (d:Document) ON (d.collection)',
      'CREATE INDEX document_title IF NOT EXISTS FOR (d:Document) ON (d.title)',
      `CREATE VECTOR INDEX ${VECTOR_INDEX} IF NOT EXISTS FOR (c:Chunk) ON c.embedding
       OPTIONS { indexConfig: { \`vector.dimensions\`: $dimensions, \`vector.similarity_function\`: 'cosine' } }`,
      `CREATE FULLTEXT INDEX ${FULLTEXT_INDEX} IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]`,
    ];
    for (const statement of statements) {
      await this.driver.executeQuery(
        statement,
        { dimensions: neo4j.int(dimensions) },
        { database: this.database },
      );
    }
    await this.driver.executeQuery('CALL db.awaitIndexes(300)', {}, { database: this.database });
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const rows = await this.read<{ doc: RawDoc }>(
      `MATCH (d:Document {id: $id}) RETURN ${DOC} AS doc`,
      { id },
    );
    return rows[0] ? toDocument(rows[0].doc) : null;
  }

  async documentStats(id: string) {
    const rows = await this.read<{ chunkCount: number; entityCount: number }>(
      `MATCH (d:Document {id: $id})
       RETURN COUNT { (d)-[:HAS_CHUNK]->() } AS chunkCount,
              COUNT { MATCH (d)-[:HAS_CHUNK]->()-[:MENTIONS]->(e:Entity) RETURN DISTINCT e } AS entityCount`,
      { id },
    );
    return rows[0] ?? { chunkCount: 0, entityCount: 0 };
  }

  async listDocuments(filter: ListFilter): Promise<DocumentRecord[]> {
    const rows = await this.read<{ doc: RawDoc }>(
      `MATCH (d:Document)
       WHERE ($collection IS NULL OR d.collection = $collection)
         AND ($format IS NULL OR d.format = $format)
         AND ($title IS NULL OR toLower(d.title) CONTAINS toLower($title))
       RETURN ${DOC} AS doc ORDER BY d.updatedAt DESC, d.id SKIP $offset LIMIT $limit`,
      {
        collection: filter.collection ?? null,
        format: filter.format ?? null,
        title: filter.titleContains ?? null,
        offset: neo4j.int(filter.offset),
        limit: neo4j.int(filter.limit),
      },
    );
    return rows.map((r) => toDocument(r.doc));
  }

  async getChunks(documentId: string): Promise<RetrievedChunk[]> {
    const rows = await this.read<{ chunk: RawChunk }>(
      `MATCH (d:Document {id: $id})-[:HAS_CHUNK]->(c:Chunk)
       RETURN ${CHUNK} AS chunk ORDER BY c.chunkIndex`,
      { id: documentId },
    );
    return rows.map((r) => ({ ...toChunk(r.chunk), embedding: [] }));
  }

  /** CO_OCCURS, degree and orphan cleanup for the entities a write touched. */
  private async refreshEntities(tx: ManagedTransaction, touched: string[]): Promise<void> {
    if (touched.length === 0) return;
    await tx.run(`UNWIND $names AS name MATCH (e:Entity {name: name})-[r:CO_OCCURS]-() DELETE r`, {
      names: touched,
    });
    await tx.run(
      `UNWIND $names AS name MATCH (e:Entity {name: name}) WHERE NOT (e)<-[:MENTIONS]-() DETACH DELETE e`,
      { names: touched },
    );
    await tx.run(
      `UNWIND $names AS name MATCH (e:Entity {name: name})
       SET e.degree = COUNT { (e)<-[:MENTIONS]-(:Chunk) }`,
      { names: touched },
    );
    await tx.run(
      `UNWIND $names AS name
       MATCH (e:Entity {name: name})<-[:MENTIONS]-(c:Chunk)-[:MENTIONS]->(f:Entity)
       WHERE f <> e
       WITH e, f, count(DISTINCT c) AS w
       WITH CASE WHEN e.name < f.name THEN e ELSE f END AS a,
            CASE WHEN e.name < f.name THEN f ELSE e END AS b, w
       MERGE (a)-[r:CO_OCCURS]->(b) SET r.weight = w`,
      { names: touched },
    );
  }

  private async touchedBy(tx: ManagedTransaction, chunkIds: string[]): Promise<string[]> {
    if (chunkIds.length === 0) return [];
    const result = await tx.run(
      `MATCH (c:Chunk)-[:MENTIONS]->(e:Entity) WHERE c.id IN $ids RETURN collect(DISTINCT e.name) AS names`,
      { ids: chunkIds },
    );
    return (result.records[0]?.get('names') as string[]) ?? [];
  }

  async applyChange(change: DocumentChange): Promise<void> {
    const d = change.document;
    await this.write(async (tx) => {
      await tx.run(
        `MERGE (d:Document {id: $id})
         SET d.collection = $collection, d.title = $title, d.uri = $uri, d.format = $format,
             d.contentHash = $contentHash, d.version = toInteger($version), d.createdAt = $createdAt,
             d.updatedAt = $updatedAt, d.license = $license,
             d.revid = CASE WHEN $revid IS NULL THEN null ELSE toInteger($revid) END,
             d.metadataJson = $metadataJson, d.linkTargets = $linkTargets`,
        {
          id: d.id,
          collection: d.collection,
          title: d.title,
          uri: d.uri,
          format: d.format,
          contentHash: d.contentHash,
          version: d.version,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          license: d.license ?? null,
          revid: d.revid ?? null,
          metadataJson: JSON.stringify(d.metadata),
          linkTargets: change.linkTargets,
        },
      );
      const touched = new Set(await this.touchedBy(tx, change.removeChunkIds));
      if (change.removeChunkIds.length > 0) {
        await tx.run('MATCH (c:Chunk) WHERE c.id IN $ids DETACH DELETE c', {
          ids: change.removeChunkIds,
        });
      }
      if (change.keepChunks.length > 0) {
        await tx.run(
          'UNWIND $keep AS k MATCH (c:Chunk {id: k.id}) SET c.chunkIndex = toInteger(k.chunkIndex)',
          { keep: change.keepChunks },
        );
      }
      for (let i = 0; i < change.addChunks.length; i += 100) {
        const batch = change.addChunks.slice(i, i + 100).map((c) => ({
          id: c.id,
          embedding: c.embedding,
          props: {
            text: c.text,
            section: c.section,
            locator: JSON.stringify(c.locator),
            modality: c.modality,
            contentHash: c.contentHash,
            warnings: c.warnings,
            sheet: null,
            ...locatorProps(c.locator),
          },
          ints: { chunkIndex: c.chunkIndex, tokenCount: c.tokenCount },
          entities: [...new Set(c.entities)],
        }));
        await tx.run(
          `MATCH (d:Document {id: $docId})
           UNWIND $batch AS a
           CREATE (c:Chunk {id: a.id})
           SET c += a.props, c.embedding = a.embedding,
               c.chunkIndex = toInteger(a.ints.chunkIndex), c.tokenCount = toInteger(a.ints.tokenCount)
           CREATE (d)-[:HAS_CHUNK]->(c)
           WITH c, a UNWIND a.entities AS name
           MERGE (e:Entity {name: name})
           MERGE (c)-[:MENTIONS]->(e)`,
          { docId: d.id, batch },
        );
        for (const c of batch) c.entities.forEach((e) => touched.add(e));
      }
      // NEXT chain rebuilt in chunkIndex order.
      await tx.run('MATCH (:Document {id: $id})-[:HAS_CHUNK]->(:Chunk)-[r:NEXT]->() DELETE r', {
        id: d.id,
      });
      await tx.run(
        `MATCH (:Document {id: $id})-[:HAS_CHUNK]->(c:Chunk)
         WITH c ORDER BY c.chunkIndex WITH collect(c) AS cs
         UNWIND range(0, size(cs) - 2) AS i
         WITH cs[i] AS a, cs[i + 1] AS b CREATE (a)-[:NEXT]->(b)`,
        { id: d.id },
      );
      // LINKS_TO in both directions, only between documents in the store.
      await tx.run('MATCH (:Document {id: $id})-[r:LINKS_TO]-() DELETE r', { id: d.id });
      await tx.run(
        `MATCH (d:Document {id: $id})
         MATCH (t:Document) WHERE t.id <> d.id AND t.title IN d.linkTargets
         MERGE (d)-[:LINKS_TO]->(t)`,
        { id: d.id },
      );
      await tx.run(
        `MATCH (d:Document {id: $id})
         MATCH (s:Document) WHERE s.id <> d.id AND d.title IN s.linkTargets
         MERGE (s)-[:LINKS_TO]->(d)`,
        { id: d.id },
      );
      await this.refreshEntities(tx, [...touched]);
    });
  }

  async updateDocument(document: DocumentRecord): Promise<void> {
    await this.write(async (tx) => {
      await tx.run(
        `MATCH (d:Document {id: $id})
         SET d.title = $title, d.collection = $collection, d.metadataJson = $metadataJson,
             d.version = toInteger($version), d.updatedAt = $updatedAt`,
        {
          id: document.id,
          title: document.title,
          collection: document.collection,
          metadataJson: JSON.stringify(document.metadata),
          version: document.version,
          updatedAt: document.updatedAt,
        },
      );
      await tx.run(
        `MATCH (d:Document {id: $id}) MATCH (s:Document) WHERE s.id <> d.id AND d.title IN s.linkTargets
         MERGE (s)-[:LINKS_TO]->(d)`,
        { id: document.id },
      );
    });
  }

  async documentIdsInCollection(collection: string): Promise<string[]> {
    const rows = await this.read<{ id: string }>(
      'MATCH (d:Document {collection: $collection}) RETURN d.id AS id ORDER BY id',
      { collection },
    );
    return rows.map((r) => r.id);
  }

  async planDelete(documentIds: string[]): Promise<DeletePlan> {
    const rows = await this.read<Omit<DeletePlan, 'documentIds'> & { ids: string[] }>(
      `MATCH (d:Document) WHERE d.id IN $ids
       WITH collect(d) AS docs, collect(d.id) AS ids
       RETURN ids,
         COUNT { MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk) WHERE d.id IN ids RETURN c } AS chunks,
         COUNT { MATCH (d:Document)-[:HAS_CHUNK]->(:Chunk)-[m:MENTIONS]->() WHERE d.id IN ids RETURN m } AS mentions,
         COUNT { MATCH (d:Document)-[:HAS_CHUNK]->(:Chunk)-[:MENTIONS]->(e:Entity) WHERE d.id IN ids
                 WITH DISTINCT e
                 WHERE NOT EXISTS { MATCH (e)<-[:MENTIONS]-(:Chunk)<-[:HAS_CHUNK]-(o:Document) WHERE NOT o.id IN ids }
                 RETURN e } AS orphanEntities,
         COUNT { MATCH (a:Document)-[r:LINKS_TO]-(:Document) WHERE a.id IN ids RETURN DISTINCT r } AS linksTo`,
      { ids: documentIds },
    );
    const r = rows[0];
    return {
      documentIds: r?.ids ?? [],
      chunks: r?.chunks ?? 0,
      mentions: r?.mentions ?? 0,
      orphanEntities: r?.orphanEntities ?? 0,
      linksTo: r?.linksTo ?? 0,
    };
  }

  async deleteDocuments(documentIds: string[]): Promise<DeletePlan> {
    const plan = await this.planDelete(documentIds);
    if (plan.documentIds.length === 0) return plan;
    await this.write(async (tx) => {
      const ids = await tx.run(
        'MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk) WHERE d.id IN $ids RETURN collect(c.id) AS ids',
        { ids: plan.documentIds },
      );
      const chunkIds = (ids.records[0]?.get('ids') as string[]) ?? [];
      const touched = await this.touchedBy(tx, chunkIds);
      await tx.run('MATCH (c:Chunk) WHERE c.id IN $ids DETACH DELETE c', { ids: chunkIds });
      await tx.run('MATCH (d:Document) WHERE d.id IN $ids DETACH DELETE d', {
        ids: plan.documentIds,
      });
      await this.refreshEntities(tx, touched);
    });
    return plan;
  }

  async vectorSearch(embedding: number[], k: number, collection?: string): Promise<SearchHit[]> {
    const rows = await this.read<{ chunk: RawChunk; score: number }>(
      `CALL db.index.vector.queryNodes($index, $fetch, $embedding) YIELD node AS c, score
       MATCH (d:Document)-[:HAS_CHUNK]->(c)
       WHERE $collection IS NULL OR d.collection = $collection
       RETURN ${CHUNK} AS chunk, score ORDER BY score DESC LIMIT $k`,
      {
        index: VECTOR_INDEX,
        fetch: neo4j.int(collection ? k * this.overFetch : k),
        embedding,
        collection: collection ?? null,
        k: neo4j.int(k),
      },
    );
    return rows.map((r) => ({ chunk: toChunk(r.chunk), score: r.score }));
  }

  /** Lucene query of the question's content terms (no special characters reach Lucene). */
  async fulltextSearch(query: string, k: number, collection?: string): Promise<SearchHit[]> {
    const terms = [...new Set(contentTerms(query))];
    if (terms.length === 0) return [];
    const rows = await this.read<{ chunk: RawChunk; score: number }>(
      `CALL db.index.fulltext.queryNodes($index, $q, {limit: $fetch}) YIELD node AS c, score
       MATCH (d:Document)-[:HAS_CHUNK]->(c)
       WHERE $collection IS NULL OR d.collection = $collection
       RETURN ${CHUNK} AS chunk, score ORDER BY score DESC LIMIT $k`,
      {
        index: FULLTEXT_INDEX,
        q: terms.join(' '),
        fetch: neo4j.int(collection ? k * this.overFetch : k),
        collection: collection ?? null,
        k: neo4j.int(k),
      },
    );
    return rows.map((r) => ({ chunk: toChunk(r.chunk), score: r.score }));
  }

  async getChunksByIds(ids: string[]): Promise<RetrievedChunk[]> {
    const rows = await this.read<{ chunk: RawChunk }>(
      `UNWIND $ids AS id MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk {id: id}) RETURN ${CHUNK} AS chunk`,
      { ids },
    );
    return rows.map((r) => toChunk(r.chunk));
  }

  async expand(seedIds: string[], limits: ExpansionLimits): Promise<ExpansionHit[]> {
    if (seedIds.length === 0) return [];
    const params = {
      ids: seedIds,
      collection: limits.collection ?? null,
      hub: neo4j.int(limits.hubDegreeThreshold),
      limit: neo4j.int(limits.perKindLimit),
      q: limits.queryEmbedding,
    };
    const queries: [ExpansionKind, string][] = [
      [
        'next',
        `MATCH (s:Chunk)-[:NEXT]-(c:Chunk) WHERE s.id IN $ids AND NOT c.id IN $ids
         MATCH (d:Document)-[:HAS_CHUNK]->(c)
         WHERE $collection IS NULL OR d.collection = $collection
         RETURN DISTINCT ${CHUNK} AS chunk, s.id AS fromChunkId, [] AS via`,
      ],
      [
        'entity',
        `MATCH (s:Chunk)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(c:Chunk)
         WHERE s.id IN $ids AND NOT c.id IN $ids AND e.degree <= $hub
         MATCH (d:Document)-[:HAS_CHUNK]->(c)
         WHERE $collection IS NULL OR d.collection = $collection
         WITH c, d, collect(DISTINCT e.name) AS via, head(collect(s.id)) AS fromChunkId
         WITH c, d, via, fromChunkId, vector.similarity.cosine(c.embedding, $q) AS sim
         ORDER BY size(via) DESC, sim DESC LIMIT $limit
         RETURN ${CHUNK} AS chunk, fromChunkId, via`,
      ],
      [
        'link',
        `MATCH (s:Chunk)<-[:HAS_CHUNK]-(:Document)-[:LINKS_TO]->(d:Document)-[:HAS_CHUNK]->(c:Chunk)
         WHERE s.id IN $ids AND NOT c.id IN $ids
           AND ($collection IS NULL OR d.collection = $collection)
         WITH c, d, head(collect(s.id)) AS fromChunkId
         WITH c, d, fromChunkId, vector.similarity.cosine(c.embedding, $q) AS sim
         ORDER BY sim DESC LIMIT $limit
         RETURN ${CHUNK} AS chunk, fromChunkId, [d.title] AS via`,
      ],
    ];
    const out: ExpansionHit[] = [];
    for (const [kind, query] of queries) {
      const rows = await this.read<{ chunk: RawChunk; fromChunkId: string; via: string[] }>(
        query,
        params,
      );
      for (const r of rows)
        out.push({ chunk: toChunk(r.chunk), kind, fromChunkId: r.fromChunkId, via: r.via });
    }
    return out;
  }

  async entityDegrees(): Promise<number[]> {
    const rows = await this.read<{ degree: number }>(
      'MATCH (e:Entity) RETURN COUNT { (e)<-[:MENTIONS]-(:Chunk) } AS degree',
    );
    return rows.map((r) => r.degree);
  }

  async counts(): Promise<GraphCounts> {
    const rows = await this.read<GraphCounts>(
      `RETURN COUNT { (:Document) } AS documents, COUNT { (:Chunk) } AS chunks,
              COUNT { (:Entity) } AS entities, COUNT { ()-[:HAS_CHUNK]->() } AS hasChunk,
              COUNT { ()-[:NEXT]->() } AS next, COUNT { ()-[:MENTIONS]->() } AS mentions,
              COUNT { ()-[:LINKS_TO]->() } AS linksTo, COUNT { ()-[:CO_OCCURS]->() } AS coOccurs,
              COUNT { (e:Entity) WHERE NOT (e)<-[:MENTIONS]-() } AS orphanEntities`,
    );
    return rows[0]!;
  }

  /** CO_OCCURS weights keyed like InMemoryStore (a < b), for the recount check. */
  async coOccurrenceWeights(): Promise<Map<string, number>> {
    const rows = await this.read<{ a: string; b: string; w: number }>(
      'MATCH (a:Entity)-[r:CO_OCCURS]->(b:Entity) RETURN a.name AS a, b.name AS b, r.weight AS w',
    );
    return new Map(rows.map((r) => [`${r.a}\u0000${r.b}`, r.w]));
  }

  /** Removes every node and relationship (integration tests only). */
  async wipe(): Promise<void> {
    await this.driver
      .executeQuery(
        'MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS',
        {},
        {
          database: this.database,
        },
      )
      .catch(async () => {
        await this.driver.executeQuery(
          'MATCH (n) DETACH DELETE n',
          {},
          { database: this.database },
        );
      });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
