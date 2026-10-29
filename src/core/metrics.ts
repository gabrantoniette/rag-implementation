/** A relevant passage: a document, optionally narrowed to a section (prefix of the section label). */
export interface GoldSpec {
  title: string;
  section?: string;
}

export function matchesGold(
  chunk: { documentTitle: string; section: string },
  gold: GoldSpec,
): boolean {
  if (chunk.documentTitle !== gold.title) return false;
  return (
    gold.section === undefined ||
    chunk.section === gold.section ||
    chunk.section.startsWith(`${gold.section} >`)
  );
}

export const isRelevant = (chunk: { documentTitle: string; section: string }, gold: GoldSpec[]) =>
  gold.some((g) => matchesGold(chunk, g));

/** Share of gold passages that at least one of the top k chunks matches. */
export function recallAtK(
  ranked: { documentTitle: string; section: string }[],
  gold: GoldSpec[],
  k: number,
): number {
  if (gold.length === 0) return 0;
  const top = ranked.slice(0, k);
  return gold.filter((g) => top.some((c) => matchesGold(c, g))).length / gold.length;
}

/** Reciprocal rank of the first relevant chunk (0 when none is ranked). */
export function reciprocalRank(relevance: boolean[]): number {
  const i = relevance.indexOf(true);
  return i < 0 ? 0 : 1 / (i + 1);
}

/** Binary nDCG@k; idealRelevant = how many relevant chunks exist (caps the ideal ranking). */
export function ndcgAtK(relevance: boolean[], k: number, idealRelevant: number): number {
  const dcg = relevance.slice(0, k).reduce((s, rel, i) => s + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Math.min(k, idealRelevant);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

export const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
