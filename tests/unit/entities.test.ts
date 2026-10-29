import { afterAll, describe, expect, it } from 'vitest';
import { NerExtractor, WikiLinkExtractor, cleanEntity } from '../../src/adapters/entities.js';
import { createRegistry } from '../../src/loaders/index.js';
import { loaderContext } from '../helpers/context.js';

const registry = createRegistry(1024 * 1024);
const ctx = loaderContext();

describe('WikiLinkExtractor', () => {
  it('maps whole-word anchors in the chunk to link targets from anywhere in the article', async () => {
    const sections = [
      {
        path: [],
        text: 'x',
        locator: { kind: 'heading' as const, path: [] },
        modality: 'text' as const,
        kind: 'prose' as const,
        links: [
          { anchor: 'Wimbledon', target: 'Wimbledon Championships' },
          { anchor: 'Basel', target: 'Basel' },
          { anchor: 'US', target: 'United States' }, // too short: ignored
        ],
      },
    ];
    const extractor = new WikiLinkExtractor();
    const found = await extractor.extract({
      text: 'Bio > Career\nShe won Wimbledon twice and lived near Baselland. The US Open followed.',
      sections,
    });
    expect(found).toEqual(['Wimbledon Championships']);
  });
});

describe('NerExtractor (Xenova/bert-base-NER)', () => {
  const ner = new NerExtractor();
  afterAll(() => ner.close());

  it('cleans WordPiece fragments', () => {
    expect(cleanEntity('Dj ##oko ##vic')).toBe('Djokovic');
  });

  it('finds known names in Markdown fixture text', async () => {
    const doc = await registry.loadText(
      '# Finals\n## 2008\nRafael Nadal beat Roger Federer at Wimbledon in London.',
      'md',
      'Finals',
      'memory://ner-md',
      ctx,
    );
    const found = await ner.extract({
      text: `Finals > 2008\n${doc.sections[0]!.text}`,
      sections: doc.sections,
    });
    expect(found).toEqual(expect.arrayContaining(['Rafael Nadal', 'Roger Federer', 'London']));
  });

  it('finds known names in a transcript (subtitle) fixture', async () => {
    const doc = await registry.loadText(
      '1\n00:00:01,000 --> 00:00:05,000\nLewis Hamilton takes the lead from Max Verstappen\n\n' +
        '2\n00:00:05,500 --> 00:00:09,000\nhere at Silverstone for Mercedes.\n',
      'srt',
      'Race commentary',
      'memory://ner-srt',
      ctx,
    );
    const found = await ner.extract({
      text: `Race commentary > Transcript\n${doc.sections[0]!.text}`,
      sections: doc.sections,
    });
    expect(found).toEqual(
      expect.arrayContaining(['Lewis Hamilton', 'Max Verstappen', 'Silverstone', 'Mercedes']),
    );
  });
});
