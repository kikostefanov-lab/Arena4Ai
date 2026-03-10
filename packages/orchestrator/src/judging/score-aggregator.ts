import type { JudgeResult, ScoreCard, CriterionScore, Rubric } from '@arena/shared';

/**
 * Compute the weighted overall score in [0, 1] from per-criterion scores.
 * Used by both the automated scorer and the AI judge.
 */
export function computeOverallScore(scores: CriterionScore[], rubric: Rubric): number {
  const raw = scores.reduce((sum, s) => {
    const criterion = rubric.criteria.find((c) => c.id === s.criterionId);
    if (!criterion) return sum;
    return sum + (s.score / criterion.maxScore) * criterion.weight;
  }, 0);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Aggregate multiple JudgeResults (potentially from different judges)
 * into one ScoreCard per team, then rank them.
 *
 * finalScore = mean of all judges' overallScore for that team.
 * Rank 1 = highest finalScore.
 */
export function aggregate(results: JudgeResult[]): ScoreCard[] {
  // Group by teamId
  const byTeam = new Map<string, JudgeResult[]>();
  for (const r of results) {
    const existing = byTeam.get(r.teamId) ?? [];
    existing.push(r);
    byTeam.set(r.teamId, existing);
  }

  // Build unranked cards
  const cards: Omit<ScoreCard, 'rank'>[] = [];
  for (const [teamId, judgeResults] of byTeam) {
    const mean = judgeResults.reduce((s, r) => s + r.overallScore, 0) / judgeResults.length;
    cards.push({ teamId, judgeResults, finalScore: mean });
  }

  // Sort descending, assign ranks with tie support (within 0.005 = same rank)
  cards.sort((a, b) => b.finalScore - a.finalScore);
  const ranked = cards.map((card) => {
    const rank = 1 + cards.filter((c) => c.finalScore > card.finalScore + 0.005).length;
    return { ...card, rank };
  });
  return ranked;
}
