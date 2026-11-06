import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectPath } from '../../src/core/paths.js';
import { approximateTokenCounter } from '../../src/core/tokens.js';
import { createRag } from '../../src/index.js';
import { HashEmbedder, capitalizedEntities } from '../helpers/fakes.js';

const SPORTS_WORDS = /\b(sports?|football|soccer|tennis|basketball|olympic|formula one|athlet)/i;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsFiles(path.join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [path.join(dir, e.name)]
        : [],
  );
}

describe('reuse: the core works for any domain', () => {
  it('src/core contains no sports-specific code', () => {
    const offenders = tsFiles(projectPath('src', 'core')).filter((f) =>
      SPORTS_WORDS.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('createRag runs a toy domain (domains/_template) with in-memory adapters', async () => {
    const rag = await createRag({
      env: {},
      domainDir: 'domains/_template',
      store: 'memory',
      embedder: new HashEmbedder(),
      tokens: approximateTokenCounter,
      llm: 'mock',
      reranker: { name: 'fixed', score: async (rows) => rows.map((_, i) => 0.9 - i * 0.01) },
      intent: 'rules',
      entityExtractor: capitalizedEntities,
    });
    try {
      expect(rag.config.domain.name).toBe('template');
      await rag.documents.create({
        id: 'handbook',
        source: {
          text: '# Office handbook\n## Opening hours\nThe Lisbon office opens at nine every weekday morning.',
          format: 'md',
          title: 'Office handbook',
        },
      });
      expect((await rag.documents.get('handbook'))!.collection).toBe('template');
      const result = await rag.ask('When does the Lisbon office open?');
      expect(result.state.context[0]!.chunk.documentTitle).toBe('Office handbook');
      expect(result.answer).toContain(
        '## Sources\n[1] Office handbook > Opening hours (Markdown section)',
      );
      expect(result.refused).toBe(false);
    } finally {
      await rag.close();
    }
  });

  it('does not close a logger the caller passed in (the caller owns it)', async () => {
    let closed = 0;
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      close: async () => void closed++,
    };
    const rag = await createRag({
      env: {},
      domainDir: 'domains/_template',
      store: 'memory',
      embedder: new HashEmbedder(),
      tokens: approximateTokenCounter,
      llm: 'mock',
      intent: 'rules',
      reranker: 'pass-through',
      entityExtractor: capitalizedEntities,
      logger,
    });
    await rag.close();
    expect(closed).toBe(0);
  });
});
