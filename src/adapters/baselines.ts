import type { IntentClassifier, IntentPrediction, Reranker } from '../core/ports.js';

/** Keeps the incoming order (fused, or fused plus graph): row i scores 1 - i/n. */
export class PassThroughReranker implements Reranker {
  readonly name = 'pass-through';
  async score(features: number[][]): Promise<number[]> {
    const n = Math.max(1, features.length);
    return features.map((_, i) => 1 - i / n);
  }
}

const RULES: [IntentPrediction['intent'], RegExp][] = [
  [
    'compare',
    /\b(compare|comparison|versus|vs\.?|differ(?:ence|ent)?|better|more .* than|less .* than|similarit|who (?:has|had|won) more|rather than)\b/i,
  ],
  [
    'timeline',
    /\b(timeline|chronolog|history of|over the years|over time|sequence|when did .* (?:start|begin)|evolution|year by year|in order|since \d{4}|from \d{4} to)\b/i,
  ],
  [
    'explain',
    /\b(why|how does|how do|how did|how is|how are|explain|describe|what is the role|what was the role|what makes|reason|significance|impact)\b/i,
  ],
];

/** Keyword baseline for the intent classifier; the default when the trained model is not better. */
export class RuleIntentClassifier implements IntentClassifier {
  readonly name = 'rules';
  async classify(question: string): Promise<IntentPrediction> {
    for (const [intent, pattern] of RULES) {
      if (pattern.test(question)) return { intent, confidence: 1, source: this.name };
    }
    return { intent: 'lookup', confidence: 1, source: this.name };
  }
}
