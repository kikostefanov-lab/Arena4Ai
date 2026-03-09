import { describe, it, expect } from 'vitest';
import { aggregate } from './score-aggregator.js';
import type { JudgeResult } from '@arena/shared';

const makeResult = (judgeId: string, teamId: string, overallScore: number): JudgeResult => ({
  judgeId,
  teamId,
  scores: [{ criterionId: 'correctness', score: overallScore * 10, commentary: '' }],
  overallScore,
});

describe('aggregate()', () => {
  it('returns one ScoreCard per team', () => {
    const results: JudgeResult[] = [
      makeResult('automated', 'team-a', 0.8),
      makeResult('automated', 'team-b', 0.6),
    ];
    const cards = aggregate(results);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.teamId).sort()).toEqual(['team-a', 'team-b']);
  });

  it('averages multiple judge scores for the same team', () => {
    const results: JudgeResult[] = [
      makeResult('judge-1', 'team-a', 0.8),
      makeResult('judge-2', 'team-a', 0.6),
    ];
    const [card] = aggregate(results);
    expect(card.finalScore).toBeCloseTo(0.7, 5);
  });

  it('assigns rank 1 to the highest scoring team', () => {
    const results: JudgeResult[] = [
      makeResult('automated', 'team-a', 0.9),
      makeResult('automated', 'team-b', 0.5),
    ];
    const cards = aggregate(results);
    const winner = cards.find((c) => c.rank === 1)!;
    expect(winner.teamId).toBe('team-a');
  });

  it('assigns rank 2 to the lower scoring team', () => {
    const results: JudgeResult[] = [
      makeResult('automated', 'team-a', 0.3),
      makeResult('automated', 'team-b', 0.7),
    ];
    const cards = aggregate(results);
    const loser = cards.find((c) => c.rank === 2)!;
    expect(loser.teamId).toBe('team-a');
  });

  it('handles a single team gracefully', () => {
    const results: JudgeResult[] = [makeResult('automated', 'team-a', 0.75)];
    const [card] = aggregate(results);
    expect(card.rank).toBe(1);
    expect(card.finalScore).toBeCloseTo(0.75, 5);
  });
});
