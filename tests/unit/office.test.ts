import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TransformersEmbedder } from '../../src/adapters/embedder.js';
import { createModelTokenCounter } from '../../src/adapters/tokenizer.js';
import {
  ArchiveLimitError,
  CorruptDocumentError,
  EncryptedDocumentError,
} from '../../src/core/errors.js';
import { formatLocator } from '../../src/core/locator.js';
import type { ParsedDocument } from '../../src/core/types.js';
import { createRegistry } from '../../src/loaders/index.js';
import { createOfficeLoader } from '../../src/loaders/office.js';
import { LoaderRegistry } from '../../src/loaders/registry.js';
import { loaderContext, writeFixture } from '../helpers/context.js';
import { makeDocx, makePptx, makeXlsx, makeZipBomb } from '../helpers/office.js';
import { indexDocuments, topK } from '../helpers/retrieval.js';

const registry = createRegistry(50 * 1024 * 1024);
const ctx = loaderContext();

// Gold sentences used by the retrieval check.
const GOLD_DOCX = 'The offside rule was first written into the laws of the game in 1863.';
const GOLD_PPTX = 'The coach praised the defence for keeping eleven clean sheets.';

async function docxFixture(): Promise<ParsedDocument> {
  const bytes = await makeDocx('Football Laws Handbook', [
    { heading: 'History', level: 1 },
    { paragraph: GOLD_DOCX, footnote: 'Source: the 1863 Football Association minutes.' },
    { heading: 'Equipment', level: 1 },
    { heading: 'The ball', level: 2 },
    { paragraph: 'A size five ball is used for adult matches.' },
    {
      table: [
        ['Item', 'Requirement'],
        ['Ball', 'Spherical, size 5'],
        ['Shin guards', 'Mandatory'],
      ],
    },
  ]);
  return registry.loadFile(writeFixture('office', 'handbook.docx', bytes), ctx);
}

async function xlsxFixture(): Promise<ParsedDocument> {
  const bytes = await makeXlsx('League Table 2024', [
    {
      name: 'Standings',
      rows: [
        ['Club', 'Wins', 'Points'],
        ['Northbridge Rovers', 21, { f: 'B2*3', v: 63 }],
        ['Eastfield Athletic', 18, { f: 'B3*3', v: 54 }],
      ],
    },
    {
      name: 'Scorers',
      rows: [
        ['Player', 'Goals'],
        ['Ana Ribeiro', 27],
      ],
    },
  ]);
  return registry.loadFile(writeFixture('office', 'league.xlsx', bytes), ctx);
}

async function pptxFixture(): Promise<ParsedDocument> {
  const bytes = await makePptx('Season Review Deck', [
    { title: 'Season overview', body: ['Promotion secured in the final week'] },
    { title: 'Defensive record', body: ['Fewest goals conceded in the league'], notes: GOLD_PPTX },
  ]);
  return registry.loadFile(writeFixture('office', 'review.pptx', bytes), ctx);
}

describe('office loader', () => {
  it('docx: heading path, tables flattened row by row, footnotes kept', async () => {
    const doc = await docxFixture();
    expect(doc.title).toBe('Football Laws Handbook');
    expect(doc.format).toBe('docx');
    expect(doc.sections.map((s) => s.path)).toEqual([['History'], ['Equipment', 'The ball']]);
    expect(doc.sections[0]!.text).toContain(GOLD_DOCX);
    expect(doc.sections[0]!.text).toContain(
      '[Footnote: Source: the 1863 Football Association minutes.]',
    );
    expect(doc.sections[1]!.text).toContain('Ball | Spherical, size 5');
    expect(doc.sections[1]!.locator).toEqual({ kind: 'heading', path: ['Equipment', 'The ball'] });
  });

  it('xlsx: one sheet at a time, header repeated, cached formula values, sheet row locators', async () => {
    const doc = await xlsxFixture();
    expect(doc.format).toBe('xlsx');
    expect(doc.sections).toHaveLength(2);
    const [standings, scorers] = doc.sections;
    expect(standings!.text).toBe(
      "Sheet 'Standings' columns: Club, Wins, Points\n" +
        'Club: Northbridge Rovers; Wins: 21; Points: 63\n' +
        'Club: Eastfield Athletic; Wins: 18; Points: 54',
    );
    expect(standings!.locator).toEqual({ kind: 'rows', start: 2, end: 3, sheet: 'Standings' });
    expect(formatLocator(standings!.locator)).toBe("Sheet 'Standings' rows 2-3");
    expect(scorers!.locator).toEqual({ kind: 'rows', start: 2, end: 2, sheet: 'Scorers' });
  });

  it('pptx: one section per slide with title, body and speaker notes', async () => {
    const doc = await pptxFixture();
    expect(doc.format).toBe('pptx');
    expect(doc.sections.map((s) => s.locator)).toEqual([
      { kind: 'slide', slide: 1 },
      { kind: 'slide', slide: 2 },
    ]);
    expect(doc.sections[1]!.path).toEqual(['Defensive record']);
    expect(doc.sections[1]!.text).toBe(
      `Defensive record\nFewest goals conceded in the league\nSpeaker notes: ${GOLD_PPTX}`,
    );
    expect(formatLocator(doc.sections[1]!.locator)).toBe('slide 2');
  });

  it('rejects a file whose declared uncompressed size exceeds the configured limit', async () => {
    const small = new LoaderRegistry({ maxBytes: 50 * 1024 * 1024 }).register(
      createOfficeLoader({ maxUncompressedBytes: 1024 * 1024, maxZipEntries: 100 }),
    );
    const bomb = await makeZipBomb('word/document.xml', 3 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    await expect(
      small.loadFile(writeFixture('office', 'bomb.docx', bomb), ctx),
    ).rejects.toBeInstanceOf(ArchiveLimitError);
  });

  it('corrupt and password-protected files throw typed errors', async () => {
    const good = await makeDocx('x', [{ paragraph: 'y' }]);
    const truncated = good.slice(0, 80);
    await expect(
      registry.loadFile(writeFixture('office', 'truncated.docx', truncated), ctx),
    ).rejects.toBeInstanceOf(CorruptDocumentError);
    // Encrypted OOXML lives in an OLE compound file container (signature D0 CF 11 E0).
    const ole = new Uint8Array(1024);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(
      registry.loadFile(writeFixture('office', 'locked.xlsx', ole), ctx),
    ).rejects.toBeInstanceOf(EncryptedDocumentError);
  });

  describe('retrieval over the three office fixtures', () => {
    const embedder = new TransformersEmbedder();
    let index: Awaited<ReturnType<typeof indexDocuments>>;

    beforeAll(async () => {
      const tokens = await createModelTokenCounter();
      index = await indexDocuments(
        [await docxFixture(), await xlsxFixture(), await pptxFixture()],
        tokens,
        embedder,
      );
    });
    afterAll(() => embedder.close());

    it.each([
      ['When were offside laws first written down?', GOLD_DOCX, 'Word section'],
      [
        'How many points did Northbridge Rovers finish with?',
        'Points: 63',
        "Sheet 'Standings' rows 2-3",
      ],
      ['What did the coach say about the defence?', GOLD_PPTX, 'slide 2'],
    ])('%s', async (query, gold, locator) => {
      const hits = await topK(index, embedder, query, 3);
      const hit = hits.find((h) => h.text.includes(gold));
      expect(hit, `gold "${gold}" not in top 3`).toBeDefined();
      expect(formatLocator(hit!.locator, hit!.header.startsWith('Football') ? 'docx' : '')).toBe(
        locator,
      );
    });
  });
});
