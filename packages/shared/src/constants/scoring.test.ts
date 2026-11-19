import { describe, it, expect } from 'vitest';
import { isHeuristicScore, judgeBreakdown } from './scoring.js';

describe('isHeuristicScore()', () => {
  it('reads the explicit flag', () => {
    expect(isHeuristicScore([{ judgeId: 'x', heuristic: true }])).toBe(true);
  });
  it('recognises results stored before the flag existed by their judge id', () => {
    expect(isHeuristicScore([{ judgeId: 'automated' }])).toBe(true);
  });
  it('is false for AI-judged results and for missing data', () => {
    expect(isHeuristicScore([{ judgeId: 'ai-claude/claude-opus-5' }])).toBe(false);
    expect(isHeuristicScore([])).toBe(false);
    expect(isHeuristicScore(undefined)).toBe(false);
  });
});

describe('judgeBreakdown()', () => {
  const panel = [
    { provider: 'claude', model: 'claude-opus-5', judgeId: 'ai-claude/claude-opus-5' },
    { provider: 'codex', model: 'gpt-6.2-sol', judgeId: 'ai-codex/gpt-6.2-sol' },
    { provider: 'gemini', model: 'cli-default', judgeId: 'ai-gemini/cli-default', failure: 'timeout' },
  ];

  it('lists every panel seat, a dropped one with its failure, and averages the judges that scored', () => {
    const b = judgeBreakdown({
      judgePanel: panel,
      judgeResults: [
        { judgeId: 'ai-claude/claude-opus-5', overallScore: 0.8 },
        { judgeId: 'ai-codex/gpt-6.2-sol', overallScore: 0.6 },
      ],
    })!;
    expect(b.label).toBe('Cross-vendor panel');
    expect(b.rows.map((r) => [r.provider, r.overallScore, r.failure])).toEqual([
      ['claude', 0.8, undefined], ['codex', 0.6, undefined], ['gemini', null, 'timeout'],
    ]);
    expect(b.average).toBeCloseTo(0.7, 10);
  });

  it('has no average when every panel judge failed (the heuristic fallback scored instead)', () => {
    const b = judgeBreakdown({
      judgePanel: panel.map((p) => ({ ...p, failure: 'auth' })),
      judgeResults: [{ judgeId: 'automated', overallScore: 0.4, heuristic: true }],
    })!;
    expect(b.rows.every((r) => r.overallScore === null)).toBe(true);
    expect(b.average).toBeNull();
  });

  it('breaks down an adversarial pair as plain judges, naming each from its result', () => {
    const b = judgeBreakdown({ judgeResults: [
      { judgeId: 'ai-claude', overallScore: 0.9, provider: 'claude', model: 'claude-opus-5' },
      { judgeId: 'ai-adversarial', overallScore: 0.7, model: 'claude-sonnet-5' },
    ] })!;
    expect(b.label).toBe('Judges');
    expect(b.rows.map((r) => `${r.provider}/${r.model}`)).toEqual(['claude/claude-opus-5', 'claude/claude-sonnet-5']);
    expect(b.average).toBeCloseTo(0.8, 10);
  });

  it('is null for a single judge or a heuristic-only scorecard', () => {
    expect(judgeBreakdown({ judgeResults: [{ judgeId: 'ai-claude', overallScore: 0.9 }] })).toBeNull();
    expect(judgeBreakdown({ judgeResults: [{ judgeId: 'automated', overallScore: 0.4 }] })).toBeNull();
    expect(judgeBreakdown({})).toBeNull();
  });
});
