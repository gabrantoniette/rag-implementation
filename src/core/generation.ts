import type { Candidate, Citation, SentenceCheck, Verification } from './chain.js';
import { formatLocator } from './locator.js';
import { type Embedder, dot } from './ports.js';
import type { PromptSource } from './prompt.js';

export const UNSUPPORTED_MARK = '(not directly supported by the sources)';

/** Chunk text without its 'Title > Section' header line. */
export const chunkBody = (text: string) =>
  text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text;

export function promptSources(context: Candidate[]): PromptSource[] {
  return context.map((c, i) => ({
    n: i + 1,
    title: c.chunk.documentTitle,
    section: c.chunk.section,
    locator: formatLocator(c.chunk.locator, c.chunk.documentFormat),
    text: chunkBody(c.chunk.text),
  }));
}

/** Text of a '## <name>' section (case-insensitive) up to the next '## ' heading. */
export function markdownSection(text: string, name: string): string | null {
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'im');
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

export const citationNumbers = (s: string) =>
  [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

/** The model must write exactly 'Answer' and 'Key points'; JSON mode is not relied upon. */
export function validateStructure(
  text: string,
  sourceCount: number,
): { errors: string[]; invalid: number[] } {
  const errors: string[] = [];
  if (markdownSection(text, 'Answer') === null) errors.push("missing '## Answer' section");
  if (markdownSection(text, 'Key points') === null) errors.push("missing '## Key points' section");
  const invalid = [...new Set(citationNumbers(text).filter((n) => n < 1 || n > sourceCount))];
  if (invalid.length > 0)
    errors.push(`citations out of range: ${invalid.map((n) => `[${n}]`).join(' ')}`);
  return { errors, invalid };
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

const CITATIONS_ONLY = /^(?:\s*\[\d+\])+\s*$/;

/**
 * 'fact. [n]' (the prompt's own format) is segmented as 'fact.' + '[n]': a citation-only segment is
 * appended to the segment before it; one with nothing before it is dropped.
 */
function attachCitations(segments: string[]): string[] {
  const out: string[] = [];
  for (const s of segments) {
    if (!CITATIONS_ONLY.test(s)) out.push(s);
    else if (out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${s.trim()}`;
  }
  return out;
}

/** Sentences of the Answer section and one entry per Key points bullet. */
export function answerSentences(text: string): string[] {
  const answer = markdownSection(text, 'Answer') ?? '';
  const points = markdownSection(text, 'Key points') ?? '';
  const sentences = [...segmenter.segment(answer.replace(/\n+/g, ' '))].map((s) =>
    s.segment.trim(),
  );
  const bullets = points
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
  return [...attachCitations(sentences), ...attachCitations(bullets)].filter((s) =>
    /[\p{L}\p{N}]/u.test(s),
  );
}

export const isRefusal = (text: string, refusal: string) =>
  (markdownSection(text, 'Answer') ?? text).trim().startsWith(refusal);

/**
 * Local verification (no LLM): every [n] must exist in the context; each answer sentence is
 * embedded and compared with its cited chunks. A sentence without citations, or whose best cited
 * chunk is below the threshold, is unsupported. groundingScore = supported / sentences.
 */
export async function verifyAnswer(
  text: string,
  context: Candidate[],
  embedder: Embedder,
  options: { threshold: number; passThreshold: number; refusal: string },
): Promise<Verification> {
  const { errors, invalid } = validateStructure(text, context.length);
  if (isRefusal(text, options.refusal)) {
    return {
      citationsValid: invalid.length === 0,
      invalidCitations: invalid,
      sentences: [],
      groundingScore: 1,
      passed: invalid.length === 0,
      structureErrors: errors,
    };
  }
  const sentences = answerSentences(text);
  const plain = sentences.map((s) => s.replace(/\[\d+\]/g, '').trim());
  const vectors = plain.length ? await embedder.embedPassages(plain) : [];
  const checks: SentenceCheck[] = sentences.map((sentence, i) => {
    const citations = [...new Set(citationNumbers(sentence))];
    const valid = citations.filter((n) => n >= 1 && n <= context.length);
    const support = valid.length
      ? Math.max(...valid.map((n) => dot(vectors[i]!, context[n - 1]!.chunk.embedding)))
      : 0;
    return {
      sentence,
      citations,
      support,
      supported: valid.length > 0 && support >= options.threshold,
    };
  });
  const groundingScore = checks.length
    ? checks.filter((c) => c.supported).length / checks.length
    : 0;
  const citationsValid = invalid.length === 0 && citationNumbers(text).length > 0;
  return {
    citationsValid,
    invalidCitations: invalid,
    sentences: checks,
    groundingScore,
    passed: citationsValid && groundingScore >= options.passThreshold && errors.length === 0,
    structureErrors: errors,
  };
}

/** Appends the unsupported mark to each unsupported sentence of the user-facing answer. */
export function markUnsupported(text: string, verification: Verification): string {
  let out = text;
  for (const check of verification.sentences) {
    if (check.supported) continue;
    const idx = out.indexOf(check.sentence);
    if (idx < 0) continue;
    const end = idx + check.sentence.length;
    out = `${out.slice(0, end)} ${UNSUPPORTED_MARK}${out.slice(end)}`;
  }
  return out;
}

/** Citations actually used in the answer that exist in the context, in number order. */
export function validatedCitations(text: string, context: Candidate[]): Citation[] {
  const used = [...new Set(citationNumbers(text))]
    .filter((n) => n >= 1 && n <= context.length)
    .sort((a, b) => a - b);
  return used.map((n) => {
    const c = context[n - 1]!.chunk;
    return {
      n,
      chunkId: c.id,
      documentTitle: c.documentTitle,
      documentUri: c.documentUri,
      section: c.section,
      locator: formatLocator(c.locator, c.documentFormat),
    };
  });
}

/** The Sources section is built by code from the validated citations, never by the model. */
export function sourcesSection(citations: Citation[]): string {
  if (citations.length === 0) return '';
  const lines = citations.map(
    (c) => `[${c.n}] ${c.documentTitle} > ${c.section} (${c.locator}) - ${c.documentUri}`,
  );
  return `## Sources\n${lines.join('\n')}`;
}
