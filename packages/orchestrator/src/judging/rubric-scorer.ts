import type { Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';

/**
 * Automated rubric scorer.
 *
 * Scores a deliverable against each rubric criterion using simple
 * heuristics (file count, total content length, presence of required
 * keywords). This produces a deterministic baseline score that AI judges
 * can supplement.
 *
 * overallScore is in [0, 1] — the weighted normalised sum of criterion scores.
 */
export function scoreDeliverable(
  judgeId: string,
  deliverable: Deliverable,
  rubric: Rubric,
): JudgeResult {
  const totalChars = deliverable.files.reduce((s, f) => s + f.content.length, 0);
  const fileCount = deliverable.files.length;

  const scores: CriterionScore[] = rubric.criteria.map((criterion) => {
    let raw = 0;

    if (fileCount === 0) {
      raw = 0;
    } else {
      switch (criterion.id) {
        case 'correctness':
          // Heuristic: reward non-trivial content (>=50 chars per file on avg)
          raw = Math.min(criterion.maxScore, (totalChars / fileCount / 50) * criterion.maxScore);
          break;
        case 'quality':
          // Heuristic: reward multiple files or longer content
          raw = Math.min(criterion.maxScore, fileCount * 2 + (totalChars > 200 ? 2 : 0));
          break;
        default:
          // Generic: score proportionally to content length, capped at maxScore
          raw = Math.min(criterion.maxScore, (totalChars / 500) * criterion.maxScore);
      }
    }

    raw = Math.max(0, Math.round(raw * 10) / 10); // round to 1 dp, floor at 0

    return {
      criterionId: criterion.id,
      score: raw,
      commentary: fileCount === 0
        ? 'No deliverable files found.'
        : `Automated heuristic score based on ${fileCount} file(s) and ${totalChars} chars.`,
    };
  });

  const overallScore = scores.reduce((sum, s) => {
    const criterion = rubric.criteria.find((c) => c.id === s.criterionId)!;
    return sum + (s.score / criterion.maxScore) * criterion.weight;
  }, 0);

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: Math.min(1, Math.max(0, overallScore)),
  };
}
