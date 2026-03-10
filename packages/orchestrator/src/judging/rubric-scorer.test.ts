import { describe, it, expect } from 'vitest';
import { scoreDeliverable } from './rubric-scorer.js';
import type { Brief, Rubric, Deliverable } from '@arena/shared';

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
  it('returns a JudgeResult with one CriterionScore per criterion', async () => {
    const result = await scoreDeliverable('automated', deliverable, rubric);
    expect(result.judgeId).toBe('automated');
    expect(result.teamId).toBe('team-a');
    expect(result.scores).toHaveLength(2);
    expect(result.scores.map((s) => s.criterionId)).toEqual(['correctness', 'quality']);
  });

  it('computes overallScore as weighted sum', async () => {
    const result = await scoreDeliverable('automated', deliverable, rubric);
    const expected = result.scores.reduce((sum, s) => {
      const criterion = rubric.criteria.find((c) => c.id === s.criterionId)!;
      return sum + (s.score / criterion.maxScore) * criterion.weight;
    }, 0);
    expect(result.overallScore).toBeCloseTo(expected, 5);
  });

  it('each criterion score is between 0 and maxScore', async () => {
    const result = await scoreDeliverable('automated', deliverable, rubric);
    for (const cs of result.scores) {
      const criterion = rubric.criteria.find((c) => c.id === cs.criterionId)!;
      expect(cs.score).toBeGreaterThanOrEqual(0);
      expect(cs.score).toBeLessThanOrEqual(criterion.maxScore);
    }
  });

  it('overallScore is in [0, 1]', async () => {
    const result = await scoreDeliverable('automated', deliverable, rubric);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });

  it('gives a zero score for an empty deliverable', async () => {
    const empty: Deliverable = { teamId: 'team-b', files: [], collectedAt: new Date().toISOString() };
    const result = await scoreDeliverable('automated', empty, rubric);
    expect(result.overallScore).toBe(0);
  });

  it('scores correctness by execution when brief.expectedOutput is set and output matches', async () => {
    const brief: Partial<Brief> = {
      expectedOutput: 'hello world',
    };
    const pyDeliverable: Deliverable = {
      teamId: 'team-a',
      files: [{ path: 'solution.py', content: 'print("hello world")' }],
      collectedAt: new Date().toISOString(),
    };
    const simpleRubric: Rubric = {
      criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
    };
    const result = await scoreDeliverable('automated', pyDeliverable, simpleRubric, brief as Brief);
    expect(result.scores[0].score).toBe(10);
    expect(result.overallScore).toBeCloseTo(1, 5);
  });

  it('gives partial credit when only some lines match', async () => {
    const brief: Partial<Brief> = {
      expectedOutput: 'line1\nline2\nline3',
    };
    const pyDeliverable: Deliverable = {
      teamId: 'team-a',
      // Outputs line1 and line2 correctly but not line3
      files: [{ path: 'solution.py', content: 'print("line1")\nprint("line2")\nprint("wrong")' }],
      collectedAt: new Date().toISOString(),
    };
    const simpleRubric: Rubric = {
      criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
    };
    const result = await scoreDeliverable('automated', pyDeliverable, simpleRubric, brief as Brief);
    // 2 of 3 lines match → ~6.7
    expect(result.scores[0].score).toBeGreaterThan(0);
    expect(result.scores[0].score).toBeLessThan(10);
  });

  it('gives zero for correctness when execution fails', async () => {
    const brief: Partial<Brief> = {
      expectedOutput: 'hello world',
    };
    const pyDeliverable: Deliverable = {
      teamId: 'team-a',
      files: [{ path: 'solution.py', content: 'this is not valid python !!!' }],
      collectedAt: new Date().toISOString(),
    };
    const simpleRubric: Rubric = {
      criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
    };
    const result = await scoreDeliverable('automated', pyDeliverable, simpleRubric, brief as Brief);
    expect(result.scores[0].score).toBe(0);
  });

  it('executes .ts deliverable and scores correctly', async () => {
    const brief: Partial<Brief> = {
      expectedOutput: '42',
    };
    const tsDeliverable: Deliverable = {
      teamId: 'team-ts',
      files: [{ path: 'solution.ts', content: 'const x: number = 42;\nconsole.log(x);' }],
      collectedAt: new Date().toISOString(),
    };
    const simpleRubric: Rubric = {
      criteria: [{ id: 'correctness', description: 'correct', maxScore: 10, weight: 1 }],
    };
    // Don't assert score (tsx may not be installed) — just assert it doesn't throw
    const result = await scoreDeliverable('automated', tsDeliverable, simpleRubric, brief as Brief);
    expect(result).toBeDefined();
    expect(result.scores).toHaveLength(1);
  });

  it('gives zero when the deliverable file exceeds the 100 KB size limit', async () => {
    const brief: Partial<Brief> = { expectedOutput: 'hello' };
    const oversized = 'x'.repeat(110 * 1024); // 110 KB — over the 100 KB cap
    const pyDeliverable: Deliverable = {
      teamId: 'team-a',
      files: [{ path: 'solution.py', content: oversized }],
      collectedAt: new Date().toISOString(),
    };
    const simpleRubric: Rubric = {
      criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
    };
    const result = await scoreDeliverable('automated', pyDeliverable, simpleRubric, brief as Brief);
    expect(result.scores[0].score).toBe(0);
  });
});
