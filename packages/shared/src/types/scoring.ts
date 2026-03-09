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
}
