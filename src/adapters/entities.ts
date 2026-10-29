import { type TokenClassificationPipeline, pipeline } from '@huggingface/transformers';
import type { EntityExtractor, EntityInput } from '../core/ports.js';
import { configureTransformers } from './transformers-env.js';

export type { EntityExtractor, EntityInput };

/**
 * Wikipedia hyperlinks as canonical entities. Articles link a term only at its first mention, so a
 * chunk mentions the target of every link in its article whose anchor text (3+ characters) appears
 * in the chunk as a whole word. No model is involved.
 */
export class WikiLinkExtractor implements EntityExtractor {
  readonly name = 'wikilink';
  async extract({ text, sections }: EntityInput): Promise<string[]> {
    const found = new Set<string>();
    for (const section of sections) {
      for (const link of section.links ?? []) {
        if (link.anchor.length < 3 || found.has(link.target)) continue;
        if (wholeWord(link.anchor).test(text)) found.add(link.target);
      }
    }
    return [...found];
  }
  async close(): Promise<void> {}
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (s: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(s)}(?![\\p{L}\\p{N}])`, 'u');

const NER_LABELS = new Set(['PER', 'ORG', 'LOC', 'MISC']);

/**
 * The 'simple' aggregation can drop a trailing word piece ('Verstappe' for 'Verstappen'), so a
 * span is extended to the end of the word where it occurs in the source text.
 */
export function expandToWord(name: string, text: string): string {
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}[\\p{L}\\p{N}]*`, 'u').exec(
    text,
  );
  return match ? match[0] : name;
}

/** Joins WordPiece fragments ('##') and tidies whitespace in an NER span. */
export function cleanEntity(word: string): string {
  return word
    .replace(/\s*##/g, '')
    .replace(/\s+([.,'’-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Named-entity recognition with Xenova/bert-base-NER (English; PER, ORG, LOC, MISC) and the
 * 'simple' aggregation strategy. Used for every format without hyperlinks.
 */
export class NerExtractor implements EntityExtractor {
  readonly name = 'ner';
  private pipe: Promise<TokenClassificationPipeline> | null = null;

  constructor(
    private readonly modelId = 'Xenova/bert-base-NER',
    private readonly minScore = 0.8,
  ) {}

  private load() {
    if (!this.pipe) {
      configureTransformers();
      this.pipe = pipeline('token-classification', this.modelId, {
        dtype: 'q8',
      }) as Promise<TokenClassificationPipeline>;
    }
    return this.pipe;
  }

  async extract({ text }: EntityInput): Promise<string[]> {
    const pipe = await this.load();
    // The header line ("Title > Section") is metadata, not prose.
    const body = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text;
    const output = (await pipe(body, { aggregation_strategy: 'simple' } as never)) as unknown as {
      entity_group?: string;
      entity?: string;
      word: string;
      score: number;
    }[];
    const names = new Set<string>();
    for (const e of output) {
      const label = (e.entity_group ?? e.entity ?? '').replace(/^[BI]-/, '');
      if (!NER_LABELS.has(label) || e.score < this.minScore) continue;
      const name = expandToWord(cleanEntity(e.word), body);
      if (name.length >= 2 && /\p{L}/u.test(name)) names.add(name);
    }
    return [...names];
  }

  async close(): Promise<void> {
    if (this.pipe) await (await this.pipe).dispose();
    this.pipe = null;
  }
}
