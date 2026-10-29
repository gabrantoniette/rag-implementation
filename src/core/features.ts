import type { Candidate } from './chain.js';
import { contentTerms } from './text.js';

/** Order of the reranker input features (learning-to-rank over features, not raw embeddings). */
export const FEATURE_NAMES = [
  'cosine',
  'fulltextScore',
  'vectorRank',
  'fulltextRank',
  'entityOverlap',
  'fromGraph',
  'sameDocAsTop1',
  'length',
  'titleSectionMatch',
] as const;

const rankFeature = (rank?: number) => (rank === undefined ? 0 : 1 / (1 + rank));

/**
 * Features for every candidate of one query:
 * cosine score; fulltext score normalized by the best fulltext score; reciprocal rank in the vector
 * and fulltext lists; entities of the chunk named in the query (capped at 3); reached through the
 * graph; same document as the top fused hit; chunk length / maxTokens; share of query terms found
 * in 'title > section'.
 */
export function computeFeatures(
  question: string,
  candidates: Candidate[],
  maxTokens: number,
): number[][] {
  const q = question.toLowerCase();
  const terms = [...new Set(contentTerms(question))];
  const maxFulltext = Math.max(0, ...candidates.map((c) => c.fulltextScore ?? 0));
  const top = [...candidates].filter((c) => c.rrf > 0).sort((a, b) => b.rrf - a.rrf)[0];
  return candidates.map((c) => {
    const entityHits = c.chunk.entities.filter(
      (e) => e.length > 2 && q.includes(e.toLowerCase()),
    ).length;
    const label = new Set(contentTerms(`${c.chunk.documentTitle} ${c.chunk.section}`));
    const titleMatch = terms.length ? terms.filter((t) => label.has(t)).length / terms.length : 0;
    return [
      c.cosine,
      maxFulltext > 0 ? (c.fulltextScore ?? 0) / maxFulltext : 0,
      rankFeature(c.vectorRank),
      rankFeature(c.fulltextRank),
      Math.min(entityHits, 3) / 3,
      c.expansion ? 1 : 0,
      top && c.chunk.documentId === top.chunk.documentId ? 1 : 0,
      Math.min(1, c.chunk.tokenCount / maxTokens),
      titleMatch,
    ];
  });
}
