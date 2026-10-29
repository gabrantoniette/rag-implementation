export interface ThresholdChoice {
  threshold: number;
  /** Share of positives at or above the threshold. */
  truePositiveRate: number;
  /** Share of negatives below the threshold. */
  trueNegativeRate: number;
  balancedAccuracy: number;
  separable: boolean;
  positives: number;
  negatives: number;
}

/**
 * Threshold between scores that should pass (positives) and scores that should fail (negatives),
 * maximizing balanced accuracy. Candidates are midpoints between consecutive distinct scores; on
 * a tie the midpoint of the best range is used. When the groups are separable this is the midpoint
 * of the gap between them.
 */
export function chooseThreshold(positives: number[], negatives: number[]): ThresholdChoice {
  const all = [...new Set([...positives, ...negatives])].sort((a, b) => a - b);
  const candidates = [
    all[0]! - 1e-6,
    ...all.slice(1).map((v, i) => (v + all[i]!) / 2),
    all[all.length - 1]! + 1e-6,
  ];
  const score = (t: number) => {
    const tpr = positives.length ? positives.filter((s) => s >= t).length / positives.length : 0;
    const tnr = negatives.length ? negatives.filter((s) => s < t).length / negatives.length : 0;
    return { tpr, tnr, bal: (tpr + tnr) / 2 };
  };
  let best = -1;
  let bestRange: number[] = [];
  for (const t of candidates) {
    const { bal } = score(t);
    if (bal > best + 1e-12) {
      best = bal;
      bestRange = [t];
    } else if (Math.abs(bal - best) <= 1e-12) bestRange.push(t);
  }
  const threshold = (bestRange[0]! + bestRange[bestRange.length - 1]!) / 2;
  const s = score(threshold);
  return {
    threshold,
    truePositiveRate: s.tpr,
    trueNegativeRate: s.tnr,
    balancedAccuracy: s.bal,
    separable: Math.min(...positives) > Math.max(...negatives),
    positives: positives.length,
    negatives: negatives.length,
  };
}
