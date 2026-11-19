export interface CriterionScore {
  criterionId: string;
  score: number;
  commentary: string;
}

export interface JudgeResult {
  judgeId: string;        // 'automated' | 'ai-claude-<model>'
  teamId: string;
  scores: CriterionScore[];
  overallScore: number;   // weighted sum
  /**
   * Set by the automated fallback scorer (`rubric-scorer.ts`), which runs when
   * the AI judge fails. It checks completeness against the brief's named
   * deliverables and cannot assess quality, so its scores are capped. The UI
   * labels these results; branch on this flag, never on the score values.
   */
  heuristic?: boolean;
}

export interface ScoreCard {
  teamId: string;
  judgeResults: JudgeResult[];
  finalScore: number;     // aggregated across judges
  rank: number;           // 1 = winner
  /**
   * Set when the team's agent CLI crashed before producing any files (bad model
   * id, expired login, rate limit). The team was not judged: finalScore 0 and
   * last rank mean "did not compete", not "lost on merit".
   */
  agentFailure?: { message: string; exitCode: number };
}
