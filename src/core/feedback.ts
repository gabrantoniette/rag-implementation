import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const FeedbackSchema = z.object({
  question: z.string(),
  /** Chunks that were in the answer's context, in context order. */
  chunkIds: z.array(z.string()),
  /** Chunks the answer cited. */
  cited: z.array(z.string()),
  rating: z.enum(['up', 'down']),
  at: z.string(),
});
export type FeedbackRecord = z.infer<typeof FeedbackSchema>;

export function appendFeedback(file: string, record: FeedbackRecord): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(FeedbackSchema.parse(record))}\n`);
}

export function readFeedback(file: string): FeedbackRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => FeedbackSchema.parse(JSON.parse(l)));
}

/**
 * Feedback labels: 'up' -> cited chunks relevant, other context chunks not relevant;
 * 'down' -> cited chunks not relevant. Records that reference deleted chunks are skipped.
 */
export function feedbackLabels(
  records: FeedbackRecord[],
  exists: (chunkId: string) => boolean,
): { labels: { question: string; chunkId: string; label: number }[]; skipped: number } {
  const labels: { question: string; chunkId: string; label: number }[] = [];
  let skipped = 0;
  for (const r of records) {
    if (![...r.chunkIds, ...r.cited].every(exists)) {
      skipped++;
      continue;
    }
    const cited = new Set(r.cited);
    for (const id of r.chunkIds) {
      if (r.rating === 'up')
        labels.push({ question: r.question, chunkId: id, label: cited.has(id) ? 1 : 0 });
      else if (cited.has(id)) labels.push({ question: r.question, chunkId: id, label: 0 });
    }
  }
  return { labels, skipped };
}

export interface RankingScore {
  handNdcg6: number;
  syntheticNdcg6: number;
}

/**
 * Gated retraining: a new reranker replaces the current one only if nDCG@6 is no worse on the
 * hand-written eval set AND on the synthetic validation set. With no current model, it is promoted.
 */
export function shouldPromote(current: RankingScore | null, candidate: RankingScore): boolean {
  if (!current) return true;
  const eps = 1e-9;
  return (
    candidate.handNdcg6 + eps >= current.handNdcg6 &&
    candidate.syntheticNdcg6 + eps >= current.syntheticNdcg6
  );
}
