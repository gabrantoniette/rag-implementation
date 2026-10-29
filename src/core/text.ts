/** Small English stopword list for keyword matching (fulltext in memory, reranker features). */
export const STOPWORDS = new Set(
  (
    'a an and are as at be been but by did do does for from had has have he her his how i in into ' +
    'is it its of on or she than that the their them then there these they this to was were what ' +
    'when where which while who whom why will with would you your about after before between both ' +
    'during each more most other over same some such through under until up very can could should ' +
    'not no nor only own so too just any all also many much one two first ever'
  ).split(' '),
);

/** Lower-case word tokens (letters and digits). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Content terms: tokens minus stopwords and one-letter tokens. */
export function contentTerms(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Rough token estimate when no tokenizer is at hand (about 1.3 tokens per word). */
export function estimateTokens(text: string): number {
  return Math.ceil((text.match(/\S+/g)?.length ?? 0) * 1.3);
}
