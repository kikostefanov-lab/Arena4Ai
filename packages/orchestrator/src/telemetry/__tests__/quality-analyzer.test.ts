import { describe, it, expect } from 'vitest';
import { computeHeuristicSignals } from '../quality-analyzer.js';
import type { Scorecard, DeliverableFiles } from '../quality-analyzer.js';

const makeScorecard = (teamId: string, finalScore: number, scores: Array<{ criterionId: string; score: number }>): Scorecard => ({
  teamId,
  finalScore,
  judgeResults: [{ scores }],
});

describe('computeHeuristicSignals', () => {
  it('detects tight spread (tied)', () => {
    const scorecards = [
      makeScorecard('a', 0.82, [{ criterionId: 'c1', score: 8 }, { criterionId: 'c2', score: 8 }]),
      makeScorecard('b', 0.825, [{ criterionId: 'c1', score: 8 }, { criterionId: 'c2', score: 9 }]),
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    expect(signals.scoreSpread).toBeCloseTo(0.005, 3);
    expect(signals.tied).toBe(true);
  });

  it('detects wide spread (not tied)', () => {
    const scorecards = [
      makeScorecard('a', 0.9, [{ criterionId: 'c1', score: 9 }]),
      makeScorecard('b', 0.4, [{ criterionId: 'c1', score: 4 }]),
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    expect(signals.scoreSpread).toBeCloseTo(0.5, 3);
    expect(signals.tied).toBe(false);
  });

  it('detects all-eights pattern', () => {
    const scorecards = [
      makeScorecard('a', 0.8, [{ criterionId: 'c1', score: 8 }, { criterionId: 'c2', score: 7 }]),
      makeScorecard('b', 0.85, [{ criterionId: 'c1', score: 9 }, { criterionId: 'c2', score: 8 }]),
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    expect(signals.allEights).toBe(true);
  });

  it('rejects all-eights when a score falls outside 7-9', () => {
    const scorecards = [
      makeScorecard('a', 0.8, [{ criterionId: 'c1', score: 6 }, { criterionId: 'c2', score: 8 }]),
      makeScorecard('b', 0.85, [{ criterionId: 'c1', score: 9 }, { criterionId: 'c2', score: 8 }]),
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    expect(signals.allEights).toBe(false);
  });

  it('identifies missing expected files', () => {
    const deliverables: DeliverableFiles[] = [
      { teamId: 'a', files: [{ path: 'solution.py', content: 'print(1)' }] },
      { teamId: 'b', files: [{ path: 'solution.py', content: 'print(2)' }, { path: 'README.md', content: '# Hi' }] },
    ];
    const signals = computeHeuristicSignals([], ['solution.py', 'README.md', 'tests.py'], deliverables);
    expect(signals.expectedFilesProduced.found).toEqual(['solution.py', 'README.md']);
    expect(signals.expectedFilesProduced.missing).toEqual(['tests.py']);
    expect(signals.totalFilesProduced).toBe(2); // unique paths across all teams
  });

  it('computes totalContentSize across all deliverables', () => {
    const deliverables: DeliverableFiles[] = [
      { teamId: 'a', files: [{ path: 'a.py', content: '12345' }] },
      { teamId: 'b', files: [{ path: 'b.py', content: '1234567890' }] },
    ];
    const signals = computeHeuristicSignals([], [], deliverables);
    expect(signals.totalContentSize).toBe(15);
  });

  it('computes per-criterion signals', () => {
    const scorecards = [
      makeScorecard('a', 0.7, [{ criterionId: 'c1', score: 5 }, { criterionId: 'c2', score: 9 }]),
      makeScorecard('b', 0.8, [{ criterionId: 'c1', score: 9 }, { criterionId: 'c2', score: 7 }]),
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    const c1 = signals.criterionSignals.find(s => s.criterionId === 'c1')!;
    expect(c1.scoreSpread).toBe(4);
    expect(c1.avgScore).toBe(7);
    const c2 = signals.criterionSignals.find(s => s.criterionId === 'c2')!;
    expect(c2.scoreSpread).toBe(2);
    expect(c2.avgScore).toBe(8);
  });

  it('handles empty inputs gracefully', () => {
    const signals = computeHeuristicSignals([], [], []);
    expect(signals.scoreSpread).toBe(0);
    expect(signals.tied).toBe(true);
    expect(signals.allEights).toBe(false);
    expect(signals.criterionSignals).toEqual([]);
    expect(signals.totalFilesProduced).toBe(0);
  });
});
