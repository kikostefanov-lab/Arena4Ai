import { describe, it, expect } from 'vitest';
import type { ScoreCard } from '@arena/shared';
import { resolveOutcome } from './outcome.js';

const card = (teamId: string, rank: number, finalScore = 0.5): ScoreCard => ({
  teamId, rank, finalScore, judgeResults: [],
});

describe('resolveOutcome', () => {
  it('names the sole rank-one team as the winner', () => {
    expect(resolveOutcome([card('a', 1, 0.9), card('b', 2, 0.5)])).toEqual({
      winnerId: 'a',
      tiedTeamIds: [],
    });
  });

  it('records a draw (no winner) when several teams share rank one', () => {
    expect(resolveOutcome([card('a', 1, 0.7), card('b', 1, 0.702), card('c', 3, 0.2)])).toEqual({
      winnerId: null,
      tiedTeamIds: ['a', 'b'],
    });
  });

  it('is not a draw when the tie is below the top', () => {
    expect(resolveOutcome([card('a', 1), card('b', 2), card('c', 2)]).winnerId).toBe('a');
  });

  it('returns no winner for an empty scorecard list', () => {
    expect(resolveOutcome([])).toEqual({ winnerId: null, tiedTeamIds: [] });
  });
});
