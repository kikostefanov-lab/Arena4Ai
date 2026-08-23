import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  scoreDeliverable,
  hostCodeExecutionAllowed,
  EXECUTION_ENV_VAR,
  SKIPPED_PREFIX,
} from './rubric-scorer.js';
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

  // ── Execution-dependent tests ───────────────────────────────────────────────
  // These exercise the opt-in path, so they must turn it on explicitly. Before
  // the gate existed they passed by silently running model-written code on the
  // host of whoever ran `npm test`.
  describe('with host execution explicitly enabled', () => {
    let previous: string | undefined;
    beforeEach(() => {
      previous = process.env[EXECUTION_ENV_VAR];
      process.env[EXECUTION_ENV_VAR] = 'true';
    });
    afterEach(() => {
      if (previous === undefined) delete process.env[EXECUTION_ENV_VAR];
      else process.env[EXECUTION_ENV_VAR] = previous;
    });

    it('scores correctness by execution when brief.expectedOutput is set and output matches', async () => {
      const brief: Partial<Brief> = { expectedOutput: 'hello world' };
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
      const brief: Partial<Brief> = { expectedOutput: 'line1\nline2\nline3' };
      const pyDeliverable: Deliverable = {
        teamId: 'team-a',
        files: [{ path: 'solution.py', content: 'print("line1")\nprint("line2")\nprint("wrong")' }],
        collectedAt: new Date().toISOString(),
      };
      const simpleRubric: Rubric = {
        criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
      };
      const result = await scoreDeliverable('automated', pyDeliverable, simpleRubric, brief as Brief);
      expect(result.scores[0].score).toBeGreaterThan(0);
      expect(result.scores[0].score).toBeLessThan(10);
    });

    it('gives zero for correctness when execution genuinely FAILS (not skipped)', async () => {
      const brief: Partial<Brief> = { expectedOutput: 'hello world' };
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
      // A real failure must NOT be reported as a skip — this is the distinction
      // that AA-016 and FS-025 both lost. Zero alone cannot tell them apart.
      expect(result.scores[0].commentary).not.toContain(SKIPPED_PREFIX);
      expect(result.scores[0].commentary).toContain('failed');
      expect(result.overallScore).toBe(0);
    });

    it('executes .ts deliverable and scores correctly', async () => {
      const brief: Partial<Brief> = { expectedOutput: '42' };
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
      expect(result.scores[0].commentary).not.toContain(SKIPPED_PREFIX);
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
      expect(result.scores[0].commentary).not.toContain(SKIPPED_PREFIX);
    });
  });
});

// ── AA-033: the host-execution gate ───────────────────────────────────────────
describe('host code execution gate (AA-033)', () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[EXECUTION_ENV_VAR];
    delete process.env[EXECUTION_ENV_VAR];
  });
  afterEach(() => {
    if (previous === undefined) delete process.env[EXECUTION_ENV_VAR];
    else process.env[EXECUTION_ENV_VAR] = previous;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const execRubric: Rubric = {
    criteria: [
      { id: 'correctness', description: 'Correct output', weight: 0.6, maxScore: 10 },
      { id: 'quality', description: 'Is high quality', weight: 0.4, maxScore: 10 },
    ],
  };
  const brief: Partial<Brief> = { expectedOutput: 'hello world' };
  const pyDeliverable: Deliverable = {
    teamId: 'team-a',
    files: [{ path: 'solution.py', content: 'print("hello world")' }],
    collectedAt: new Date().toISOString(),
  };

  it('is disabled by default and enabled only by the exact string "true"', () => {
    expect(hostCodeExecutionAllowed()).toBe(false);
    for (const v of ['', 'false', '1', 'yes', 'TRUE ']) {
      process.env[EXECUTION_ENV_VAR] = v;
      expect(hostCodeExecutionAllowed()).toBe(v.trim().toLowerCase() === 'true');
    }
    process.env[EXECUTION_ENV_VAR] = 'true';
    expect(hostCodeExecutionAllowed()).toBe(true);
  });

  it('reports the criterion as SKIPPED with an actionable reason', async () => {
    const result = await scoreDeliverable('automated', pyDeliverable, execRubric, brief as Brief);
    const correctness = result.scores.find((s) => s.criterionId === 'correctness')!;
    expect(correctness.commentary).toContain(SKIPPED_PREFIX);
    // The reason must name the knob, or the user cannot act on it.
    expect(correctness.commentary).toContain(EXECUTION_ENV_VAR);
  });

  it('does NOT silently deflate the overall score with a criterion that never ran', async () => {
    const result = await scoreDeliverable('automated', pyDeliverable, execRubric, brief as Brief);
    const quality = result.scores.find((s) => s.criterionId === 'quality')!;

    // Only `quality` was actually evaluated, so it must carry the full weight.
    const expected = quality.score / 10;          // renormalised: 0.4 → 1.0
    const deflated = (quality.score / 10) * 0.4;  // what zero-weighting would give

    expect(result.overallScore).toBeCloseTo(expected, 5);
    expect(result.overallScore).not.toBeCloseTo(deflated, 5);
    expect(result.overallScore).toBeGreaterThan(deflated);
  });

  it('still scores the criteria that did run, unchanged', async () => {
    const result = await scoreDeliverable('automated', pyDeliverable, execRubric, brief as Brief);
    const quality = result.scores.find((s) => s.criterionId === 'quality')!;
    expect(quality.score).toBeGreaterThan(0);
    expect(quality.commentary).not.toContain(SKIPPED_PREFIX);
    expect(result.scores).toHaveLength(2); // skipped criteria stay visible, with their reason
  });

  it('spawns NO child process at all when execution is disabled', async () => {
    vi.resetModules();
    const spawn = vi.fn(() => {
      throw new Error('spawn() must never be called while host execution is disabled');
    });
    vi.doMock('node:child_process', () => ({ spawn, default: { spawn } }));

    const fresh = await import('./rubric-scorer.js');
    const result = await fresh.scoreDeliverable('automated', pyDeliverable, execRubric, brief as Brief);

    expect(spawn).not.toHaveBeenCalled();
    expect(result.scores.find((s) => s.criterionId === 'correctness')!.commentary)
      .toContain(SKIPPED_PREFIX);
  });

  it('an all-execution rubric degrades to 0 overall but explains every criterion', async () => {
    const onlyExec: Rubric = {
      criteria: [{ id: 'correctness', description: 'Correct output', weight: 1, maxScore: 10 }],
    };
    const result = await scoreDeliverable('automated', pyDeliverable, onlyExec, brief as Brief);
    // Nothing survived to renormalise against — 0 is the only representable answer,
    // but the commentary must still say why rather than implying a failed check.
    expect(result.overallScore).toBe(0);
    expect(result.scores[0].commentary).toContain(SKIPPED_PREFIX);
  });
});
