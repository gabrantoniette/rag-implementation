import { describe, expect, it } from 'vitest';
import { createModelTokenCounter } from '../../src/adapters/tokenizer.js';
import { chunkDocument, paragraphs } from '../../src/core/chunker.js';
import { approximateTokenCounter as counter } from '../../src/core/tokens.js';
import type { ParsedDocument, Section } from '../../src/core/types.js';

const opts = { targetTokens: 300, maxTokens: 400, overlapTokens: 50, minTokens: 60 };

const prose = (path: string[], text: string): Section => ({
  path,
  text,
  locator: { kind: 'heading', path },
  modality: 'text',
  kind: 'prose',
});

const doc = (sections: Section[], format = 'markdown'): ParsedDocument => ({
  id: 'd1',
  title: 'Doc',
  uri: 'memory://doc',
  format,
  contentHash: 'h',
  sections,
  metadata: {},
  links: [],
});

/** n distinct sentences of 10 tokens each (9 words + period). */
const sentencesText = (n: number, tag = 's') =>
  Array.from(
    { length: n },
    (_, i) => `${tag}${i} alpha beta gamma delta epsilon zeta eta theta.`,
  ).join(' ');

describe('chunker', () => {
  it('keeps every chunk body within maxTokens and near the target', () => {
    const chunks = chunkDocument(doc([prose(['Long'], sentencesText(200))]), counter, opts);
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c, i) => {
      const body = c.text.slice(c.header.length + 1);
      expect(counter.count(body)).toBeLessThanOrEqual(opts.maxTokens);
      // Only the last chunk may exceed the target: a small tail merged into it (min-token rule).
      if (i < chunks.length - 1) {
        expect(counter.count(body)).toBeLessThanOrEqual(opts.targetTokens + 10);
      }
    });
  });

  it('consecutive chunks of a section overlap by about overlapTokens', () => {
    const chunks = chunkDocument(doc([prose(['Long'], sentencesText(120))]), counter, opts);
    for (let i = 1; i < chunks.length; i++) {
      const prevBody = chunks[i - 1]!.text.slice(chunks[i - 1]!.header.length + 1);
      const body = chunks[i]!.text.slice(chunks[i]!.header.length + 1);
      // The longest prefix of this chunk that ends the previous one is the overlap.
      const words = body.split(' ');
      let overlap = '';
      for (let k = 1; k <= words.length; k++) {
        const candidate = words.slice(0, k).join(' ');
        if (prevBody.endsWith(candidate)) overlap = candidate;
      }
      const t = counter.count(overlap);
      expect(t).toBeGreaterThan(30);
      expect(t).toBeLessThanOrEqual(opts.overlapTokens);
    }
  });

  it('prefixes every chunk with the "Title > Section" header and hashes header plus text', () => {
    const chunks = chunkDocument(
      doc([prose(['Career', 'Early years'], sentencesText(10))]),
      counter,
      opts,
    );
    expect(chunks[0]!.header).toBe('Doc > Career > Early years');
    expect(chunks[0]!.text.startsWith('Doc > Career > Early years\n')).toBe(true);
    const intro = chunkDocument(doc([prose([], sentencesText(10))]), counter, opts);
    expect(intro[0]!.header).toBe('Doc > Introduction');
    expect(chunks[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('merges a chunk below minTokens into its neighbour', () => {
    const chunks = chunkDocument(
      doc([prose(['A'], sentencesText(15, 'a')), prose(['B'], 'Tiny section.')]),
      counter,
      opts,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('B: Tiny section.');
    expect(chunks[0]!.locator).toEqual({ kind: 'heading', path: ['A'] });

    // A small trailing piece of a long section joins the previous chunk of the same section.
    const long = chunkDocument(doc([prose(['C'], sentencesText(31, 'c'))]), counter, opts);
    const lastBody = long[long.length - 1]!.text.slice(long[long.length - 1]!.header.length + 1);
    expect(counter.count(lastBody)).toBeGreaterThanOrEqual(opts.minTokens);
  });

  it('keeps fenced code blocks intact when they fit', () => {
    const code = '```ts\nconst a = 1;\n\nconst b = 2;\n```';
    expect(paragraphs(`Intro text.\n\n${code}\n\nAfter.`)).toEqual([
      { text: 'Intro text.', fenced: false },
      { text: code, fenced: true },
      { text: 'After.', fenced: false },
    ]);
    const chunks = chunkDocument(
      doc([prose(['Code'], `${sentencesText(8)}\n\n${code}`)]),
      counter,
      opts,
    );
    expect(chunks[0]!.text).toContain(code);
  });

  it('truncates an oversize table row at maxTokens and records a warning', () => {
    const row: Section = {
      path: [],
      text: `Columns: notes\nnotes: ${'word '.repeat(600)}`,
      locator: { kind: 'rows', start: 7, end: 7 },
      modality: 'text',
      kind: 'table',
    };
    const chunks = chunkDocument(doc([row], 'csv'), counter, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.warnings[0]).toMatch(/truncated from \d+ to 400 tokens/);
    expect(counter.count(chunks[0]!.text.slice(chunks[0]!.header.length + 1))).toBeLessThanOrEqual(
      400,
    );
    expect(chunks[0]!.header).toBe('Doc > Table');
    expect(chunks[0]!.locator).toEqual({ kind: 'rows', start: 7, end: 7 });
  });

  it('keeps table and transcript sections whole when they fit', () => {
    const table: Section = {
      path: [],
      text: 'Columns: a\na: 1\na: 2',
      locator: { kind: 'rows', start: 1, end: 2 },
      modality: 'text',
      kind: 'table',
    };
    const chunks = chunkDocument(
      doc([table, { ...table, locator: { kind: 'rows', start: 3, end: 4 } }], 'csv'),
      counter,
      opts,
    );
    // Tables never merge, even when small: each group keeps its own row range.
    expect(chunks.map((c) => c.locator)).toEqual([
      { kind: 'rows', start: 1, end: 2 },
      { kind: 'rows', start: 3, end: 4 },
    ]);
  });

  it('counts tokens with the embedding model tokenizer (Xenova/bge-small-en-v1.5)', async () => {
    const real = await createModelTokenCounter();
    expect(real.count('Roger Federer won Wimbledon.')).toBeGreaterThan(4);
    const chunks = chunkDocument(doc([prose(['Real'], sentencesText(150))]), real, opts);
    for (const c of chunks) {
      expect(real.count(c.text.slice(c.header.length + 1))).toBeLessThanOrEqual(opts.maxTokens);
    }
  });
});
