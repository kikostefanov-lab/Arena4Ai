import { describe, it, expect } from 'vitest';
import { aiJudge, buildJudgePrompt } from './ai-judge.js';

describe('buildJudgePrompt', () => {
  const rubric = {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  };
  const deliverable = {
    teamId: 'team-a',
    files: [{ path: 'solution.py', content: 'print("hello")' }],
    collectedAt: new Date().toISOString(),
  };

  it('includes adversarial instructions when judgeId contains "adversarial"', () => {
    const prompt = buildJudgePrompt(deliverable, rubric, 'ai-adversarial');
    expect(prompt).toContain('weaknesses');
  });

  it('uses standard instructions for default judge', () => {
    const prompt = buildJudgePrompt(deliverable, rubric, 'ai-claude');
    expect(prompt).not.toContain('weaknesses');
  });
});
