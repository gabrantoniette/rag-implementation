import { describe, expect, it } from 'vitest';
import { evidenceCriteria } from '../../src/core/evaluation.js';

const answerable = {
  must_refuse: false,
  expected_facts: [{ match: ['Argentina'] }],
};
const grounded = { invalidCitations: [], groundingScore: 1 };

describe('live evidence criteria', () => {
  it('a refusal never passes an answerable question, even when the expected words appear in it', () => {
    const r = evidenceCriteria(
      answerable,
      {
        refused: true,
        rawAnswer:
          '## Answer\nThe sources do not say.\n\n## Key points\n- Spain beat the holders, Argentina [1]',
        citationCount: 1,
        verification: grounded,
      },
      0.8,
    );
    expect(r.criteria.answered).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('a grounded, cited answer with the expected facts passes', () => {
    const r = evidenceCriteria(
      answerable,
      {
        refused: false,
        rawAnswer: '## Answer\nArgentina won in 2022 [1].\n\n## Key points\n- Argentina [1]',
        citationCount: 1,
        verification: grounded,
      },
      0.8,
    );
    expect(r.criteria).toEqual({
      answered: true,
      atLeastOneCitation: true,
      allCitationsExist: true,
      grounding80: true,
      expectedFacts: true,
    });
    expect(r.factsFound).toEqual([true]);
    expect(r.pass).toBe(true);
  });

  it('a must-refuse question passes only when the system refused', () => {
    const q = { must_refuse: true, expected_facts: [] };
    const base = { rawAnswer: 'x', citationCount: 0 };
    expect(evidenceCriteria(q, { ...base, refused: true }, 0.8).pass).toBe(true);
    expect(evidenceCriteria(q, { ...base, refused: false }, 0.8).pass).toBe(false);
  });
});
