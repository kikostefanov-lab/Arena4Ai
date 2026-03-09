import { describe, it, expect } from 'vitest';
import { computeWinRate, computeCompletionRate, computeAvgDurationMs } from './stats-aggregator.js';

describe('computeWinRate', () => {
  it('counts wins and totals correctly, keyed by model:persona', () => {
    const competitions = [
      { id: 'c1', teams: [{ id: 'team-a', model: 'claude', persona: 'speedrunner' }, { id: 'team-b', model: 'gemini', persona: 'architect' }], state: 'COMPLETE', startedAt: null, completedAt: null },
      { id: 'c2', teams: [{ id: 'team-a', model: 'claude', persona: 'architect' }, { id: 'team-b', model: 'codex', persona: 'speedrunner' }], state: 'COMPLETE', startedAt: null, completedAt: null },
    ];
    const results = [
      { competitionId: 'c1', winnerId: 'team-a' },
      { competitionId: 'c2', winnerId: 'team-b' },
    ];
    const rates = computeWinRate(competitions as never, results as never);
    expect(rates['claude:speedrunner'].wins).toBe(1);
    expect(rates['claude:speedrunner'].total).toBe(1);
    expect(rates['claude:architect'].wins).toBe(0);
    expect(rates['claude:architect'].total).toBe(1);
    expect(rates['gemini:architect'].wins).toBe(0);
    expect(rates['gemini:architect'].total).toBe(1);
    expect(rates['codex:speedrunner'].wins).toBe(1);
    expect(rates['codex:speedrunner'].total).toBe(1);
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

describe('computeAvgDurationMs', () => {
  it('returns average duration for completed competitions', () => {
    const start1 = new Date('2026-01-01T00:00:00Z');
    const end1 = new Date('2026-01-01T00:01:00Z'); // 60s
    const start2 = new Date('2026-01-01T00:00:00Z');
    const end2 = new Date('2026-01-01T00:02:00Z'); // 120s
    const comps = [
      { id: 'c1', teams: [], state: 'COMPLETE', startedAt: start1, completedAt: end1 },
      { id: 'c2', teams: [], state: 'COMPLETE', startedAt: start2, completedAt: end2 },
    ];
    expect(computeAvgDurationMs(comps as never)).toBe(90_000); // (60000 + 120000) / 2
  });

  it('returns null when no completed competitions', () => {
    expect(computeAvgDurationMs([])).toBeNull();
  });

  it('ignores competitions with missing timestamps', () => {
    const comps = [
      { id: 'c1', teams: [], state: 'COMPLETE', startedAt: null, completedAt: null },
    ];
    expect(computeAvgDurationMs(comps as never)).toBeNull();
  });
});
