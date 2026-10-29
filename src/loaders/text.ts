import type { Section } from '../core/types.js';
import { baseTitle, decodeText } from './registry.js';
import type { DocumentLoader } from './types.js';

/** Plain text: blank-line paragraphs grouped up to the target token size. */
export const textLoader: DocumentLoader = {
  name: 'text',
  extensions: ['.txt'],
  async load(input, ctx) {
    const paragraphs = decodeText(input.bytes)
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const target = ctx.parameters.chunking.targetTokens;
    const sections: Section[] = [];
    let group: string[] = [];
    let groupTokens = 0;
    let start = 1;
    const flush = (end: number) => {
      if (group.length === 0) return;
      sections.push({
        path: [],
        text: group.join('\n\n'),
        locator: { kind: 'paragraphs', start, end },
        modality: 'text',
        kind: 'prose',
      });
      group = [];
      groupTokens = 0;
      start = end + 1;
    };
    paragraphs.forEach((p, i) => {
      const tokens = ctx.tokens.count(p);
      if (group.length > 0 && groupTokens + tokens > target) flush(i);
      group.push(p);
      groupTokens += tokens;
    });
    flush(paragraphs.length);
    return { title: baseTitle(input.fileName), format: 'text', sections };
  },
};
