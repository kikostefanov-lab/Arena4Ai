import { describe, it, expect } from 'vitest';
import { scoreDeliverable } from './rubric-scorer.js';
import type { Rubric, Deliverable } from '@arena/shared';

const rubric: Rubric = {
  criteria: [
    { id: 'correctness', description: 'Is correct', weight: 0.6, maxScore: 10 },
    { id: 'quality', description: 'Is high quality', weight: 0.4, maxScore: 10 },
  ],
};

const deliverable: Deliverable = {
  teamId: 'team-a',
  files: [{ path: 'solution.ts', content: 'export const answer = 42;' }],
  collectedAt: new Date().toISOString(),
};

describe('scoreDeliverable()', () => {
  it('returns a JudgeResult with one CriterionScore per criterion', () => {
    const result = scoreDeliverable('automated', deliverable, rubric);
    expect(result.judgeId).toBe('automated');
    expect(result.teamId).toBe('team-a');
    expect(result.scores).toHaveLength(2);
    expect(result.scores.map((s) => s.criterionId)).toEqual(['correctness', 'quality']);
  });

  it('computes overallScore as weighted sum', () => {
    const result = scoreDeliverable('automated', deliverable, rubric);
    const expected = result.scores.reduce((sum, s) => {
      const criterion = rubric.criteria.find((c) => c.id === s.criterionId)!;
      return sum + (s.score / criterion.maxScore) * criterion.weight;
    }, 0);
    expect(result.overallScore).toBeCloseTo(expected, 5);
  });

  it('each criterion score is between 0 and maxScore', () => {
    const result = scoreDeliverable('automated', deliverable, rubric);
    for (const cs of result.scores) {
      const criterion = rubric.criteria.find((c) => c.id === cs.criterionId)!;
      expect(cs.score).toBeGreaterThanOrEqual(0);
      expect(cs.score).toBeLessThanOrEqual(criterion.maxScore);
    }
  });

  it('overallScore is in [0, 1]', () => {
    const result = scoreDeliverable('automated', deliverable, rubric);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });

  it('gives a zero score for an empty deliverable', () => {
    const empty: Deliverable = { teamId: 'team-b', files: [], collectedAt: new Date().toISOString() };
    const result = scoreDeliverable('automated', empty, rubric);
    expect(result.overallScore).toBe(0);
  });
});
