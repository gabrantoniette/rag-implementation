import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../../src/adapters/memory-store.js';
import { ConflictError, NotFoundError } from '../../src/core/errors.js';
import { HashEmbedder, makeService, recountCoOccurs } from '../helpers/fakes.js';

const para = (topic: string, n = 70) =>
  `${topic} ` + Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';

const MARKDOWN = (middle = 'Madrid hosted the Final at Bernabeu') =>
  [
    '# Club history',
    '## Founding',
    para('Barcelona and Madrid were founded early in Spain'),
    '## Trophies',
    para(middle),
    '## Stadium',
    para('Barcelona plays at Camp Nou in Catalonia'),
  ].join('\n\n');

const textSource = (text: string) => ({ text, format: 'md', title: 'Club history' });

describe('CRUD on InMemoryStore', () => {
  it('create, then a duplicate create throws ConflictError', async () => {
    const { service } = makeService();
    const doc = await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    expect(doc.chunkCount).toBe(3);
    expect(doc.version).toBe(1);
    expect(doc.collection).toBe('fixtures');
    await expect(
      service.create({ id: 'club', source: textSource(MARKDOWN()) }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('an unchanged update never calls the embedder', async () => {
    const embedder = new HashEmbedder();
    const { service } = makeService(new InMemoryStore(), embedder);
    await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    const before = embedder.passagesEmbedded;
    const result = await service.update('club', { source: textSource(MARKDOWN()) });
    expect(result).toEqual({ status: 'unchanged', added: 0, removed: 0, kept: 3 });
    expect(embedder.passagesEmbedded).toBe(before);
  });

  it('changing one paragraph embeds exactly the changed chunk and renumbers the rest', async () => {
    const embedder = new HashEmbedder();
    const { service, store } = makeService(new InMemoryStore(), embedder);
    await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    const oldChunks = await service.chunks('club');
    const before = embedder.passagesEmbedded;
    const result = await service.update('club', {
      source: textSource(MARKDOWN('Valencia hosted the Final at Mestalla')),
    });
    expect(result).toEqual({ status: 'reindexed', added: 1, removed: 1, kept: 2 });
    expect(embedder.passagesEmbedded - before).toBe(1);
    const newChunks = await service.chunks('club');
    expect(newChunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(newChunks[0]!.id).toBe(oldChunks[0]!.id);
    expect(newChunks[2]!.id).toBe(oldChunks[2]!.id);
    expect(newChunks[1]!.text).toContain('Valencia');
    expect((await service.get('club'))!.version).toBe(2);
    const counts = await store.counts();
    expect(counts.next).toBe(2);
    expect(counts.orphanEntities).toBe(0);
    // 'Bernabeu' was only in the replaced chunk, so its entity is gone; 'Mestalla' is new.
    const stored = await store.getChunksByIds(newChunks.map((c) => c.id));
    const entities = new Set(stored.flatMap((c) => c.entities));
    expect(entities.has('Bernabeu')).toBe(false);
    expect(entities.has('Mestalla')).toBe(true);
  });

  it('metadata-only updates never re-embed', async () => {
    const embedder = new HashEmbedder();
    const { service } = makeService(new InMemoryStore(), embedder);
    await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    const before = embedder.passagesEmbedded;
    const result = await service.update('club', { title: 'Renamed', collection: 'other' });
    expect(result.status).toBe('metadata');
    expect(embedder.passagesEmbedded).toBe(before);
    const doc = (await service.get('club'))!;
    expect(doc).toMatchObject({ title: 'Renamed', collection: 'other', version: 2 });
  });

  it('CO_OCCURS weights equal a recount from chunk entities', async () => {
    const { service, store } = makeService();
    await service.create({ id: 'a', source: textSource(MARKDOWN()) });
    await service.create({
      id: 'b',
      source: { text: para('Barcelona beat Madrid at Camp Nou'), format: 'txt', title: 'Match' },
    });
    const recount = await recountCoOccurs(store, ['a', 'b']);
    const stored = (store as InMemoryStore).coOccurrenceWeights();
    expect(stored).toEqual(recount);
    expect(stored.get('Barcelona\u0000Madrid')).toBe(2);
  });

  it('delete without confirm deletes nothing and reports the plan', async () => {
    const { service, store } = makeService();
    await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    const before = await store.counts();
    const result = await service.delete('club');
    expect(result.executed).toBe(false);
    expect(result.plan).toMatchObject({ documentIds: ['club'], chunks: 3 });
    expect(result.plan.orphanEntities).toBeGreaterThan(0);
    expect(await store.counts()).toEqual(before);
  });

  it('delete removes chunks and leaves zero orphan entities; shared entities survive', async () => {
    const { service, store } = makeService();
    await service.create({ id: 'club', source: textSource(MARKDOWN()) });
    await service.create({
      id: 'match',
      source: { text: para('Barcelona beat Madrid'), format: 'txt', title: 'Match' },
    });
    const result = await service.delete('club', { confirm: true });
    expect(result.executed).toBe(true);
    const counts = await store.counts();
    expect(counts).toMatchObject({ documents: 1, chunks: 1, orphanEntities: 0 });
    const remaining = (
      await store.getChunksByIds((await store.getChunks('match')).map((c) => c.id))
    )[0]!;
    expect(remaining.entities).toEqual(expect.arrayContaining(['Barcelona', 'Madrid']));
    expect(counts.entities).toBe(new Set(remaining.entities).size);
    await expect(service.get('club')).resolves.toBeNull();
    await expect(service.delete('club', { confirm: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deleteCollection respects confirm and upsert is idempotent', async () => {
    const { service, store } = makeService();
    const first = await service.upsert({ id: 'club', source: textSource(MARKDOWN()) });
    const second = await service.upsert({ id: 'club', source: textSource(MARKDOWN()) });
    expect(first.created).toBe(true);
    expect(second).toEqual({
      created: false,
      result: { status: 'unchanged', added: 0, removed: 0, kept: 3 },
    });
    expect((await service.deleteCollection('fixtures')).executed).toBe(false);
    expect((await store.counts()).documents).toBe(1);
    expect(
      (await service.deleteCollection('fixtures', { confirm: true })).plan.documentIds,
    ).toEqual(['club']);
    expect((await store.counts()).documents).toBe(0);
  });
});
