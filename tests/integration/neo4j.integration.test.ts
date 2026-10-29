import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Neo4jStore } from '../../src/adapters/neo4j-store.js';
import { loadConfig } from '../../src/core/config.js';
import { NotFoundError } from '../../src/core/errors.js';
import { type RagInstance, createRag } from '../../src/index.js';
import { capitalizedEntities, recountCoOccurs } from '../helpers/fakes.js';

const COLLECTION = 'it-test';
const env = loadConfig().env;

// Invented names so the test entities never collide with the sports corpus.
const DOCS = {
  a: [
    '# Zorblax league',
    '## Founding',
    'The Zorblax league was founded by Quenneth Varro in the city of Plimwick. ' +
      'Early seasons were played on frozen lakes during the long winter months, and teams ' +
      'travelled between villages by sledge. Matches lasted until the light faded, which made ' +
      'scheduling difficult, so the founders agreed a fixed calendar of twelve rounds that is ' +
      'still used today. Attendance grew quickly once the railway reached Plimwick.',
    '## Champions',
    'Plimwick Comets won the first Zorblax title after Quenneth Varro scored twice in the final. ' +
      'The trophy is a carved silver kettle passed between champions every spring. Each winning ' +
      'club engraves its name on the base of the kettle, and the oldest engravings are now almost ' +
      'unreadable. The kettle has been lost twice, once in a flood and once on a night train, and ' +
      'both times it was returned by fans.',
  ].join('\n\n'),
  b: 'Quenneth Varro later coached the Drossel Hornets, who play in the Zorblax league at Drossel arena.',
  c: 'Tamsin Orrick set the Zorblax scoring record with the Drossel Hornets in her third season.',
};

describe.skipIf(!env.NEO4J_PASSWORD)('Neo4j integration (real database)', () => {
  let rag: RagInstance;
  let store: Neo4jStore;

  const ids = () => ['it-a', 'it-b', 'it-c'];
  const textSource = (key: keyof typeof DOCS, title: string, format = 'md') => ({
    text: DOCS[key],
    format,
    title,
  });

  beforeAll(async () => {
    rag = await createRag({
      llm: 'none',
      reranker: 'pass-through',
      intent: 'rules',
      entityExtractor: capitalizedEntities,
    });
    store = rag.store as Neo4jStore;
    await rag.documents.deleteCollection(COLLECTION, { confirm: true });
  });
  afterAll(async () => {
    await rag.documents.deleteCollection(COLLECTION, { confirm: true });
    await rag.close();
  });

  it('loads a 3-document sample and finds a known chunk through the vector index', async () => {
    await rag.documents.create({
      id: 'it-a',
      collection: COLLECTION,
      source: textSource('a', 'Zorblax league'),
    });
    await rag.documents.create({
      id: 'it-b',
      collection: COLLECTION,
      source: textSource('b', 'Drossel Hornets', 'txt'),
    });
    await rag.documents.create({
      id: 'it-c',
      collection: COLLECTION,
      source: textSource('c', 'Tamsin Orrick', 'txt'),
    });
    const q = await rag.embedder.embedQuery('What prize do the champions receive?');
    const hits = await store.vectorSearch(q, 3, COLLECTION);
    expect(hits[0]!.chunk.documentId).toBe('it-a');
    expect(hits[0]!.chunk.text).toContain('silver kettle');
    expect(hits.every((h) => h.chunk.collection === COLLECTION)).toBe(true);
    const ft = await store.fulltextSearch('silver kettle', 3, COLLECTION);
    expect(ft[0]!.chunk.text).toContain('silver kettle');
  });

  it('graph: NEXT chain, LINKS_TO only inside the store, CO_OCCURS equals a recount', async () => {
    const chunks = await rag.documents.chunks('it-a');
    expect(chunks.length).toBe(2);
    const expanded = await store.expand([chunks[0]!.id], {
      hubDegreeThreshold: 150,
      perKindLimit: 10,
      queryEmbedding: await rag.embedder.embedQuery('Zorblax'),
      collection: COLLECTION,
    });
    expect(expanded.some((h) => h.kind === 'next' && h.chunk.id === chunks[1]!.id)).toBe(true);
    expect(
      expanded.some(
        (h) => h.kind === 'entity' && h.chunk.documentId === 'it-b' && h.via.includes('Quenneth'),
      ),
    ).toBe(true);
    const recount = await recountCoOccurs(store, ids());
    const names = new Set([...recount.keys()].flatMap((k) => k.split('\u0000')));
    const stored = [...(await store.coOccurrenceWeights()).entries()].filter(([k]) =>
      k.split('\u0000').every((n) => names.has(n)),
    );
    expect(new Map(stored)).toEqual(recount);
  });

  it('a second identical ingestion embeds nothing and changes no counts', async () => {
    const before = await store.counts();
    const embedded = rag.documents.embeddedChunks;
    for (const [id, key, title, format] of [
      ['it-a', 'a', 'Zorblax league', 'md'],
      ['it-b', 'b', 'Drossel Hornets', 'txt'],
      ['it-c', 'c', 'Tamsin Orrick', 'txt'],
    ] as const) {
      const r = await rag.documents.upsert({
        id,
        collection: COLLECTION,
        source: textSource(key, title, format),
      });
      expect(r.result.status).toBe('unchanged');
    }
    expect(rag.documents.embeddedChunks).toBe(embedded);
    expect(await store.counts()).toEqual(before);
  });

  it('update with one changed paragraph re-embeds only that chunk; delete leaves no orphans', async () => {
    const embedded = rag.documents.embeddedChunks;
    const changed = DOCS.a.replace('carved silver kettle', 'golden Zorblax helmet');
    const result = await rag.documents.update('it-a', {
      source: { text: changed, format: 'md', title: 'Zorblax league' },
    });
    expect(result).toEqual({ status: 'reindexed', added: 1, removed: 1, kept: 1 });
    expect(rag.documents.embeddedChunks - embedded).toBe(1);

    const before = await store.counts();
    const dry = await rag.documents.delete('it-c');
    expect(dry.executed).toBe(false);
    expect(await store.counts()).toEqual(before);

    const done = await rag.documents.delete('it-c', { confirm: true });
    expect(done.executed).toBe(true);
    const after = await store.counts();
    expect(after.documents).toBe(before.documents - 1);
    expect(after.chunks).toBe(before.chunks - done.plan.chunks);
    expect(after.entities).toBe(before.entities - done.plan.orphanEntities);
    expect(after.orphanEntities).toBe(0);
    await expect(rag.documents.get('it-c')).resolves.toBeNull();
    await expect(rag.documents.delete('it-c', { confirm: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
