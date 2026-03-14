/**
 * Heuristic quality signals computed from competition results.
 * Used to detect lazy judging, ambiguous briefs, and file-delivery issues.
 */

export interface CriterionSignal {
  criterionId: string;
  scoreSpread: number;
  avgScore: number;
}

export interface ExpectedFilesResult {
  expected: string[];
  found: string[];
  missing: string[];
}

export interface HeuristicSignals {
  scoreSpread: number;
  tied: boolean;
  allEights: boolean;
  criterionSignals: CriterionSignal[];
  expectedFilesProduced: ExpectedFilesResult;
  totalFilesProduced: number;
  totalContentSize: number;
}

export interface Scorecard {
  teamId: string;
  finalScore: number;
  judgeResults: Array<{
    scores: Array<{
      criterionId: string;
      score: number;
      maxScore?: number;
    }>;
  }>;
}

export interface DeliverableFiles {
  teamId: string;
  files: Array<{ path: string; content: string }>;
}

export function computeHeuristicSignals(
  scorecards: Scorecard[],
  expectedDeliverables: string[],
  deliverables: DeliverableFiles[],
): HeuristicSignals {
  // Score spread: max finalScore - min finalScore
  const finalScores = scorecards.map(s => s.finalScore);
  const scoreSpread = finalScores.length > 0
    ? Math.max(...finalScores) - Math.min(...finalScores)
    : 0;

  const tied = scoreSpread < 0.01;

  // Collect all criterion scores across all teams and judge results
  const criterionMap = new Map<string, number[]>();
  let allInSevenToNine = true;
  let hasCriterionScores = false;

  for (const sc of scorecards) {
    for (const jr of sc.judgeResults ?? []) {
      for (const s of jr.scores ?? []) {
        hasCriterionScores = true;
        if (!criterionMap.has(s.criterionId)) {
          criterionMap.set(s.criterionId, []);
        }
        criterionMap.get(s.criterionId)!.push(s.score);

        // Check allEights: every score between 7-9 (inclusive)
        if (s.score < 7 || s.score > 9) {
          allInSevenToNine = false;
        }
      }
    }
  }

  const allEights = hasCriterionScores && allInSevenToNine;

  // Per-criterion signals
  const criterionSignals: CriterionSignal[] = [];
  for (const [criterionId, scores] of criterionMap) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const spread = Math.max(...scores) - Math.min(...scores);
    criterionSignals.push({ criterionId, scoreSpread: spread, avgScore: avg });
  }

  // File matching
  const allProducedPaths = new Set<string>();
  let totalContentSize = 0;

  for (const d of deliverables) {
    for (const f of d.files) {
      // Normalize: strip leading ./ or /
      const normalized = f.path.replace(/^\.?\//, '');
      allProducedPaths.add(normalized);
      totalContentSize += (f.content ?? '').length;
    }
  }

  const normalizedExpected = expectedDeliverables.map(p => p.replace(/^\.?\//, ''));
  const found = normalizedExpected.filter(p => allProducedPaths.has(p));
  const missing = normalizedExpected.filter(p => !allProducedPaths.has(p));

  return {
    scoreSpread,
    tied,
    allEights,
    criterionSignals,
    expectedFilesProduced: {
      expected: normalizedExpected,
      found,
      missing,
    },
    totalFilesProduced: allProducedPaths.size,
    totalContentSize,
  };
}
