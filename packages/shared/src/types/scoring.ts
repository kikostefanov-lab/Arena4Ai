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
