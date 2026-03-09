import type { JudgeResult, ScoreCard } from '@arena/shared';

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

  // Sort descending, assign ranks
  cards.sort((a, b) => b.finalScore - a.finalScore);
  return cards.map((card, i) => ({ ...card, rank: i + 1 }));
}
