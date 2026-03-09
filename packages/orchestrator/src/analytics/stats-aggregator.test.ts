import { describe, it, expect } from 'vitest';
import { computeWinRate, computeCompletionRate } from './stats-aggregator.js';

describe('computeWinRate', () => {
  it('counts wins and totals correctly', () => {
    const competitions = [
      { id: 'c1', teams: [{ id: 'team-a', model: 'claude:speedrunner' }, { id: 'team-b', model: 'gemini:architect' }], state: 'COMPLETE', startedAt: null, completedAt: null },
      { id: 'c2', teams: [{ id: 'team-a', model: 'claude:architect' }, { id: 'team-b', model: 'codex:speedrunner' }], state: 'COMPLETE', startedAt: null, completedAt: null },
    ];
    const results = [
      { competitionId: 'c1', winnerId: 'team-a' },
      { competitionId: 'c2', winnerId: 'team-b' },
    ];
    const rates = computeWinRate(competitions as never, results as never);
    expect(rates['claude'].wins).toBe(1);
    expect(rates['claude'].total).toBe(2);
    expect(rates['gemini'].wins).toBe(0);
    expect(rates['gemini'].total).toBe(1);
    expect(rates['codex'].wins).toBe(1);
    expect(rates['codex'].total).toBe(1);
  });

  it('returns empty object for no competitions', () => {
    expect(computeWinRate([], [])).toEqual({});
  });
});

describe('computeCompletionRate', () => {
  it('calculates ratio of COMPLETE competitions', () => {
    const comps = [
      { id: 'c1', teams: [], state: 'COMPLETE', startedAt: null, completedAt: null },
      { id: 'c2', teams: [], state: 'COMPLETE', startedAt: null, completedAt: null },
      { id: 'c3', teams: [], state: 'RUNNING', startedAt: null, completedAt: null },
    ];
    expect(computeCompletionRate(comps as never)).toBeCloseTo(2 / 3);
  });

  it('returns 0 for empty', () => {
    expect(computeCompletionRate([])).toBe(0);
  });
});
