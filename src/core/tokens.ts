/** Counts tokens the way the embedding model does. Synchronous so the chunker stays simple. */
export interface TokenCounter {
  count(text: string): number;
}

/**
 * Deterministic approximation (words and punctuation marks) for unit tests of chunking logic.
 * Production code uses the embedding model's tokenizer (see adapters/tokenizer.ts).
 */
export const approximateTokenCounter: TokenCounter = {
  count: (text) => text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu)?.length ?? 0,
};

/** Longest prefix of whole words whose token count is at most maxTokens (binary search). */
export function truncateToTokens(text: string, maxTokens: number, counter: TokenCounter): string {
  if (counter.count(text) <= maxTokens) return text;
  const words = text.split(/(\s+)/);
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (counter.count(words.slice(0, mid).join('')) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return words.slice(0, lo).join('').trimEnd();
}

/** Shortest suffix of whole words whose token count reaches about `tokens` (used for overlap). */
export function tailTokens(text: string, tokens: number, counter: TokenCounter): string {
  if (tokens <= 0) return '';
  const words = text.split(/\s+/).filter(Boolean);
  let lo = 0;
  let hi = words.length;
  // Find the largest start index whose suffix still has >= tokens tokens.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (counter.count(words.slice(mid).join(' ')) >= tokens) lo = mid;
    else hi = mid - 1;
  }
  const tail = words.slice(lo).join(' ');
  return counter.count(tail) > tokens ? words.slice(lo + 1).join(' ') : tail;
}
