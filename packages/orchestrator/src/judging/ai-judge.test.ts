import { describe, it, expect } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';
import { buildJudgePrompt } from './ai-judge.js';

describe('buildJudgePrompt', () => {
  const rubric = {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  };
  const brief: Brief = {
    id: 'test-brief',
    title: 'Test Brief',
    problem: 'Solve the test problem',
    constraints: ['Must be fast', 'No external deps'],
    deliverables: ['solution.py'],
    rubric,
    format: CompetitionFormat.CLI_APP,
    timeLimitMs: 60000,
  };
  const deliverable = {
    teamId: 'team-a',
    files: [{ path: 'solution.py', content: 'print("hello")' }],
    collectedAt: new Date().toISOString(),
  };

  it('includes adversarial instructions when judgeId contains "adversarial"', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-adversarial');
    expect(prompt).toContain('weaknesses');
  });

  it('uses standard instructions for default judge', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).not.toContain('weaknesses');
  });

  it('includes brief context (title, problem, constraints)', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).toContain('Test Brief');
    expect(prompt).toContain('Solve the test problem');
    expect(prompt).toContain('Must be fast');
    expect(prompt).toContain('No external deps');
  });

  it('includes deliverable file content', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).toContain('solution.py');
    expect(prompt).toContain('print("hello")');
  });
});
